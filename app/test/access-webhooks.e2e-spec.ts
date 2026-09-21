import { createHmac } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessReconciliationJobHandler } from '../src/access-sync/access-reconciliation.job-handler.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { GITHUB_ACCESS_PORT } from '../src/github-app/github-access.port.js';
import { GithubAppAuthService } from '../src/github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../src/github-app/github-repository-content.service.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeGithubAccessPort } from './support/fake-github-access.port.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import { InMemoryPrisma } from './support/in-memory-prisma.js';
import { authedRequest, e2eGithubUserId, overrideAuthTokenVerifier } from './support/auth-test-support.js';

/**
 * 014, corte 5a (HU61): eventos `repository`, `installation` e `installation_repositories` sobre
 * bindings por el ingress REAL (firma HMAC sobre el body crudo, `202`), con fakes de GitHub y
 * `InMemoryPrisma`; el efecto se observa por las rutas HTTP con el predicado de acceso real.
 * Ningún test llama a GitHub ni Supabase.
 */
const SECRET = 'e2e-webhook-secret';
const ORG_ID = '42';
const ORG = 'acme';
const REPO = 'acme/widgets';
const OWNER = 'wh-owner';
const WRITER = 'wh-writer';
const READER = 'wh-reader';
const PERSONAL = 'wh-personal';
const gh = e2eGithubUserId;

