import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import {
  authedRequest,
  E2E_TEST_USER_ID,
  e2eGithubUserId,
  overrideAuthTokenVerifier,
} from './support/auth-test-support.js';
import { InMemoryPrisma } from './support/in-memory-prisma.js';

const OTHER_USER_ID = 'e2e-other-user';
const OWN_GITHUB_ID = e2eGithubUserId(E2E_TEST_USER_ID);

describe('Projects (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await overrideAuthTokenVerifier(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(new InMemoryPrisma())
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

  it('exposes the personal workspace and the interim ADMIN role on every ProjectResponse (HU63)', async () => {
    const created = await authedRequest(app).post('/projects').send({ name: 'with-workspace' }).expect(201);

    expect(created.body).toMatchObject({
      workspace: { kind: 'PERSONAL', id: OWN_GITHUB_ID, login: null },
      role: 'ADMIN',
    });

    const fetched = await authedRequest(app).get(`/projects/${created.body.id}`).expect(200);
    const listed = await authedRequest(app).get('/projects').query({ limit: 100 }).expect(200);

    expect(fetched.body).toMatchObject({ workspace: created.body.workspace, role: 'ADMIN' });
    expect(listed.body.items.find((item: { id: string }) => item.id === created.body.id)).toMatchObject({
      workspace: created.body.workspace,
      role: 'ADMIN',
    });
  });

  it('creates and lists personal projects when workspaceId is the own numeric id (HU63)', async () => {
    const created = await authedRequest(app)
      .post('/projects')
      .send({ name: 'explicit-personal', workspaceId: OWN_GITHUB_ID })
      .expect(201);

    expect(created.body.workspace).toMatchObject({ kind: 'PERSONAL', id: OWN_GITHUB_ID });

    const listed = await authedRequest(app).get('/projects').query({ workspaceId: OWN_GITHUB_ID, limit: 100 }).expect(200);

    expect(listed.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
  });

  it.each([
    ['the id of an organization', '424242'],
    ['the personal workspace id of another user', e2eGithubUserId(OTHER_USER_ID)],
    ['a value that is not a workspace', 'octocat'],
  ])('answers 404 WORKSPACE_NOT_FOUND on POST and GET /projects for %s (until cut 3)', async (_label, workspaceId) => {
    const created = await authedRequest(app).post('/projects').send({ name: 'nope', workspaceId }).expect(404);
    const listed = await authedRequest(app).get('/projects').query({ workspaceId }).expect(404);

    expect(created.body).toMatchObject({ statusCode: 404, code: 'WORKSPACE_NOT_FOUND' });
    expect(listed.body).toMatchObject({ statusCode: 404, code: 'WORKSPACE_NOT_FOUND' });
  });

  it('rejects an empty workspaceId and undeclared fields with 400 INVALID_REQUEST', async () => {
    await authedRequest(app).post('/projects').send({ name: 'x', workspaceId: '' }).expect(400);
    await authedRequest(app).post('/projects').send({ name: 'x', githubOrgId: '42' }).expect(400);
    await authedRequest(app).get('/projects').query({ workspaceId: '' }).expect(400);
  });
});
