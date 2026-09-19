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
import { authedRequest, overrideAuthTokenVerifier } from './support/auth-test-support.js';
import type { Project } from '../src/generated/prisma/client.js';

const OTHER_USER_ID = 'e2e-other-user';

class FakePrismaService {
  private readonly projects = new Map<string, Project>();
  private readonly insertionOrder = new Map<string, number>();
  private sequence = 0;

  project = {
    create: async ({ data }: { data: { name: string; ownerUserId: string } }): Promise<Project> => {
      this.sequence += 1;
      const now = new Date();
      const project: Project = {
        id: randomUUID(),
        name: data.name,
        ownerUserId: data.ownerUserId,
        currentVersionId: null,
        createdAt: now,
        updatedAt: now,
      };
      this.projects.set(project.id, project);
      this.insertionOrder.set(project.id, this.sequence);
      return project;
    },
    findFirst: async ({
      where,
    }: {
      where: { id: string; ownerUserId: string };
    }): Promise<Project | null> => {
      const project = this.projects.get(where.id);
      return project && project.ownerUserId === where.ownerUserId ? project : null;
    },
    findMany: async ({
      where,
      take,
      cursor,
      skip,
    }: {
      where?: { ownerUserId?: string };
      take?: number;
      cursor?: { id: string };
      skip?: number;
    }): Promise<Project[]> => {
      const sorted = [...this.projects.values()]
        .filter((project) => !where?.ownerUserId || project.ownerUserId === where.ownerUserId)
        .sort((a, b) => (this.insertionOrder.get(b.id) ?? 0) - (this.insertionOrder.get(a.id) ?? 0));
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
    const moduleFixture: TestingModule = await overrideAuthTokenVerifier(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useClass(FakePrismaService)
        .overrideProvider(ObjectStorageService)
        .useClass(FakeObjectStorageService),
    ).compile();

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

  it('rejects a request without an Authorization header with 401 AUTH_REQUIRED (HU29)', async () => {
    const response = await request(app.getHttpServer()).post('/projects').send({ name: 'demo' }).expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('creates a project with a null currentVersionId', async () => {
    const response = await authedRequest(app)
      .post('/projects')
      .send({ name: 'demo' })
      .expect(201);

    expect(response.body).toMatchObject({ name: 'demo', currentVersionId: null });
    expect(response.body.id).toBeDefined();
  });

  it('rejects an empty name with the standard error envelope', async () => {
    const response = await authedRequest(app)
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
    const created = await authedRequest(app)
      .post('/projects')
      .send({ name: 'fetched' })
      .expect(201);

    const response = await authedRequest(app)
      .get(`/projects/${created.body.id}`)
      .expect(200);

    expect(response.body).toMatchObject({ id: created.body.id, name: 'fetched' });
  });

  it('returns a 404 PROJECT_NOT_FOUND envelope for an unknown id', async () => {
    const response = await authedRequest(app).get('/projects/unknown').expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
    });
  });

  it('returns a 404 PROJECT_NOT_FOUND for a project owned by another user (HU29)', async () => {
    const created = await authedRequest(app, OTHER_USER_ID)
      .post('/projects')
      .send({ name: 'private' })
      .expect(201);

    const response = await authedRequest(app).get(`/projects/${created.body.id}`).expect(404);

    expect(response.body.code).toBe('PROJECT_NOT_FOUND');
  });

  it('never lists another owner\'s projects (HU29)', async () => {
    await authedRequest(app, OTHER_USER_ID).post('/projects').send({ name: 'other-owner-project' }).expect(201);

    const response = await authedRequest(app).get('/projects').query({ limit: 50 }).expect(200);

    expect(
      response.body.items.some((item: { name: string }) => item.name === 'other-owner-project'),
    ).toBe(false);
  });

  it('paginates the project list, most recently created first (HU25)', async () => {
    // En este punto del archivo ya existen "demo" y "fetched" (tests previos).
    const third = await authedRequest(app).post('/projects').send({ name: 'third' }).expect(201);
    const fourth = await authedRequest(app).post('/projects').send({ name: 'fourth' }).expect(201);

    const firstPage = await authedRequest(app).get('/projects').query({ limit: 2 }).expect(200);

    expect(firstPage.body.items.map((item: { id: string }) => item.id)).toEqual([
      fourth.body.id,
      third.body.id,
    ]);
    expect(firstPage.body.nextCursor).toBe(third.body.id);

    const secondPage = await authedRequest(app)
      .get('/projects')
      .query({ limit: 2, cursor: firstPage.body.nextCursor })
      .expect(200);

    expect(secondPage.body.items).toHaveLength(2);
    expect(secondPage.body.nextCursor).toBeNull();
  });
});
