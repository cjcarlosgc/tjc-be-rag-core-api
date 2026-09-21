import { createHmac } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessReconciliationJobHandler } from '../src/access-sync/access-reconciliation.job-handler.js';
import { JobsRepository } from '../src/jobs/jobs.repository.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { InMemoryJobsRepository } from './support/in-memory-jobs.repository.js';
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
 * 014, corte 5 (HU61): eventos `repository`, `installation`, `installation_repositories` (5a) y
 * `member`, `membership`, `organization`, `team` y `repository.privatized` (5b) por el ingress REAL
 * (firma HMAC sobre el body crudo, `202`), con fakes de GitHub, `InMemoryPrisma` y la cola en memoria
 * (`InMemoryJobsRepository`, que modela el SQL verificado contra PostgreSQL); el efecto se observa por
 * las rutas HTTP con el predicado de acceso real. Ningún test llama a GitHub ni Supabase.
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
  let jobs: JobsService;
  const prisma = new InMemoryPrisma();
  const queue = new InMemoryJobsRepository();
  let deliveries = 0;

  beforeAll(async () => {
    // `ConfigModule.forRoot` lee el entorno al importar `AppModule`: se fija antes del import.
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
    process.env.JOBS_POLL_INTERVAL_MS = '3600000'; // los jobs se ejecutan a mano con `runOnce()`
    const { AppModule } = await import('../src/app.module.js');
    github = new FakeGithubAccessPort();

    const moduleFixture = await overrideAuthTokenVerifier(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(ObjectStorageService)
        .useClass(FakeObjectStorageService)
        .overrideProvider(JobsRepository)
        .useValue(queue)
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
    jobs = app.get(JobsService);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.JOBS_POLL_INTERVAL_MS;
  });

  beforeEach(async () => {
    prisma.reset();
    github.reset();
    queue.jobs.length = 0; // sin la siembra de la reconciliación al arrancar
    github.addOrganization({ installationId: 'inst-42', organizationId: ORG_ID, organizationLogin: ORG, avatarUrl: null, suspended: false });
    github
      .setMembership(ORG, gh(OWNER), { role: 'admin', state: 'active' })
      .setMembership(ORG, gh(WRITER), { role: 'member', state: 'active' })
      .setMembership(ORG, gh(READER), { role: 'member', state: 'active' })
      .setOwners(ORG, [{ githubUserId: gh(OWNER), login: OWNER }])
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

    it.each(['member', 'membership', 'organization', 'team'])('answers 202 with the same shape to `%s` and records no delivery', async (eventName) => {
      await setUpOrgProject();

      const response = await deliver(eventName, { action: 'removed', member: { id: 1 }, membership: { user: { id: 1 } }, organization: { id: 42 }, repository: { id: 100 } }, { deliveryId: `d-${eventName}` }).expect(202);

      expect(response.body).toEqual({ deliveryId: `d-${eventName}`, accepted: true, duplicate: false, analysisRunId: null });
      expect(prisma.tables.webhookDelivery).toHaveLength(0);
    });

    it.each(['member', 'membership', 'organization', 'team'])('rejects a tampered `%s` signature with 401 and enqueues/applies nothing', async (eventName) => {
      await setUpOrgProject();
      const body = JSON.stringify({ action: 'removed', member: { id: 1 }, membership: { user: { id: 1 } }, organization: { id: 42 }, repository: { id: 100 } });

      await request(app.getHttpServer())
        .post('/integrations/github/webhooks')
        .set('content-type', 'application/json')
        .set('x-github-event', eventName)
        .set('x-github-delivery', 'd-tampered')
        .set('x-hub-signature-256', sign(`${body} `))
        .send(body)
        .expect(401);

      expect(queue.jobs).toHaveLength(0);
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

    it('unlisted actions: 202 and no change', async () => {
      await setUpOrgProject();

      for (const action of ['archived', 'publicized', 'edited']) {
        await deliver('repository', repositoryEvent(action)).expect(202);
      }

      expect(binding()).toMatchObject({ status: 'ENABLED', repositoryName: REPO });
      expect(recordsOf()).toHaveLength(3);
      expect(queue.jobs).toHaveLength(0);
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

  describe('access events (corte 5b): the payload selects, the live verification decides', () => {
    /** Ejecuta los jobs disponibles (los reprogramados con backoff quedan en la cola). */
    const runJobs = async () => {
      for (let round = 0; round < 6 && queue.pending().length > 0; round += 1) {
        await jobs.runOnce();
      }
    };
    const memberEvent = (action: string, userId: string) => ({ action, member: { id: Number(gh(userId)) }, repository: { id: 100, full_name: REPO } });
    const projectAs = (userId: string, projectId: string) => authedRequest(app, userId).get(`/projects/${projectId}`);

    it('member.removed: the job runs after the 202 and, because GitHub confirms the loss, the Maintainer loses the project (404) while the others keep it', async () => {
      const projectId = await setUpOrgProject();
      github.removePermission(REPO, gh(WRITER));

      const response = await deliver('member', memberEvent('removed', WRITER), { deliveryId: 'd-member' }).expect(202);

      expect(response.body).toEqual({ deliveryId: 'd-member', accepted: true, duplicate: false, analysisRunId: null });
      expect(queue.pending()).toHaveLength(1); // el ingress solo encola: nada cambió todavía
      expect(recordsOf()).toHaveLength(3);
      await runJobs();

      expect(recordsOf()).toEqual([`${OWNER}:ADMIN`, `${READER}:READER`]);
      await projectAs(WRITER, projectId).expect(404);
      await projectAs(READER, projectId).expect(200);
      await projectAs(OWNER, projectId).expect(200);
    });

    it('member.edited: a permission change write -> read is applied from the LIVE state (Maintainer -> Reader), never from the payload', async () => {
      const projectId = await setUpOrgProject();
      github.setPermission(REPO, gh(WRITER), 'read');

      // El payload afirma un cambio a `admin`, que nadie verificó: se ignora.
      await deliver('member', { ...memberEvent('edited', WRITER), changes: { permission: { to: 'admin' } } }).expect(202);
      await runJobs();

      expect(recordsOf()).toContain(`${WRITER}:READER`);
      await projectAs(WRITER, projectId).expect(200);
      await authedRequest(app, WRITER).delete(`/projects/${projectId}/integrations/github`).expect(403); // ya no es Maintainer
    });

    it('member.added and a duplicate/out-of-order delivery are harmless: the live state wins', async () => {
      const projectId = await setUpOrgProject();
      github.removePermission(REPO, gh(WRITER));
      await deliver('member', memberEvent('removed', WRITER), { deliveryId: 'd-1' }).expect(202);
      await deliver('member', memberEvent('removed', WRITER), { deliveryId: 'd-1' }).expect(202); // duplicado
      expect(queue.pending()).toHaveLength(1); // deduplicado por alcance mientras espera
      await deliver('member', memberEvent('added', WRITER), { deliveryId: 'd-0' }).expect(202); // llega tarde: "added" después de "removed"
      await runJobs();

      expect(recordsOf()).not.toContain(`${WRITER}:MAINTAINER`);
      await projectAs(WRITER, projectId).expect(404);
    });

    it('organization.member_removed: every record of the user in the organization is deleted (Admin included); member_added/member_invited do nothing', async () => {
      const projectId = await setUpOrgProject();
      const asRemoved = (action: string, userId: string) => ({ action, membership: { user: { id: Number(gh(userId)) } }, organization: { id: Number(ORG_ID), login: ORG } });

      await deliver('organization', asRemoved('member_added', WRITER)).expect(202);
      await deliver('organization', asRemoved('member_invited', WRITER)).expect(202);
      expect(queue.jobs).toHaveLength(0);

      github.removeMembership(ORG, gh(WRITER));
      github.removeMembership(ORG, gh(OWNER));
      github.setOwners(ORG, [{ githubUserId: gh('someone-else'), login: 'else' }]);
      await deliver('organization', asRemoved('member_removed', WRITER)).expect(202);
      await deliver('organization', asRemoved('member_removed', OWNER)).expect(202);
      await runJobs();

      expect(recordsOf()).toEqual([`${READER}:READER`]);
      await projectAs(WRITER, projectId).expect(404);
      await projectAs(OWNER, projectId).expect(404); // el owner dejó de ser miembro activo
    });

    it('membership.removed (Team member): the user is reverified over the projects with a repository of the organization', async () => {
      const projectId = await setUpOrgProject();
      github.removePermission(REPO, gh(READER)); // el Team le daba el `read`

      await deliver('membership', { action: 'removed', scope: 'team', member: { id: Number(gh(READER)) }, organization: { id: Number(ORG_ID) } }).expect(202);
      await runJobs();

      expect(recordsOf()).toEqual([`${OWNER}:ADMIN`, `${WRITER}:MAINTAINER`]);
      await projectAs(READER, projectId).expect(404);
    });

    it.each(['added_to_repository', 'removed_from_repository', 'edited', 'deleted'])(
      'team.%s with repository.id: every record of the project linked to it is reverified',
      async (action) => {
        const projectId = await setUpOrgProject();
        github.removePermission(REPO, gh(READER));
        github.setPermission(REPO, gh(WRITER), 'read');

        await deliver('team', { action, team: { id: 1 }, repository: { id: 100 }, organization: { id: Number(ORG_ID) } }).expect(202);
        await runJobs();

        expect(recordsOf()).toEqual([`${OWNER}:ADMIN`, `${WRITER}:READER`]);
        await projectAs(READER, projectId).expect(404);
      },
    );

    it('team.edited without repository.id reverifies every project with a repository of the organization; team.created does nothing', async () => {
      await setUpOrgProject();
      github.removePermission(REPO, gh(READER));

      await deliver('team', { action: 'created', team: { id: 1 }, organization: { id: Number(ORG_ID) } }).expect(202);
      expect(queue.jobs).toHaveLength(0);
      await deliver('team', { action: 'edited', team: { id: 1 }, organization: { id: Number(ORG_ID) } }).expect(202);
      await runJobs();

      expect(recordsOf()).toEqual([`${OWNER}:ADMIN`, `${WRITER}:MAINTAINER`]);
    });

    it('repository.privatized: the implicit read of a public repository disappears, so a record that GitHub no longer backs is deleted', async () => {
      const projectId = await setUpOrgProject();
      github.removePermission(REPO, gh(READER));

      await deliver('repository', repositoryEvent('privatized')).expect(202);
      expect(binding().status).toBe('ENABLED'); // solo encola
      await runJobs();

      expect(recordsOf()).toEqual([`${OWNER}:ADMIN`, `${WRITER}:MAINTAINER`]);
      await projectAs(READER, projectId).expect(404);
    });

    it('organization.renamed updates the stored login shown as the workspace of the projects', async () => {
      const projectId = await setUpOrgProject();

      await deliver('organization', { action: 'renamed', changes: { login: { from: ORG } }, organization: { id: Number(ORG_ID), login: 'acme-renamed' } }).expect(202);

      expect((await projectAs(OWNER, projectId).expect(200)).body.workspace).toMatchObject({ id: ORG_ID, login: 'acme-renamed' });
    });

    it('organization.deleted: the projects are hidden from EVERYONE (Admin included) and kept with the binding REVOKED', async () => {
      const projectId = await setUpOrgProject();
      github.removeOrganization(ORG);

      await deliver('organization', { action: 'deleted', organization: { id: Number(ORG_ID), login: ORG } }).expect(202);

      expect(binding().status).toBe('REVOKED');
      expect(recordsOf()).toEqual([]);
      expect(prisma.tables.project).toHaveLength(1); // Project y evidencia conservados
      for (const userId of [OWNER, WRITER, READER]) {
        await projectAs(userId, projectId).expect(404);
      }
    });

    it('installation.deleted of an ORGANIZATION hides its projects (Admin records too); the organization coming back only gives the Admin the project again', async () => {
      const projectId = await setUpOrgProject();
      const installationId = Number((prisma.tables.repositoryBinding[0] as { installationId: string }).installationId);
      github.removeOrganization(ORG);

      await deliver('installation', { action: 'deleted', installation: { id: installationId, account: { id: Number(ORG_ID), type: 'Organization' } } }).expect(202);

      expect(binding().status).toBe('REVOKED');
      expect(recordsOf()).toEqual([]);
      await projectAs(OWNER, projectId).expect(404);

      // Reinstalada: el acceso se recrea al entrar, con el binding REVOKED hasta que un Admin lo reactive.
      github.addOrganization({ installationId: 'inst-42', organizationId: ORG_ID, organizationLogin: ORG, avatarUrl: null, suspended: false });
      await projectAs(WRITER, projectId).expect(404); // Maintainer/Reader no ven un binding REVOKED
      expect((await projectAs(OWNER, projectId).expect(200)).body.role).toBe('ADMIN');
      await authedRequest(app, OWNER).post(`/projects/${projectId}/integrations/github/enable`).expect(200);
      await projectAs(WRITER, projectId).expect(200);
    });

    it('GitHub down: the record is kept (still served), the job is rescheduled with backoff, and a recovered GitHub applies the loss', async () => {
      const projectId = await setUpOrgProject();
      github.removePermission(REPO, gh(WRITER));
      github.permissionMode = 'UNVERIFIABLE';

      await deliver('member', memberEvent('removed', WRITER)).expect(202);
      await runJobs();

      expect(recordsOf()).toContain(`${WRITER}:MAINTAINER`);
      await projectAs(WRITER, projectId).expect(200); // conserva lo existente
      expect(queue.jobs[0]).toMatchObject({ status: 'PENDING', attempts: 0 });

      github.permissionMode = 'NORMAL';
      queue.advance(60_000);
      await runJobs();

      expect(recordsOf()).not.toContain(`${WRITER}:MAINTAINER`);
      await projectAs(WRITER, projectId).expect(404);
      expect(queue.jobs.every((job) => job.status === 'COMPLETED')).toBe(true);
    });

    it('an access event for a user with no Core account, or for a repository not bound to a project, is accepted and enqueues nothing', async () => {
      await setUpOrgProject();

      await deliver('member', { action: 'removed', member: { id: 999_999 }, repository: { id: 777 } }).expect(202);
      await deliver('team', { action: 'edited', repository: { id: 777 }, organization: { id: 999 } }).expect(202);

      expect(queue.jobs).toHaveLength(0);
    });
  });

  describe('hourly reconciliation parts (a) and (b) through the real handler', () => {
    it('(b) corrects a role that changed WITHOUT an event; (a) hides an organization whose App was uninstalled without an event', async () => {
      const projectId = await setUpOrgProject();
      const handler = app.get(AccessReconciliationJobHandler);

      github.setPermission(REPO, gh(WRITER), 'read'); // p. ej. cambio del permiso base: sin evento fiable
      await handler.run({});
      expect(recordsOf()).toContain(`${WRITER}:READER`);

      github.installationsMode = 'UNVERIFIABLE'; // GitHub caído: no se revoca nada
      await handler.run({});
      expect(recordsOf()).toHaveLength(3);
      github.installationsMode = 'NORMAL';

      github.removeOrganization(ORG); // la App se desinstaló y ningún evento llegó
      await handler.run({});

      expect(recordsOf()).toEqual([]);
      expect(binding().status).toBe('REVOKED');
      await authedRequest(app, OWNER).get(`/projects/${projectId}`).expect(404);
    });
  });
});
