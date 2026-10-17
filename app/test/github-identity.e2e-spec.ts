import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import {
  authedRequest,
  createE2eIdentityFakes,
  overrideAuthTokenVerifier,
  type E2eIdentityFakes,
} from './support/auth-test-support.js';

/** Prisma mínimo: estos casos solo ejercitan el guard y `POST /projects`. */
class FakePrismaService {
  project = {
    create: ({ data }: { data: { name: string; ownerUserId: string } }) =>
      Promise.resolve({
        id: 'project-1',
        name: data.name,
        ownerUserId: data.ownerUserId,
        currentVersionId: null,
        deletedAt: null,
        githubOrgId: null,
        githubOrgLogin: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
  };
}

describe('GitHub identity (HU62, e2e)', () => {
  let app: INestApplication;
  let fakes: E2eIdentityFakes;

  beforeAll(async () => {
    fakes = createE2eIdentityFakes();
    const moduleFixture = await overrideAuthTokenVerifier(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useClass(FakePrismaService)
        .overrideProvider(ObjectStorageService)
        .useClass(FakeObjectStorageService),
      fakes,
    ).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a session whose Supabase user has a GitHub identity and persists the link once', async () => {
    fakes.supabaseIdentity.setIdentity('user-with-github', { githubUserId: '4242', login: 'octocat' });

    await authedRequest(app, 'user-with-github').post('/projects').send({ name: 'a' }).expect(201);
    await authedRequest(app, 'user-with-github').post('/projects').send({ name: 'b' }).expect(201);

    expect(fakes.identities.rows.get('user-with-github')?.githubUserId).toBe('4242');
    expect(fakes.supabaseIdentity.calls.filter((sub) => sub === 'user-with-github')).toHaveLength(1);
  });

  it('answers 401 GITHUB_IDENTITY_REQUIRED with the standard envelope for a valid token without GitHub identity', async () => {
    fakes.supabaseIdentity.setIdentity('email-only-user', null);

    const response = await authedRequest(app, 'email-only-user').post('/projects').send({ name: 'x' }).expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      code: 'GITHUB_IDENTITY_REQUIRED',
      details: null,
      path: '/projects',
    });
    expect(response.body.correlationId).toBeDefined();
    expect(response.body.timestamp).toBeDefined();
  });

  it('answers 503 IDENTITY_UNAVAILABLE when the Admin API is down and there is no persisted link', async () => {
    fakes.supabaseIdentity.setUnavailable(true);

    try {
      const response = await authedRequest(app, 'brand-new-user').get('/projects').expect(503);

      expect(response.body).toMatchObject({ statusCode: 503, code: 'IDENTITY_UNAVAILABLE' });
    } finally {
      fakes.supabaseIdentity.setUnavailable(false);
    }
  });

  it('keeps serving a user with a persisted link while the Admin API is down', async () => {
    fakes.supabaseIdentity.setIdentity('linked-user', { githubUserId: '777' });
    await authedRequest(app, 'linked-user').post('/projects').send({ name: 'first' }).expect(201);

    fakes.supabaseIdentity.setUnavailable(true);
    try {
      await authedRequest(app, 'linked-user').post('/projects').send({ name: 'second' }).expect(201);
    } finally {
      fakes.supabaseIdentity.setUnavailable(false);
    }
  });

  it('keeps AUTH_REQUIRED for a request without credentials (no identity lookup)', async () => {
    const before = fakes.supabaseIdentity.calls.length;

    const response = await request(app.getHttpServer()).post('/projects').send({ name: 'x' }).expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(fakes.supabaseIdentity.calls).toHaveLength(before);
  });
});