describe('Access webhooks over the ingress (HU61, corte 5a, e2e)', () => {
  let app: INestApplication;
  let github: FakeGithubAccessPort;
  const prisma = new InMemoryPrisma();
  let deliveries = 0;

  beforeAll(async () => {
    // `ConfigModule.forRoot` lee el entorno al importar `AppModule`: se fija antes del import.
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
    const { AppModule } = await import('../src/app.module.js');
    github = new FakeGithubAccessPort();

    const moduleFixture = await overrideAuthTokenVerifier(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(ObjectStorageService)
        .useClass(FakeObjectStorageService)
        .overrideProvider(GITHUB_ACCESS_PORT)
        .useValue(github)
        .overrideProvider(GithubAppAuthService)
        .useValue({
          findInstallationForRepository: () => Promise.resolve('42'),
          getInstallationToken: () => Promise.resolve('installation-token'),
          getAppInfo: () => Promise.resolve({ slug: 'tjc-core', name: 'TJC Core' }),
        })
        .overrideProvider(GithubRepositoryContentService)
        .useValue({ listBranches: () => Promise.resolve([{ name: 'main', protected: false }]) }),
    ).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
  });

  beforeEach(async () => {
    prisma.reset();
    github.reset();
    github.addOrganization({ installationId: 'inst-42', organizationId: ORG_ID, organizationLogin: ORG, avatarUrl: null, suspended: false });
    github
      .setMembership(ORG, gh(OWNER), { role: 'admin', state: 'active' })
      .setMembership(ORG, gh(WRITER), { role: 'member', state: 'active' })
      .setMembership(ORG, gh(READER), { role: 'member', state: 'active' })
      .addRepository(REPO, { repositoryId: '100', ownerId: ORG_ID, ownerLogin: ORG, ownerType: 'Organization' })
      .setPermission(REPO, gh(OWNER), 'admin')
      .setPermission(REPO, gh(WRITER), 'write')
      .setPermission(REPO, gh(READER), 'read');
  });

  const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

  const deliver = (eventName: string, payload: unknown, options: { deliveryId?: string; signature?: string } = {}) => {
    const body = JSON.stringify(payload);
    deliveries += 1;
    return request(app.getHttpServer())
      .post('/integrations/github/webhooks')
      .set('content-type', 'application/json')
      .set('x-github-event', eventName)
      .set('x-github-delivery', options.deliveryId ?? `delivery-${deliveries}`)
      .set('x-hub-signature-256', options.signature ?? sign(body))
      .send(body);
  };

  const repositoryEvent = (action: string, repository: Record<string, unknown> = {}) => ({
    action,
    repository: { id: 100, full_name: REPO, owner: { id: Number(ORG_ID), login: ORG, type: 'Organization' }, ...repository },
    installation: { id: 42 },
  });

  /** Project de organización con binding y los tres roles registrados por entrada real. */
  const setUpOrgProject = async () => {
    const project = (await authedRequest(app, OWNER).post('/projects').send({ name: 'team', workspaceId: ORG_ID }).expect(201)).body as { id: string };
    await authedRequest(app, OWNER)
      .post(`/projects/${project.id}/integrations/github`)
      .send({ repositoryId: '100', repositoryName: REPO, integrationBranch: 'main' })
      .expect(201);
    await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);
    await authedRequest(app, READER).get(`/projects/${project.id}`).expect(200);
    return project.id;
  };

  const binding = () => prisma.tables.repositoryBinding[0] as { status: string; repositoryName: string };
  const recordsOf = () => prisma.tables.projectAccess.map((row) => `${row.userId}:${row.role}`).sort();

  describe('ingress contract (unchanged shape)', () => {
    it('answers 202 with the same shape and analysisRunId null for a handled repository event', async () => {
      await setUpOrgProject();

      const response = await deliver('repository', repositoryEvent('renamed', { full_name: 'acme/gadgets' }), { deliveryId: 'd-shape' }).expect(202);

      expect(response.body).toEqual({ deliveryId: 'd-shape', accepted: true, duplicate: false, analysisRunId: null });
    });

    it('rejects an altered signature with 401 and applies nothing', async () => {
      await setUpOrgProject();
      const body = JSON.stringify(repositoryEvent('deleted'));

      await request(app.getHttpServer())
        .post('/integrations/github/webhooks')
        .set('content-type', 'application/json')
        .set('x-github-event', 'repository')
        .set('x-github-delivery', 'd-tampered')
        .set('x-hub-signature-256', sign(`${body} `))
        .send(body)
        .expect(401);

      expect(binding().status).toBe('ENABLED');
      expect(recordsOf()).toHaveLength(3);
    });

    it('rejects a missing signature and a missing delivery id', async () => {
      await request(app.getHttpServer())
        .post('/integrations/github/webhooks')
        .set('content-type', 'application/json')
        .set('x-github-event', 'repository')
        .set('x-github-delivery', 'd-nosig')
        .send(JSON.stringify(repositoryEvent('deleted')))
        .expect(401);
      await deliver('repository', repositoryEvent('deleted')).set('x-github-delivery', '').expect(400);
    });

    it.each(['member', 'membership', 'organization', 'team'])('keeps answering 202 to `%s` and ignores it until stage 3b', async (eventName) => {
      await setUpOrgProject();

      const response = await deliver(eventName, { action: 'removed', member: { id: 1 }, organization: { id: 42 }, repository: { id: 100 } }).expect(202);

      expect(response.body).toMatchObject({ accepted: true, duplicate: false, analysisRunId: null });
      expect(binding().status).toBe('ENABLED');
      expect(recordsOf()).toHaveLength(3);
    });
  });

  describe('repository events', () => {
    it('renamed: updates repositoryName, and a duplicate delivery is harmless', async () => {
      await setUpOrgProject();

      await deliver('repository', repositoryEvent('renamed', { full_name: 'acme/gadgets' }), { deliveryId: 'd-1' }).expect(202);
      await deliver('repository', repositoryEvent('renamed', { full_name: 'acme/gadgets' }), { deliveryId: 'd-1' }).expect(202);

      expect(binding()).toMatchObject({ repositoryName: 'acme/gadgets', status: 'ENABLED' });
      expect(recordsOf()).toHaveLength(3);
    });

    it('deleted: REVOKED, Maintainer and Reader lose the project (404) while the Admin still sees the REVOKED binding', async () => {
      const projectId = await setUpOrgProject();

      await deliver('repository', repositoryEvent('deleted')).expect(202);

      expect(binding().status).toBe('REVOKED');
      expect(recordsOf()).toEqual([`${OWNER}:ADMIN`]);
      await authedRequest(app, WRITER).get(`/projects/${projectId}`).expect(404);
      await authedRequest(app, READER).get(`/projects/${projectId}/integrations/github`).expect(404);
      const asAdmin = await authedRequest(app, OWNER).get(`/projects/${projectId}/integrations/github`).expect(200);
      expect(asAdmin.body.status).toBe('REVOKED');
    });

    it('deleted, delivered out of order after a rename and twice: the state stays REVOKED', async () => {
      await setUpOrgProject();

      await deliver('repository', repositoryEvent('deleted'), { deliveryId: 'd-del' }).expect(202);
      await deliver('repository', repositoryEvent('renamed', { full_name: 'acme/late' })).expect(202);
      await deliver('repository', repositoryEvent('deleted'), { deliveryId: 'd-del' }).expect(202);

      expect(binding().status).toBe('REVOKED');
    });

    it('is processed although the binding is DISABLED (paused by the user)', async () => {
      const projectId = await setUpOrgProject();
      await authedRequest(app, OWNER).delete(`/projects/${projectId}/integrations/github`).expect(204);
      expect(binding().status).toBe('DISABLED');

      await deliver('repository', repositoryEvent('deleted')).expect(202);

      expect(binding().status).toBe('REVOKED');
      await authedRequest(app, WRITER).get(`/projects/${projectId}`).expect(404);
    });

    it('transferred out of the organization: REVOKED and records deleted; to the same organization: only the name', async () => {
      const projectId = await setUpOrgProject();

      await deliver('repository', repositoryEvent('transferred', { full_name: 'acme/moved', owner: { id: Number(ORG_ID), login: ORG } })).expect(202);
      expect(binding()).toMatchObject({ status: 'ENABLED', repositoryName: 'acme/moved' });
      await authedRequest(app, WRITER).get(`/projects/${projectId}`).expect(200);

      await deliver('repository', repositoryEvent('transferred', { full_name: 'other/moved', owner: { id: 999, login: 'other' } })).expect(202);

      expect(binding().status).toBe('REVOKED');
      await authedRequest(app, WRITER).get(`/projects/${projectId}`).expect(404);
      await authedRequest(app, OWNER).get(`/projects/${projectId}`).expect(200);
    });

    it('applies to the binding of a PERSONAL project (no records involved)', async () => {
      const project = (await authedRequest(app, PERSONAL).post('/projects').send({ name: 'mine' }).expect(201)).body as { id: string };
      github.addRepository('me/repo', { repositoryId: '100', ownerId: gh(PERSONAL), ownerLogin: 'me', ownerType: 'User' }).setPermission('me/repo', gh(PERSONAL), 'admin');
      await authedRequest(app, PERSONAL)
        .post(`/projects/${project.id}/integrations/github`)
        .send({ repositoryId: '100', repositoryName: 'me/repo', integrationBranch: 'main' })
        .expect(201);

      await deliver('repository', repositoryEvent('renamed', { full_name: 'me/renamed', owner: { id: Number(gh(PERSONAL)) } })).expect(202);
      expect(binding().repositoryName).toBe('me/renamed');

      await deliver('repository', repositoryEvent('transferred', { full_name: 'x/renamed', owner: { id: 12345 } })).expect(202);
      expect(binding().status).toBe('REVOKED');
      await authedRequest(app, PERSONAL).get(`/projects/${project.id}`).expect(200);
    });

    it('privatized and unlisted actions: 202 and no change (privatized is reverified in stage 3b)', async () => {
      await setUpOrgProject();

      for (const action of ['privatized', 'archived', 'publicized', 'edited']) {
        await deliver('repository', repositoryEvent(action)).expect(202);
      }

      expect(binding()).toMatchObject({ status: 'ENABLED', repositoryName: REPO });
      expect(recordsOf()).toHaveLength(3);
    });

    it('an event for a repository without a binding is ignored with 202', async () => {
      await setUpOrgProject();

      await deliver('repository', repositoryEvent('deleted', { id: 777 })).expect(202);

      expect(binding().status).toBe('ENABLED');
    });
  });

  describe('installation and installation_repositories', () => {
    it('installation.deleted: REVOKED, Maintainer/Reader deleted, Admin kept', async () => {
      const projectId = await setUpOrgProject();
      const installationId = (prisma.tables.repositoryBinding[0] as { installationId: string }).installationId;

      await deliver('installation', { action: 'deleted', installation: { id: Number(installationId) } }).expect(202);

      expect(binding().status).toBe('REVOKED');
      expect(recordsOf()).toEqual([`${OWNER}:ADMIN`]);
      await authedRequest(app, READER).get(`/projects/${projectId}`).expect(404);
    });

    it('installation_repositories.removed: revokes only the removed repository binding and deletes its records', async () => {
      const projectId = await setUpOrgProject();
      const installationId = Number((prisma.tables.repositoryBinding[0] as { installationId: string }).installationId);

      await deliver('installation_repositories', {
        action: 'removed',
        installation: { id: installationId },
        repositories_removed: [{ id: 100, full_name: REPO }],
      }).expect(202);

      expect(binding().status).toBe('REVOKED');
      await authedRequest(app, WRITER).get(`/projects/${projectId}`).expect(404);
    });

    it('installation_repositories.added and a removal of another installation change nothing', async () => {
      await setUpOrgProject();
      const installationId = Number((prisma.tables.repositoryBinding[0] as { installationId: string }).installationId);

      await deliver('installation_repositories', { action: 'added', installation: { id: installationId }, repositories_added: [{ id: 100, full_name: REPO }] }).expect(202);
      await deliver('installation_repositories', { action: 'removed', installation: { id: 1 }, repositories_removed: [{ id: 100, full_name: REPO }] }).expect(202);

      expect(binding().status).toBe('ENABLED');
      expect(recordsOf()).toHaveLength(3);
    });

    it('installation.suspend pauses the binding but does NOT delete access records; unsuspend restores it', async () => {
      const projectId = await setUpOrgProject();
      const installationId = Number((prisma.tables.repositoryBinding[0] as { installationId: string }).installationId);

      await deliver('installation', { action: 'suspend', installation: { id: installationId } }).expect(202);
      expect(binding().status).toBe('DISABLED');
      expect(recordsOf()).toHaveLength(3);
      await authedRequest(app, WRITER).get(`/projects/${projectId}`).expect(200);

      await deliver('installation', { action: 'unsuspend', installation: { id: installationId } }).expect(202);
      expect(binding().status).toBe('ENABLED');
    });
  });

  describe('reconciliation part (c) through the real handler', () => {
    it('corrects a lost `repository` event: a transfer becomes REVOKED, a rename updates the name; an outage revokes nothing', async () => {
      const projectId = await setUpOrgProject();
      // La cola cruda de `InMemoryPrisma` no devuelve filas: la siembra y la autoprogramación son no-ops
      // y la reconciliación se ejecuta a mano.
      const handler = app.get(AccessReconciliationJobHandler);

      github.ownerMode = 'UNVERIFIABLE';
      await handler.run({});
      expect(binding().status).toBe('ENABLED');

      github.ownerMode = 'NORMAL';
      github.renameRepository(REPO, 'acme/renamed');
      await handler.run({});
      expect(binding()).toMatchObject({ status: 'ENABLED', repositoryName: 'acme/renamed' });

      github.transferRepository('acme/renamed', { ownerId: '999', ownerLogin: 'other', ownerType: 'Organization' });
      await handler.run({});

      expect(binding().status).toBe('REVOKED');
      expect(recordsOf()).toEqual([`${OWNER}:ADMIN`]);
      await authedRequest(app, WRITER).get(`/projects/${projectId}`).expect(404);
    });
  });
});
