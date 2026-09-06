import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import type { Project } from '../src/generated/prisma/client.js';

class FakePrismaService {
  private readonly projects = new Map<string, Project>();
  private sequence = 0;

  project = {
    create: async ({ data }: { data: { name: string } }): Promise<Project> => {
      this.sequence += 1;
      const now = new Date();
      const project: Project = {
        id: `project-${this.sequence}`,
        name: data.name,
        currentVersionId: null,
        createdAt: now,
        updatedAt: now,
      };
      this.projects.set(project.id, project);
      return project;
    },
    findUnique: async ({ where }: { where: { id: string } }): Promise<Project | null> => {
      return this.projects.get(where.id) ?? null;
    },
  };
}

describe('Projects (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useClass(FakePrismaService)
      .overrideProvider(ObjectStorageService)
      .useClass(FakeObjectStorageService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a project with a null currentVersionId', async () => {
    const response = await request(app.getHttpServer())
      .post('/projects')
      .send({ name: 'demo' })
      .expect(201);

    expect(response.body).toMatchObject({ name: 'demo', currentVersionId: null });
    expect(response.body.id).toBeDefined();
  });

  it('rejects an empty name with the standard error envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/projects')
      .send({ name: '' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'INVALID_REQUEST',
    });
    expect(response.body.correlationId).toBeDefined();
  });

  it('returns the created project by id', async () => {
    const created = await request(app.getHttpServer())
      .post('/projects')
      .send({ name: 'fetched' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/projects/${created.body.id}`)
      .expect(200);

    expect(response.body).toMatchObject({ id: created.body.id, name: 'fetched' });
  });

  it('returns a 404 PROJECT_NOT_FOUND envelope for an unknown id', async () => {
    const response = await request(app.getHttpServer()).get('/projects/unknown').expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
    });
  });
});
