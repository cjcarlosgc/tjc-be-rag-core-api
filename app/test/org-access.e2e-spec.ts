import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { GITHUB_ACCESS_PORT } from '../src/github-app/github-access.port.js';
import { GithubAppAuthService } from '../src/github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../src/github-app/github-repository-content.service.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { GithubUserRepositoriesService } from '../src/repository-bindings/github/github-user-repositories.service.js';
import { FakeGithubAccessPort } from './support/fake-github-access.port.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import { InMemoryPrisma } from './support/in-memory-prisma.js';
import { authedRequest, e2eGithubUserId, overrideAuthTokenVerifier } from './support/auth-test-support.js';

/**
 * 014, corte 3 (etapa 2a): acceso derivado de GitHub a Projects de organización, por HTTP y
 * con fakes de `GithubAccessPort` y `SupabaseIdentityPort`. La matriz ruta x rol completa y
 * el guard default-deny son de la etapa 2b; aquí se cubren las rutas migradas al predicado.
 */
const ORG_ID = '42';
const ORG = 'acme';
const REPO = 'acme/widgets';

const OWNER = 'org-owner';
const WRITER = 'org-writer';
const READER = 'org-reader';
const EXTERNAL = 'org-external';
const STRANGER = 'org-stranger';
const PERSONAL = 'org-personal';
const gh = e2eGithubUserId;

