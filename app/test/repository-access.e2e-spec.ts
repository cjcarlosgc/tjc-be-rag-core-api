import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { GITHUB_ACCESS_PORT } from '../src/github-app/github-access.port.js';
import { GithubAppAuthService } from '../src/github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../src/github-app/github-repository-content.service.js';
import { GithubUserRepositoriesService } from '../src/repository-bindings/github/github-user-repositories.service.js';
import { RepositoryBindingsRepository } from '../src/repository-bindings/repository-bindings.repository.js';
import { ProjectsRepository } from '../src/projects/projects.repository.js';
import type { RepositoryBinding } from '../src/generated/prisma/client.js';
import { FakeGithubAccessPort } from './support/fake-github-access.port.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import { authedRequest, e2eGithubUserId, overrideAuthTokenVerifier } from './support/auth-test-support.js';

const CREATOR = 'creator-user';
const CREATOR_GH = e2eGithubUserId(CREATOR);
const STRANGER = 'stranger-user';
const STRANGER_GH = e2eGithubUserId(STRANGER);
const PROJECT_ID = 'project-1';
const OTHER_PROJECT_ID = 'project-2';

class FakePrismaService {}

describe('Repository access and binding validation (HU64, corte 4a, e2e)', () => {
  let app: INestApplication;
  let github: FakeGithubAccessPort;
  let installations: Map<string, string>;
  let bindings: Map<string, RepositoryBinding>;
  const listUserRepositories = vi.fn();
  const listBranches = vi.fn();

  const projectsRepository = {
    findById: (id: string, ownerUserId: string) =>
      Promise.resolve(
        [PROJECT_ID, OTHER_PROJECT_ID].includes(id) && ownerUserId === CREATOR
          ? { id, name: id, ownerUserId, currentVersionId: null, deletedAt: null }
          : null,
      ),
  };

  const bindingsRepository = {
    findByProjectForOwner: (projectId: string, ownerUserId: string) =>
      Promise.resolve(ownerUserId === CREATOR ? (bindings.get(projectId) ?? null) : null),
    findByRepositoryId: (repositoryId: string) =>
      Promise.resolve([...bindings.values()].find((b) => b.repositoryId === repositoryId) ?? null),
    create: (projectId: string, input: Omit<RepositoryBinding, 'id' | 'projectId' | 'status' | 'disabledReason' | 'createdAt' | 'updatedAt'>) => {
      const binding: RepositoryBinding = {
        id: `binding-${projectId}`,
        projectId,
        status: 'ENABLED',
        disabledReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input,
      };
      bindings.set(projectId, binding);
      return Promise.resolve(binding);
    },
    reactivate: (id: string, installationId: string) => {
      const binding = [...bindings.values()].find((b) => b.id === id) as RepositoryBinding;
      const updated = { ...binding, status: 'ENABLED' as const, installationId };
      bindings.set(binding.projectId, updated);
      return Promise.resolve(updated);
    },
  };

  beforeAll(async () => {
    github = new FakeGithubAccessPort();
    installations = new Map();
    bindings = new Map();

    const moduleFixture = await overrideAuthTokenVerifier(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useClass(FakePrismaService)
        .overrideProvider(ObjectStorageService)
        .useClass(FakeObjectStorageService)
        .overrideProvider(ProjectsRepository)
        .useValue(projectsRepository)
        .overrideProvider(RepositoryBindingsRepository)
        .useValue(bindingsRepository)
        .overrideProvider(GITHUB_ACCESS_PORT)
        .useValue(github)
        .overrideProvider(GithubAppAuthService)
        .useValue({
          findInstallationForRepository: (owner: string, repo: string) =>
            Promise.resolve(installations.get(`${owner}/${repo}`) ?? null),
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
    bindings.clear();
    installations.clear();
    installations.set('creator/repo', 'install-1');
    listBranches.mockReset().mockResolvedValue([{ name: 'main', protected: false }]);
    listUserRepositories.mockReset().mockResolvedValue({ items: [], hasNextPage: false });
    github.reset();
    github.addRepository('creator/repo', {
      repositoryId: '100',
      ownerId: CREATOR_GH,
      ownerLogin: 'creator',
      ownerType: 'User',
    });
    github.setPermission('creator/repo', CREATOR_GH, 'admin');
  });

  const bindingBody = { repositoryId: '100', repositoryName: 'creator/repo', integrationBranch: 'main' };
  const post = (projectId = PROJECT_ID, user = CREATOR) =>
    authedRequest(app, user).post(`/projects/${projectId}/integrations/github`);

  describe('POST /projects/{id}/integrations/github', () => {
    it('binds a repository owned by the creator (201)', async () => {
      const response = await post().send(bindingBody).expect(201);

      expect(response.body).toMatchObject({ projectId: PROJECT_ID, repositoryId: '100', status: 'ENABLED' });
    });

    it('answers 404 PROJECT_NOT_FOUND for a project the user does not see, before touching GitHub', async () => {
      const response = await post(PROJECT_ID, STRANGER).send(bindingBody).expect(404);

      expect(response.body.code).toBe('PROJECT_NOT_FOUND');
      expect(github.calls).toEqual([]);
    });

    it('answers 403 GITHUB_APP_ACCESS_REQUIRED when the App is not installed, before any owner or permission read', async () => {
      installations.clear();

      const response = await post().send(bindingBody).expect(403);

      expect(response.body.code).toBe('GITHUB_APP_ACCESS_REQUIRED');
      expect(github.calls).toEqual([]);
    });

    describe('a repository of another account (the stranger has write on it)', () => {
      beforeEach(() => {
        installations.set('someone/private', 'install-2');
        github.addRepository('someone/private', {
          repositoryId: '200',
          ownerId: '999999',
          ownerLogin: 'someone',
          ownerType: 'User',
        });
      });

      const foreign = { repositoryId: '200', repositoryName: 'someone/private', integrationBranch: 'main' };

      it('answers 404 GITHUB_REPOSITORY_NOT_FOUND when the creator has no permission at all, before REPOSITORY_OUTSIDE_WORKSPACE', async () => {
        const response = await post().send(foreign).expect(404);

        expect(response.body).toMatchObject({ statusCode: 404, code: 'GITHUB_REPOSITORY_NOT_FOUND' });
      });

      it('answers 400 REPOSITORY_OUTSIDE_WORKSPACE when the creator has write on it but does not own it', async () => {
        github.setPermission('someone/private', CREATOR_GH, 'write');

        const response = await post().send(foreign).expect(400);

        expect(response.body).toMatchObject({ statusCode: 400, code: 'REPOSITORY_OUTSIDE_WORKSPACE' });
        expect(bindings.size).toBe(0);
      });

      it('does not let a stranger probe whether the repository is bound: 404 without permission, 400 with it, never 409', async () => {
        // El repositorio ajeno ya está vinculado a otro Project (del propio creador aquí, para poder consultarlo).
        bindings.set(OTHER_PROJECT_ID, {
          id: 'binding-x',
          projectId: OTHER_PROJECT_ID,
          installationId: 'install-2',
          repositoryId: '200',
          repositoryName: 'someone/private',
          integrationBranch: 'main',
          status: 'ENABLED',
          disabledReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const noPermission = await post().send(foreign).expect(404);
        github.setPermission('someone/private', CREATOR_GH, 'admin');
        const notOwner = await post().send(foreign).expect(400);

        expect(noPermission.body.code).toBe('GITHUB_REPOSITORY_NOT_FOUND');
        expect(notOwner.body.code).toBe('REPOSITORY_OUTSIDE_WORKSPACE');
      });
    });

    it('answers 403 REPOSITORY_PERMISSION_INSUFFICIENT when the owner only has read (defensive; GitHub gives owners admin)', async () => {
      github.setPermission('creator/repo', CREATOR_GH, 'read');

      const response = await post().send(bindingBody).expect(403);

      expect(response.body.code).toBe('REPOSITORY_PERMISSION_INSUFFICIENT');
    });

    it('answers 409 REPOSITORY_ALREADY_BOUND only after the owner and permission validations pass', async () => {
      await post().send(bindingBody).expect(201);

      const response = await post(OTHER_PROJECT_ID).send(bindingBody).expect(409);

      expect(response.body.code).toBe('REPOSITORY_ALREADY_BOUND');
    });

    it('answers 503 GITHUB_VERIFICATION_UNAVAILABLE and persists nothing when the permission is unverifiable', async () => {
      github.permissionMode = 'UNVERIFIABLE';

      const response = await post().send(bindingBody).expect(503);

      expect(response.body).toMatchObject({ statusCode: 503, code: 'GITHUB_VERIFICATION_UNAVAILABLE' });
      expect(bindings.size).toBe(0);
    });

    it('rejects a mismatched client repositoryId with 404 GITHUB_REPOSITORY_NOT_FOUND', async () => {
      const response = await post().send({ ...bindingBody, repositoryId: '1' }).expect(404);

      expect(response.body.code).toBe('GITHUB_REPOSITORY_NOT_FOUND');
    });
  });

  describe('POST /projects/{id}/integrations/github/enable on a REVOKED binding', () => {
    const revoked = (): RepositoryBinding => ({
      id: 'binding-revoked',
      projectId: PROJECT_ID,
      installationId: 'install-1',
      repositoryId: '100',
      repositoryName: 'creator/repo',
      integrationBranch: 'main',
      status: 'REVOKED',
      disabledReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const enable = () => authedRequest(app, CREATOR).post(`/projects/${PROJECT_ID}/integrations/github/enable`);

    it('reactivates it when the App recovered access and the repositoryId and owner still match', async () => {
      bindings.set(PROJECT_ID, revoked());

      const response = await enable().expect(200);

      expect(response.body.status).toBe('ENABLED');
    });

    it('answers 404 GITHUB_REPOSITORY_NOT_FOUND when the repository was recreated with another id, and stays REVOKED', async () => {
      bindings.set(PROJECT_ID, revoked());
      github.addRepository('creator/repo', { repositoryId: '101', ownerId: CREATOR_GH, ownerLogin: 'creator', ownerType: 'User' });

      const response = await enable().expect(404);

      expect(response.body.code).toBe('GITHUB_REPOSITORY_NOT_FOUND');
      expect(bindings.get(PROJECT_ID)?.status).toBe('REVOKED');
    });

    it('answers 400 REPOSITORY_OUTSIDE_WORKSPACE when the repository was transferred away, and stays REVOKED', async () => {
      bindings.set(PROJECT_ID, revoked());
      github.addRepository('creator/repo', { repositoryId: '100', ownerId: '999999', ownerLogin: 'new-owner', ownerType: 'User' });

      const response = await enable().expect(400);

      expect(response.body.code).toBe('REPOSITORY_OUTSIDE_WORKSPACE');
      expect(bindings.get(PROJECT_ID)?.status).toBe('REVOKED');
    });

    it('answers 403 GITHUB_APP_ACCESS_REQUIRED and stays REVOKED while the App has no access', async () => {
      bindings.set(PROJECT_ID, revoked());
      installations.clear();

      const response = await enable().expect(403);

      expect(response.body.code).toBe('GITHUB_APP_ACCESS_REQUIRED');
      expect(bindings.get(PROJECT_ID)?.status).toBe('REVOKED');
    });
  });

  describe('POST /integrations/github/repositories/verify-app-access', () => {
    const verify = (user = CREATOR) =>
      authedRequest(app, user)
        .post('/integrations/github/repositories/verify-app-access')
        .send({ repositoryId: '100', repositoryName: 'creator/repo' });

    it('AUTHORIZED with the installation for a user with admin/maintain/write', async () => {
      const response = await verify().expect(201);

      expect(response.body).toMatchObject({ status: 'AUTHORIZED', installationId: 'install-1' });
    });

    it('403 REPOSITORY_PERMISSION_INSUFFICIENT for a Reader-level user (read)', async () => {
      github.setPermission('creator/repo', STRANGER_GH, 'read');

      const response = await verify(STRANGER).expect(403);

      expect(response.body.code).toBe('REPOSITORY_PERMISSION_INSUFFICIENT');
    });

    it('NOT_AUTHORIZED, without revealing the installation, for a user with no permission', async () => {
      const response = await verify(STRANGER).expect(201);

      expect(response.body).toMatchObject({ status: 'NOT_AUTHORIZED', installationId: null });
    });

    it('NOT_AUTHORIZED when the App is not installed', async () => {
      installations.clear();

      const response = await verify().expect(201);

      expect(response.body).toMatchObject({ status: 'NOT_AUTHORIZED', installationId: null });
    });

    it('503 GITHUB_VERIFICATION_UNAVAILABLE, never NOT_AUTHORIZED, when the permission is unverifiable', async () => {
      github.permissionMode = 'UNVERIFIABLE';

      const response = await verify().expect(503);

      expect(response.body.code).toBe('GITHUB_VERIFICATION_UNAVAILABLE');
    });
  });

  describe('GET /integrations/github/repositories/{owner}/{repo}/branches', () => {
    const branches = (user = CREATOR) =>
      authedRequest(app, user).get('/integrations/github/repositories/creator/repo/branches');

    it('lists the branches for a user with maintain/write/admin', async () => {
      const response = await branches().expect(200);

      expect(response.body).toEqual({ items: [{ name: 'main', protected: false }] });
    });

    it('403 GITHUB_APP_ACCESS_REQUIRED first when the App is not installed', async () => {
      installations.clear();

      const response = await branches().expect(403);

      expect(response.body.code).toBe('GITHUB_APP_ACCESS_REQUIRED');
    });

    it('404 GITHUB_REPOSITORY_NOT_FOUND for a user without visibility of the repository', async () => {
      const response = await branches(STRANGER).expect(404);

      expect(response.body.code).toBe('GITHUB_REPOSITORY_NOT_FOUND');
      expect(listBranches).not.toHaveBeenCalled();
    });

    it('403 REPOSITORY_PERMISSION_INSUFFICIENT for read or triage', async () => {
      github.setPermission('creator/repo', STRANGER_GH, 'triage');

      const response = await branches(STRANGER).expect(403);

      expect(response.body.code).toBe('REPOSITORY_PERMISSION_INSUFFICIENT');
    });

    it('503 GITHUB_VERIFICATION_UNAVAILABLE, never 404 nor 403, when the permission is unverifiable', async () => {
      github.permissionMode = 'UNVERIFIABLE';

      const response = await branches().expect(503);

      expect(response.body.code).toBe('GITHUB_VERIFICATION_UNAVAILABLE');
    });
  });

  describe('GET /integrations/github/repositories?workspaceId', () => {
    const discover = (query: Record<string, string> = {}, user = CREATOR) =>
      authedRequest(app, user).get('/integrations/github/repositories').set('X-GitHub-Provider-Token', 'gho_x').query(query);

    it('accepts the personal workspace (the GitHub id of the session) and filters to owned repositories', async () => {
      await discover({ workspaceId: CREATOR_GH }).expect(200);

      expect(listUserRepositories).toHaveBeenCalledWith('gho_x', 1, 30, { personalOwnerId: CREATOR_GH });
    });

    it('answers 404 WORKSPACE_NOT_FOUND for the workspace of an organization or of another user', async () => {
      const organization = await discover({ workspaceId: '424242' }).expect(404);
      const anotherUser = await discover({ workspaceId: STRANGER_GH }).expect(404);

      expect(organization.body).toMatchObject({ statusCode: 404, code: 'WORKSPACE_NOT_FOUND' });
      expect(anotherUser.body.code).toBe('WORKSPACE_NOT_FOUND');
      expect(listUserRepositories).not.toHaveBeenCalled();
    });

    it('does not filter without a workspace (compatibility)', async () => {
      await discover().expect(200);

      expect(listUserRepositories).toHaveBeenCalledWith('gho_x', 1, 30, undefined);
    });

    it('rejects undeclared query fields with 400', async () => {
      await discover({ bogus: '1' }).expect(400);
    });
  });
});
