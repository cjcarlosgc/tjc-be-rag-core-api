import { randomUUID } from 'node:crypto';
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
  private readonly insertionOrder = new Map<string, number>();
  private sequence = 0;

  project = {
    create: async ({ data }: { data: { name: string } }): Promise<Project> => {
      this.sequence += 1;
      const now = new Date();
      const project: Project = {
        id: randomUUID(),
        name: data.name,
        currentVersionId: null,
        createdAt: now,
        updatedAt: now,
      };
      this.projects.set(project.id, project);
      this.insertionOrder.set(project.id, this.sequence);
      return project;
    },
    findUnique: async ({ where }: { where: { id: string } }): Promise<Project | null> => {
      return this.projects.get(where.id) ?? null;
    },
    findMany: async ({
      take,
      cursor,
      skip,
    }: {
      take?: number;
      cursor?: { id: string };
      skip?: number;
    }): Promise<Project[]> => {
      const sorted = [...this.projects.values()].sort(
        (a, b) => (this.insertionOrder.get(b.id) ?? 0) - (this.insertionOrder.get(a.id) ?? 0),
      );
      let startIndex = 0;

      if (cursor) {
        const cursorIndex = sorted.findIndex((project) => project.id === cursor.id);
        startIndex = cursorIndex === -1 ? sorted.length : cursorIndex + (skip ?? 0);
      }

      return take !== undefined ? sorted.slice(startIndex, startIndex + take) : sorted.slice(startIndex);
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

  it('paginates the project list, most recently created first (HU25)', async () => {
    // En este punto del archivo ya existen "demo" y "fetched" (tests previos).
    const third = await request(app.getHttpServer()).post('/projects').send({ name: 'third' }).expect(201);
    const fourth = await request(app.getHttpServer()).post('/projects').send({ name: 'fourth' }).expect(201);

    const firstPage = await request(app.getHttpServer()).get('/projects').query({ limit: 2 }).expect(200);

    expect(firstPage.body.items.map((item: { id: string }) => item.id)).toEqual([
      fourth.body.id,
      third.body.id,
    ]);
    expect(firstPage.body.nextCursor).toBe(third.body.id);

    const secondPage = await request(app.getHttpServer())
      .get('/projects')
      .query({ limit: 2, cursor: firstPage.body.nextCursor })
      .expect(200);

    expect(secondPage.body.items).toHaveLength(2);
    expect(secondPage.body.nextCursor).toBeNull();
  });
});