describe('Organization access (HU59, HU60, HU63, HU64, corte 3 etapa 2a, e2e)', () => {
  let app: INestApplication;
  let github: FakeGithubAccessPort;
  const prisma = new InMemoryPrisma();
  const listUserRepositories = vi.fn();
  const listBranches = vi.fn();

  beforeAll(async () => {
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
          findInstallationForRepository: (owner: string, repo: string) =>
            Promise.resolve(`${owner}/${repo}` === REPO ? 'inst-42' : null),
          getInstallationToken: () => Promise.resolve('installation-token'),
          getAppInfo: () => Promise.resolve({ slug: 'tjc-core', name: 'TJC Core' }),
        })
        .overrideProvider(GithubRepositoryContentService)
        .useValue({ listBranches })
        .overrideProvider(GithubUserRepositoriesService)
        .useValue({ list: listUserRepositories }),
    ).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    github.reset();
    listBranches.mockReset().mockResolvedValue([{ name: 'main', protected: false }]);
    listUserRepositories.mockReset().mockResolvedValue({ items: [], hasNextPage: false });
    github.addOrganization({
      installationId: 'inst-42',
      organizationId: ORG_ID,
      organizationLogin: ORG,
      avatarUrl: null,
      suspended: false,
    });
    github
      .setMembership(ORG, gh(OWNER), { role: 'admin', state: 'active' })
      .setMembership(ORG, gh(WRITER), { role: 'member', state: 'active' })
      .setMembership(ORG, gh(READER), { role: 'member', state: 'active' })
      .addRepository(REPO, { repositoryId: '100', ownerId: ORG_ID, ownerLogin: ORG, ownerType: 'Organization' })
      .setPermission(REPO, gh(OWNER), 'admin')
      .setPermission(REPO, gh(WRITER), 'write')
      .setPermission(REPO, gh(READER), 'read')
      // Colaborador externo: NO es miembro de la organización pero tiene `write`.
      .setPermission(REPO, gh(EXTERNAL), 'write');
  });

  const createOrgProject = async (name = 'team-project') =>
    (await authedRequest(app, OWNER).post('/projects').send({ name, workspaceId: ORG_ID }).expect(201)).body as {
      id: string;
      role: string;
      workspace: { kind: string; id: string; login: string };
    };

  const bindRepository = (projectId: string, user = OWNER) =>
    authedRequest(app, user)
      .post(`/projects/${projectId}/integrations/github`)
      .send({ repositoryId: '100', repositoryName: REPO, integrationBranch: 'main' });

  /** Project de organización con repositorio vinculado por su owner. */
  const createBoundProject = async () => {
    const project = await createOrgProject();
    await bindRepository(project.id).expect(201);
    return project;
  };

  const bindingRow = () => prisma.tables.repositoryBinding[0] as { status: string };

  describe('creating projects in an organization (HU63)', () => {
    it('lets an owner create it: ADMIN, organization workspace with the live login, and the ADMIN record in the same transaction', async () => {
      const project = await createOrgProject();

      expect(project).toMatchObject({ role: 'ADMIN', workspace: { kind: 'ORGANIZATION', id: ORG_ID, login: ORG } });
      expect(prisma.tables.projectAccess).toEqual([
        expect.objectContaining({ projectId: project.id, userId: OWNER, role: 'ADMIN' }),
      ]);
    });

    it('answers 403 WORKSPACE_ADMIN_REQUIRED to an active member who is not an owner, and creates nothing', async () => {
      const response = await authedRequest(app, WRITER).post('/projects').send({ name: 'x', workspaceId: ORG_ID }).expect(403);

      expect(response.body.code).toBe('WORKSPACE_ADMIN_REQUIRED');
      expect(prisma.tables.project).toHaveLength(0);
    });

    it.each([
      ['a non-member', STRANGER],
      ['an external collaborator with write', EXTERNAL],
    ])('answers 404 WORKSPACE_NOT_FOUND to %s', async (_label, user) => {
      const response = await authedRequest(app, user).post('/projects').send({ name: 'x', workspaceId: ORG_ID }).expect(404);

      expect(response.body.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('answers 404 WORKSPACE_NOT_FOUND when the App is not installed in the organization', async () => {
      github.removeOrganization(ORG);

      const response = await authedRequest(app, OWNER).post('/projects').send({ name: 'x', workspaceId: ORG_ID }).expect(404);

      expect(response.body.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('answers 503 GITHUB_VERIFICATION_UNAVAILABLE, and creates nothing, when GitHub cannot verify the ownership', async () => {
      github.installationsMode = 'UNVERIFIABLE';

      const response = await authedRequest(app, OWNER).post('/projects').send({ name: 'x', workspaceId: ORG_ID }).expect(503);

      expect(response.body.code).toBe('GITHUB_VERIFICATION_UNAVAILABLE');
      expect(prisma.tables.project).toHaveLength(0);
    });

    it('a personal project needs no GitHub and creates no access record', async () => {
      github.installationsMode = 'UNVERIFIABLE';

      const response = await authedRequest(app, PERSONAL).post('/projects').send({ name: 'mine' }).expect(201);

      expect(response.body).toMatchObject({ role: 'ADMIN', workspace: { kind: 'PERSONAL' } });
      expect(prisma.tables.projectAccess).toHaveLength(0);
      expect(github.calls).toEqual([]);
    });
  });

  describe('visibility of a new organization project', () => {
    it('is visible only to owners while it has no repository: a member gets 404 and GET /projects omits it', async () => {
      const project = await createOrgProject();

      await authedRequest(app, OWNER).get(`/projects/${project.id}`).expect(200);
      const hidden = await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(404);
      expect(hidden.body.code).toBe('PROJECT_NOT_FOUND');
      const list = await authedRequest(app, WRITER).get('/projects').expect(200);
      expect(list.body.items).toEqual([]);
    });

    it('another owner enters by live verification and gets ADMIN', async () => {
      const project = await createOrgProject();
      github.setMembership(ORG, gh('second-owner'), { role: 'admin', state: 'active' });

      const response = await authedRequest(app, 'second-owner').get(`/projects/${project.id}`).expect(200);

      expect(response.body.role).toBe('ADMIN');
      expect(prisma.tables.projectAccess).toHaveLength(2);
    });
  });

  describe('entry by live verification and derived roles (HU59, HU60)', () => {
    it('registers Maintainer for write and Reader for read on first access, exposing the role in ProjectResponse', async () => {
      const project = await createBoundProject();

      const writer = await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);
      const reader = await authedRequest(app, READER).get(`/projects/${project.id}`).expect(200);

      expect(writer.body).toMatchObject({ role: 'MAINTAINER', workspace: { kind: 'ORGANIZATION', id: ORG_ID } });
      expect(reader.body.role).toBe('READER');
      expect(prisma.tables.projectAccess.map((row) => [row.userId, row.role]).sort()).toEqual(
        [
          [OWNER, 'ADMIN'],
          [WRITER, 'MAINTAINER'],
          [READER, 'READER'],
        ].sort(),
      );
    });

    it.each([
      ['an external collaborator with write (private, internal or public repository)', EXTERNAL],
      ['a user outside the organization with no permission', STRANGER],
    ])('answers 404 PROJECT_NOT_FOUND to %s on every route of the project', async (_label, user) => {
      const project = await createBoundProject();

      for (const path of [
        `/projects/${project.id}`,
        `/projects/${project.id}/integrations/github`,
        `/projects/${project.id}/versions`,
        `/projects/${project.id}/analysis-runs`,
        `/projects/${project.id}/functional-knowledge`,
      ]) {
        const response = await authedRequest(app, user).get(path).expect(404);
        expect(response.body.code).toBe('PROJECT_NOT_FOUND');
      }
      expect(prisma.tables.projectAccess.some((row) => row.userId === user)).toBe(false);
    });

    it('a personal project is invisible (404) to a collaborator of its repository and absent from their GET /projects', async () => {
      const own = await authedRequest(app, PERSONAL).post('/projects').send({ name: 'private-work' }).expect(201);

      await authedRequest(app, WRITER).get(`/projects/${own.body.id}`).expect(404);
      const list = await authedRequest(app, WRITER).get('/projects').expect(200);
      expect(list.body.items.map((item: { id: string }) => item.id)).not.toContain(own.body.id);
    });
  });

  describe('roles: PATCH and DELETE only Admin (HU63); binding operations Maintainer (HU60)', () => {
    it('PATCH renames as Admin (200) and answers 403 PROJECT_ROLE_INSUFFICIENT with details to Maintainer and Reader', async () => {
      const project = await createBoundProject();
      await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);
      await authedRequest(app, READER).get(`/projects/${project.id}`).expect(200);

      const forbidden = await authedRequest(app, WRITER).patch(`/projects/${project.id}`).send({ name: 'hijack' }).expect(403);
      expect(forbidden.body).toMatchObject({
        code: 'PROJECT_ROLE_INSUFFICIENT',
        details: { requiredRole: 'ADMIN', currentRole: 'MAINTAINER' },
      });
      const readerForbidden = await authedRequest(app, READER).patch(`/projects/${project.id}`).send({ name: 'x' }).expect(403);
      expect(readerForbidden.body.details).toEqual({ requiredRole: 'ADMIN', currentRole: 'READER' });

      const renamed = await authedRequest(app, OWNER).patch(`/projects/${project.id}`).send({ name: '  Renamed  ' }).expect(200);
      expect(renamed.body).toMatchObject({ id: project.id, name: 'Renamed', role: 'ADMIN' });
    });

    it('PATCH validates the body: empty or blank name and undeclared fields are 400; a hidden project is 404 before anything else', async () => {
      const project = await createOrgProject();

      await authedRequest(app, OWNER).patch(`/projects/${project.id}`).send({ name: '' }).expect(400);
      await authedRequest(app, OWNER).patch(`/projects/${project.id}`).send({ name: '   ' }).expect(400);
      await authedRequest(app, OWNER).patch(`/projects/${project.id}`).send({ name: 'ok', workspaceId: '1' }).expect(400);
      await authedRequest(app, WRITER).patch(`/projects/${project.id}`).send({ name: 'x' }).expect(404);
    });

    it('DELETE is Admin only: Reader 403, Admin 204, then 404 for everyone (including the registered Reader)', async () => {
      const project = await createBoundProject();
      await authedRequest(app, READER).get(`/projects/${project.id}`).expect(200);

      const forbidden = await authedRequest(app, READER).delete(`/projects/${project.id}`).expect(403);
      expect(forbidden.body.code).toBe('PROJECT_ROLE_INSUFFICIENT');
      await authedRequest(app, OWNER).delete(`/projects/${project.id}`).expect(204);
      await authedRequest(app, OWNER).get(`/projects/${project.id}`).expect(404);
      await authedRequest(app, READER).get(`/projects/${project.id}`).expect(404);
      await authedRequest(app, OWNER).delete(`/projects/${project.id}`).expect(404);
    });

    it('a Reader reads the binding (GET) but cannot POST, pause or enable it (403); a Maintainer can pause and enable', async () => {
      const project = await createBoundProject();
      await authedRequest(app, READER).get(`/projects/${project.id}`).expect(200);
      await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);

      await authedRequest(app, READER).get(`/projects/${project.id}/integrations/github`).expect(200);
      for (const call of [
        () => bindRepository(project.id, READER),
        () => authedRequest(app, READER).delete(`/projects/${project.id}/integrations/github`),
        () => authedRequest(app, READER).post(`/projects/${project.id}/integrations/github/enable`),
      ]) {
        expect((await call().expect(403)).body.code).toBe('PROJECT_ROLE_INSUFFICIENT');
      }

      await authedRequest(app, WRITER).delete(`/projects/${project.id}/integrations/github`).expect(204);
      expect(bindingRow().status).toBe('DISABLED');
      await authedRequest(app, WRITER).post(`/projects/${project.id}/integrations/github/enable`).expect(200);
      expect(bindingRow().status).toBe('ENABLED');
    });
  });

  describe('binding in an organization (HU64, 4b)', () => {
    it('the owner binds a repository of the organization; a repository of another owner is 400 REPOSITORY_OUTSIDE_WORKSPACE', async () => {
      const project = await createOrgProject();
      github.addRepository(REPO, { repositoryId: '100', ownerId: '999', ownerLogin: 'elsewhere', ownerType: 'Organization' });

      const outside = await bindRepository(project.id).expect(400);
      expect(outside.body.code).toBe('REPOSITORY_OUTSIDE_WORKSPACE');

      github.addRepository(REPO, { repositoryId: '100', ownerId: ORG_ID, ownerLogin: ORG, ownerType: 'Organization' });
      await bindRepository(project.id).expect(201);
    });

    it('a Maintainer who is not an Admin cannot bind a project without repository: it is invisible to them (404)', async () => {
      const project = await createOrgProject();

      const response = await bindRepository(project.id, WRITER).expect(404);

      expect(response.body.code).toBe('PROJECT_NOT_FOUND');
    });

    it('REVOKED binding: hidden (404) for Maintainer and Reader even though their records remain; the Admin sees and reactivates it', async () => {
      const project = await createBoundProject();
      await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);
      await authedRequest(app, READER).get(`/projects/${project.id}`).expect(200);
      bindingRow().status = 'REVOKED';

      expect(prisma.tables.projectAccess.some((row) => row.userId === WRITER)).toBe(true);
      await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(404);
      await authedRequest(app, READER).get(`/projects/${project.id}/integrations/github`).expect(404);
      await authedRequest(app, WRITER).post(`/projects/${project.id}/integrations/github/enable`).expect(404);
      const list = await authedRequest(app, WRITER).get('/projects').expect(200);
      expect(list.body.items).toEqual([]);

      await authedRequest(app, OWNER).get(`/projects/${project.id}`).expect(200);
      await authedRequest(app, OWNER).post(`/projects/${project.id}/integrations/github/enable`).expect(200);
      expect(bindingRow().status).toBe('ENABLED');
      await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);
    });

    it('enable on REVOKED keeps it REVOKED with 400 when the repository left the organization and 404 when it was recreated', async () => {
      const project = await createBoundProject();
      bindingRow().status = 'REVOKED';

      github.addRepository(REPO, { repositoryId: '100', ownerId: '999', ownerLogin: 'elsewhere', ownerType: 'Organization' });
      expect((await authedRequest(app, OWNER).post(`/projects/${project.id}/integrations/github/enable`).expect(400)).body.code).toBe(
        'REPOSITORY_OUTSIDE_WORKSPACE',
      );

      github.addRepository(REPO, { repositoryId: '555', ownerId: ORG_ID, ownerLogin: ORG, ownerType: 'Organization' });
      expect((await authedRequest(app, OWNER).post(`/projects/${project.id}/integrations/github/enable`).expect(404)).body.code).toBe(
        'GITHUB_REPOSITORY_NOT_FOUND',
      );
      expect(bindingRow().status).toBe('REVOKED');
    });

    it('discovery with an organization workspaceId lists only that organization; non-members get 404 and unverifiable memberships 503', async () => {
      await authedRequest(app, WRITER)
        .get('/integrations/github/repositories')
        .set('X-GitHub-Provider-Token', 'token')
        .query({ workspaceId: ORG_ID })
        .expect(200);
      expect(listUserRepositories).toHaveBeenCalledWith('token', 1, 30, { organizationOwnerId: ORG_ID });

      const notMember = await authedRequest(app, STRANGER)
        .get('/integrations/github/repositories')
        .set('X-GitHub-Provider-Token', 'token')
        .query({ workspaceId: ORG_ID })
        .expect(404);
      expect(notMember.body.code).toBe('WORKSPACE_NOT_FOUND');

      github.setOrganizationMode(ORG, 'UNVERIFIABLE');
      const down = await authedRequest(app, WRITER)
        .get('/integrations/github/repositories')
        .set('X-GitHub-Provider-Token', 'token')
        .query({ workspaceId: ORG_ID })
        .expect(503);
      expect(down.body.code).toBe('GITHUB_VERIFICATION_UNAVAILABLE');
    });
  });

  describe('listings (HU55, HU58, HU59)', () => {
    it('GET /projects verifies the not-yet-seen organization projects and lists personal ones together with the organization ones', async () => {
      const project = await createBoundProject();
      await authedRequest(app, WRITER).post('/projects').send({ name: 'writer-personal' }).expect(201);
      await authedRequest(app, PERSONAL).post('/projects').send({ name: 'someone-elses' }).expect(201);

      const list = await authedRequest(app, WRITER).get('/projects').expect(200);

      expect(list.body.items.map((item: { name: string; role: string }) => [item.name, item.role]).sort()).toEqual(
        [
          ['team-project', 'MAINTAINER'],
          ['writer-personal', 'ADMIN'],
        ].sort(),
      );
      expect(prisma.tables.projectAccess.some((row) => row.userId === WRITER && row.projectId === project.id)).toBe(true);
    });

    it('GET /projects?workspaceId filters by workspace: the organization, the personal one, and 404 for a foreign id', async () => {
      await createBoundProject();
      await authedRequest(app, OWNER).post('/projects').send({ name: 'owner-personal' }).expect(201);

      const organization = await authedRequest(app, OWNER).get('/projects').query({ workspaceId: ORG_ID }).expect(200);
      const personal = await authedRequest(app, OWNER).get('/projects').query({ workspaceId: gh(OWNER) }).expect(200);
      const foreign = await authedRequest(app, OWNER).get('/projects').query({ workspaceId: '4242' }).expect(404);

      expect(organization.body.items.map((item: { name: string }) => item.name)).toEqual(['team-project']);
      expect(personal.body.items.map((item: { name: string }) => item.name)).toEqual(['owner-personal']);
      expect(foreign.body.code).toBe('WORKSPACE_NOT_FOUND');
      await authedRequest(app, STRANGER).get('/projects').query({ workspaceId: ORG_ID }).expect(404);
    });

    it('GET /analysis-runs (cross-project) covers the personal projects plus the organization projects with an access record', async () => {
      const project = await createBoundProject();
      const personal = await authedRequest(app, WRITER).post('/projects').send({ name: 'writer-personal' }).expect(201);
      const other = await authedRequest(app, PERSONAL).post('/projects').send({ name: 'other' }).expect(201);
      const hidden = await createOrgProject('bare-org-project');
      await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);
      for (const [id, projectId] of [
        ['run-org', project.id],
        ['run-personal', personal.body.id],
        ['run-other', other.body.id],
        ['run-hidden', hidden.id],
      ]) {
        prisma.insert('analysisRun', {
          id,
          projectId,
          repositoryId: '100',
          repositoryName: REPO,
          prNumber: 1,
          prTitle: 't',
          baseRef: 'main',
          headRef: 'f',
          baseSha: 'a',
          headSha: 'b',
          draft: false,
          prState: 'OPEN',
          actorLogin: null,
          status: 'QUEUED',
          current: true,
          actionRequiredCount: 0,
          generatedTestsCount: 0,
          completedAt: null,
        });
      }

      const runs = await authedRequest(app, WRITER).get('/analysis-runs').expect(200);

      expect(runs.body.items.map((run: { id: string }) => run.id).sort()).toEqual(['run-org', 'run-personal']);
      // Un Reader sin registro aún no ve nada del cross-proyecto (no se verifica en este listado).
      const strangerRuns = await authedRequest(app, READER).get('/analysis-runs').expect(200);
      expect(strangerRuns.body.items).toEqual([]);
    });

    it('GET /action-required?projectId of a project the user cannot see answers 404 PROJECT_NOT_FOUND; without projectId it lists visible ones', async () => {
      const project = await createBoundProject();
      const personal = await authedRequest(app, PERSONAL).post('/projects').send({ name: 'other' }).expect(201);

      const hiddenOrg = await authedRequest(app, STRANGER).get('/action-required').query({ projectId: project.id }).expect(404);
      const hiddenPersonal = await authedRequest(app, WRITER).get('/action-required').query({ projectId: personal.body.id }).expect(404);
      expect(hiddenOrg.body.code).toBe('PROJECT_NOT_FOUND');
      expect(hiddenPersonal.body.code).toBe('PROJECT_NOT_FOUND');

      await authedRequest(app, WRITER).get('/action-required').query({ projectId: project.id }).expect(200);
      const all = await authedRequest(app, WRITER).get('/action-required').expect(200);
      expect(all.body.items).toEqual([]);
    });
  });

  describe('GitHub down and App uninstalled', () => {
    it('registered access survives a GitHub outage; new access answers 503; GET /projects omits what it cannot verify without failing', async () => {
      const project = await createBoundProject();
      await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);
      github.installationsMode = 'UNVERIFIABLE';
      github.permissionMode = 'UNVERIFIABLE';

      await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);
      const unavailable = await authedRequest(app, READER).get(`/projects/${project.id}`).expect(503);
      expect(unavailable.body.code).toBe('GITHUB_VERIFICATION_UNAVAILABLE');
      const listed = await authedRequest(app, READER).get('/projects').expect(200);
      expect(listed.body.items).toEqual([]);
      const writerList = await authedRequest(app, WRITER).get('/projects').expect(200);
      expect(writerList.body.items.map((item: { id: string }) => item.id)).toEqual([project.id]);
      expect(prisma.tables.projectAccess.some((row) => row.userId === WRITER)).toBe(true);
    });

    it('GET /workspaces with GitHub down returns the personal workspace plus the organizations with registered access', async () => {
      const project = await createBoundProject();
      await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(200);
      github.installationsMode = 'UNVERIFIABLE';

      const writer = await authedRequest(app, WRITER).get('/workspaces').expect(200);
      const stranger = await authedRequest(app, READER).get('/workspaces').expect(200);
      const owner = await authedRequest(app, OWNER).get('/workspaces').expect(200);

      expect(writer.body.items.map((item: { kind: string; id: string; role: string }) => [item.kind, item.role])).toEqual([
        ['PERSONAL', 'ADMIN'],
        ['ORGANIZATION', 'MEMBER'],
      ]);
      expect(writer.body.items[1]).toMatchObject({ id: ORG_ID, login: ORG });
      expect(owner.body.items[1]).toMatchObject({ id: ORG_ID, role: 'ADMIN' });
      // Nunca se ofrece una organización nueva: el Reader aún no tiene registro.
      expect(stranger.body.items).toHaveLength(1);
    });

    it('an uninstalled App hides the organization: it is not offered and its projects answer 404 (not a permanent 503) to new users', async () => {
      const project = await createBoundProject();
      github.removeOrganization(ORG);

      const workspaces = await authedRequest(app, WRITER).get('/workspaces').expect(200);
      expect(workspaces.body.items.map((item: { kind: string }) => item.kind)).toEqual(['PERSONAL']);
      const response = await authedRequest(app, WRITER).get(`/projects/${project.id}`).expect(404);
      expect(response.body.code).toBe('PROJECT_NOT_FOUND');
      await authedRequest(app, WRITER).post('/projects').send({ name: 'x', workspaceId: ORG_ID }).expect(404);
    });
  });
});
