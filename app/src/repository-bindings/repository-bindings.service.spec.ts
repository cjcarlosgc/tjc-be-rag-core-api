import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryBindingsService } from './repository-bindings.service.js';
import { RepositoryBindingsRepository } from './repository-bindings.repository.js';
import { GithubRepositoryAccessService } from './github/github-repository-access.service.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { GITHUB_ACCESS_PORT } from '../github-app/github-access.port.js';
import { GithubAppAuthService, GithubAppUnavailableError } from '../github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../github-app/github-repository-content.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { FakeGithubAccessPort } from '../../test/support/fake-github-access.port.js';
import type { Project, RepositoryBinding } from '../generated/prisma/client.js';

describe('RepositoryBindingsService', () => {
  let service: RepositoryBindingsService;
  let repository: {
    create: ReturnType<typeof vi.fn>;
    findByProjectForOwner: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    reactivate: ReturnType<typeof vi.fn>;
    findByRepositoryId: ReturnType<typeof vi.fn>;
  };
  let projectsRepository: { findById: ReturnType<typeof vi.fn> };
  let githubAppAuthService: {
    findInstallationForRepository: ReturnType<typeof vi.fn>;
    getInstallationToken: ReturnType<typeof vi.fn>;
  };
  let githubRepositoryContentService: { listBranches: ReturnType<typeof vi.fn> };
  let github: FakeGithubAccessPort;

  const OWNER_USER_ID = 'user-1';
  /** `githubUserId` del creador: propietario de `org/repo` salvo que un test diga otra cosa. */
  const CREATOR_GITHUB_ID = '1001';
  const OTHER_GITHUB_ID = '2002';
  const PROJECT_ID = 'project-1';

  const project: Project = {
    id: PROJECT_ID,
    name: 'demo',
    ownerUserId: OWNER_USER_ID,
    currentVersionId: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const binding: RepositoryBinding = {
    id: 'binding-1',
    projectId: PROJECT_ID,
    installationId: 'install-1',
    repositoryId: 'repo-1',
    repositoryName: 'org/repo',
    integrationBranch: 'develop',
    status: 'ENABLED',
    disabledReason: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const ownedByCreator = {
    repositoryId: 'repo-1',
    ownerId: CREATOR_GITHUB_ID,
    ownerLogin: 'creator',
    ownerType: 'User' as const,
  };

  beforeEach(async () => {
    repository = {
      create: vi.fn(),
      findByProjectForOwner: vi.fn(),
      updateStatus: vi.fn(),
      reactivate: vi.fn(),
      findByRepositoryId: vi.fn().mockResolvedValue(null),
    };
    projectsRepository = { findById: vi.fn().mockResolvedValue(project) };
    githubAppAuthService = {
      findInstallationForRepository: vi.fn().mockResolvedValue('install-1'),
      getInstallationToken: vi.fn().mockResolvedValue('token'),
    };
    githubRepositoryContentService = {
      listBranches: vi.fn().mockResolvedValue([{ name: 'main', protected: false }]),
    };
    github = new FakeGithubAccessPort()
      .addRepository('org/repo', ownedByCreator)
      .setPermission('org/repo', CREATOR_GITHUB_ID, 'admin');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryBindingsService,
        GithubRepositoryAccessService,
        { provide: RepositoryBindingsRepository, useValue: repository },
        { provide: ProjectsRepository, useValue: projectsRepository },
        { provide: GithubAppAuthService, useValue: githubAppAuthService },
        { provide: GithubRepositoryContentService, useValue: githubRepositoryContentService },
        { provide: GITHUB_ACCESS_PORT, useValue: github },
      ],
    }).compile();

    service = module.get(RepositoryBindingsService);
  });

  describe('create', () => {
    const input = { repositoryId: 'repo-1', repositoryName: 'org/repo', integrationBranch: 'main' };

    const create = () => service.create(PROJECT_ID, input, OWNER_USER_ID, CREATOR_GITHUB_ID);

    it('resolves the installation, validates the branch and creates the binding', async () => {
      repository.findByProjectForOwner.mockResolvedValue(null);
      repository.create.mockResolvedValue(binding);

      const result = await create();

      expect(githubAppAuthService.findInstallationForRepository).toHaveBeenCalledWith('org', 'repo');
      expect(githubRepositoryContentService.listBranches).toHaveBeenCalledWith('org/repo', 'token');
      expect(repository.create).toHaveBeenCalledWith(PROJECT_ID, {
        installationId: 'install-1',
        repositoryId: 'repo-1',
        repositoryName: 'org/repo',
        integrationBranch: 'main',
      });
      expect(result).toEqual(binding);
    });

    it('throws PROJECT_NOT_FOUND when the project does not belong to the owner', async () => {
      projectsRepository.findById.mockResolvedValue(null);

      await expect(create()).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.PROJECT_NOT_FOUND,
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(github.calls).toEqual([]);
    });

    it('throws REPOSITORY_BINDING_ALREADY_EXISTS when the project already has a binding', async () => {
      repository.findByProjectForOwner.mockResolvedValue(binding);

      await expect(create()).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.REPOSITORY_BINDING_ALREADY_EXISTS,
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('throws INTEGRATION_BRANCH_NOT_FOUND when the chosen branch does not exist', async () => {
      repository.findByProjectForOwner.mockResolvedValue(null);
      githubRepositoryContentService.listBranches.mockResolvedValue([{ name: 'develop', protected: false }]);

      await expect(create()).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.INTEGRATION_BRANCH_NOT_FOUND,
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('answers GITHUB_APP_ACCESS_REQUIRED when the App has no access to the repository', async () => {
      repository.findByProjectForOwner.mockResolvedValue(null);
      githubAppAuthService.findInstallationForRepository.mockResolvedValue(null);

      await expect(create()).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.GITHUB_APP_ACCESS_REQUIRED,
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(github.calls).toEqual([]);
    });
  });

  describe('create — repository conflicts (HU57)', () => {
    const input = { repositoryId: 'repo-1', repositoryName: 'org/repo', integrationBranch: 'main' };
    const create = () => service.create(PROJECT_ID, input, OWNER_USER_ID, CREATOR_GITHUB_ID);

    beforeEach(() => {
      repository.findByProjectForOwner.mockResolvedValue(null);
    });

    it('throws REPOSITORY_ALREADY_BOUND (409) with a generic message when another project uses the repository', async () => {
      repository.findByRepositoryId.mockResolvedValue({ ...binding, projectId: 'other-project' });

      const error = await create().catch((e: AppException) => e);

      expect(error).toMatchObject({ code: ErrorCode.REPOSITORY_ALREADY_BOUND });
      expect((error as AppException).message).not.toContain('other-project');
      expect(repository.create).not.toHaveBeenCalled();
      expect(githubRepositoryContentService.listBranches).not.toHaveBeenCalled();
    });

    it('checks the App access before the repository conflict', async () => {
      githubAppAuthService.findInstallationForRepository.mockResolvedValue(null);
      repository.findByRepositoryId.mockResolvedValue({ ...binding, projectId: 'other-project' });

      await expect(create()).rejects.toMatchObject({ code: ErrorCode.GITHUB_APP_ACCESS_REQUIRED });
    });

    it('checks the repository conflict before the branch', async () => {
      repository.findByRepositoryId.mockResolvedValue({ ...binding, projectId: 'other-project' });
      githubRepositoryContentService.listBranches.mockResolvedValue([]);

      await expect(create()).rejects.toMatchObject({ code: ErrorCode.REPOSITORY_ALREADY_BOUND });
    });

    it('does not trust the client repositoryId: a mismatch with GitHub is GITHUB_REPOSITORY_NOT_FOUND', async () => {
      github.addRepository('org/repo', { ...ownedByCreator, repositoryId: 'real-repo-id' });

      await expect(create()).rejects.toMatchObject({ code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('maps a concurrent unique violation on the repository to REPOSITORY_ALREADY_BOUND, never 500', async () => {
      repository.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(create()).rejects.toMatchObject({ code: ErrorCode.REPOSITORY_ALREADY_BOUND });
    });

    it('maps a concurrent unique violation on the project to REPOSITORY_BINDING_ALREADY_EXISTS', async () => {
      repository.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
      repository.findByProjectForOwner.mockResolvedValueOnce(null).mockResolvedValueOnce(binding);

      await expect(create()).rejects.toMatchObject({ code: ErrorCode.REPOSITORY_BINDING_ALREADY_EXISTS });
    });

    it('rethrows non-unique persistence errors untouched', async () => {
      const boom = new Error('connection lost');
      repository.create.mockRejectedValue(boom);

      await expect(create()).rejects.toBe(boom);
    });
  });

  describe('create — owner and permission validation (HU64, corte 4a)', () => {
    const input = { repositoryId: 'repo-1', repositoryName: 'org/repo', integrationBranch: 'main' };
    const create = (githubUserId = CREATOR_GITHUB_ID) =>
      service.create(PROJECT_ID, input, OWNER_USER_ID, githubUserId);

    beforeEach(() => {
      repository.findByProjectForOwner.mockResolvedValue(null);
      repository.create.mockResolvedValue(binding);
    });

    it('a repository owned by the creator is bound', async () => {
      await expect(create()).resolves.toEqual(binding);
    });

    it('a repository of another account with write permission is REPOSITORY_OUTSIDE_WORKSPACE (400)', async () => {
      github.setPermission('org/repo', OTHER_GITHUB_ID, 'write');

      await expect(create(OTHER_GITHUB_ID)).rejects.toMatchObject({
        code: ErrorCode.REPOSITORY_OUTSIDE_WORKSPACE,
        status: 400,
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('a repository of another account with no permission at all is GITHUB_REPOSITORY_NOT_FOUND, before REPOSITORY_OUTSIDE_WORKSPACE', async () => {
      await expect(create(OTHER_GITHUB_ID)).rejects.toMatchObject({
        code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
        status: 404,
      });
    });

    it('the no-permission 404 is indistinguishable from a repository that does not exist', async () => {
      const noPermission = await create(OTHER_GITHUB_ID).catch((e: AppException) => e);
      github.removeRepository('org/repo');
      const missing = await create(OTHER_GITHUB_ID).catch((e: AppException) => e);

      expect(noPermission).toMatchObject({ code: missing.code, status: missing.status });
    });

    it.each(['read', 'triage'] as const)(
      'permission %s on the repository is REPOSITORY_PERMISSION_INSUFFICIENT (403) once the owner matches',
      async (level) => {
        github.setPermission('org/repo', CREATOR_GITHUB_ID, level);

        await expect(create()).rejects.toMatchObject({
          code: ErrorCode.REPOSITORY_PERMISSION_INSUFFICIENT,
          status: 403,
        });
        expect(repository.create).not.toHaveBeenCalled();
      },
    );

    it.each(['maintain', 'write', 'admin'] as const)('permission %s is sufficient', async (level) => {
      github.setPermission('org/repo', CREATOR_GITHUB_ID, level);

      await expect(create()).resolves.toEqual(binding);
    });

    it('does not probe foreign repositories: the ownership and permission checks come before REPOSITORY_ALREADY_BOUND', async () => {
      repository.findByRepositoryId.mockResolvedValue({ ...binding, projectId: 'other-project' });

      // Sin permiso: 404, sin llegar a saber que el repositorio está vinculado.
      await expect(create(OTHER_GITHUB_ID)).rejects.toMatchObject({ code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND });
      expect(repository.findByRepositoryId).not.toHaveBeenCalled();

      // Con permiso pero ajeno: 400, tampoco llega al conflicto.
      github.setPermission('org/repo', OTHER_GITHUB_ID, 'admin');
      await expect(create(OTHER_GITHUB_ID)).rejects.toMatchObject({ code: ErrorCode.REPOSITORY_OUTSIDE_WORKSPACE });
      expect(repository.findByRepositoryId).not.toHaveBeenCalled();

      // Con permiso insuficiente sobre un repositorio propio: 403.
      github.setPermission('org/repo', CREATOR_GITHUB_ID, 'read');
      await expect(create()).rejects.toMatchObject({ code: ErrorCode.REPOSITORY_PERMISSION_INSUFFICIENT });
      expect(repository.findByRepositoryId).not.toHaveBeenCalled();

      // Solo un dueño con permiso suficiente ve REPOSITORY_ALREADY_BOUND.
      github.setPermission('org/repo', CREATOR_GITHUB_ID, 'admin');
      await expect(create()).rejects.toMatchObject({ code: ErrorCode.REPOSITORY_ALREADY_BOUND });
    });

    it('answers 503 GITHUB_VERIFICATION_UNAVAILABLE, never 404 or an ownership error, when the permission is unverifiable', async () => {
      github.permissionMode = 'UNVERIFIABLE';

      await expect(create()).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        status: 503,
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('answers 503 GITHUB_VERIFICATION_UNAVAILABLE when the repository owner is unverifiable', async () => {
      github.ownerMode = 'UNVERIFIABLE';

      await expect(create()).rejects.toMatchObject({ code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('answers 503 (not 500) when GitHub fails while resolving the installation', async () => {
      githubAppAuthService.findInstallationForRepository.mockRejectedValue(
        new GithubAppUnavailableError('boom', 500),
      );

      await expect(create()).rejects.toMatchObject({ code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE });
    });

    it('answers GITHUB_APP_ACCESS_REQUIRED when the installation disappears between lookups', async () => {
      github.ownerMode = 'NOT_INSTALLED';

      await expect(create()).rejects.toMatchObject({ code: ErrorCode.GITHUB_APP_ACCESS_REQUIRED });
    });

    it('reads the permission of the session GitHub identity, never of another user', async () => {
      await create();

      expect(github.calls.filter((call) => call.method === 'getRepositoryPermission')).toEqual([
        { method: 'getRepositoryPermission', repositoryName: 'org/repo', githubUserId: CREATOR_GITHUB_ID },
      ]);
    });
  });

  describe('project visibility (HU56): PROJECT_NOT_FOUND vs REPOSITORY_BINDING_NOT_FOUND', () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['get', () => service.get(PROJECT_ID, OWNER_USER_ID)],
      ['disable', () => service.disable(PROJECT_ID, OWNER_USER_ID)],
      ['enable', () => service.enable(PROJECT_ID, OWNER_USER_ID, CREATOR_GITHUB_ID)],
    ];

    it.each(cases)('%s answers PROJECT_NOT_FOUND for a deleted, foreign or missing project', async (_name, call) => {
      projectsRepository.findById.mockResolvedValue(null);

      await expect(call()).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.PROJECT_NOT_FOUND,
      });
      expect(repository.findByProjectForOwner).not.toHaveBeenCalled();
    });

    it.each(cases)('%s answers REPOSITORY_BINDING_NOT_FOUND for a live project without binding', async (_name, call) => {
      repository.findByProjectForOwner.mockResolvedValue(null);

      await expect(call()).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.REPOSITORY_BINDING_NOT_FOUND,
      });
      expect(projectsRepository.findById).toHaveBeenCalledWith(PROJECT_ID, OWNER_USER_ID);
    });
  });

  describe('create — concurrent project deletion (HU56)', () => {
    it('propagates PROJECT_NOT_FOUND when the project was deleted while calling GitHub', async () => {
      const input = { repositoryId: 'repo-1', repositoryName: 'org/repo', integrationBranch: 'main' };
      repository.findByProjectForOwner.mockResolvedValue(null);
      const gone = new AppException(ErrorCode.PROJECT_NOT_FOUND, 'gone', 404);
      repository.create.mockRejectedValue(gone);

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID, CREATOR_GITHUB_ID)).rejects.toBe(gone);
    });
  });

  describe('get', () => {
    it('returns the binding scoped by owner', async () => {
      repository.findByProjectForOwner.mockResolvedValue(binding);

      const result = await service.get(PROJECT_ID, OWNER_USER_ID);

      expect(repository.findByProjectForOwner).toHaveBeenCalledWith(PROJECT_ID, OWNER_USER_ID);
      expect(result).toEqual(binding);
    });

    it('throws REPOSITORY_BINDING_NOT_FOUND when there is none', async () => {
      repository.findByProjectForOwner.mockResolvedValue(null);

      await expect(service.get(PROJECT_ID, OWNER_USER_ID)).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.REPOSITORY_BINDING_NOT_FOUND,
      });
    });
  });

  describe('disable', () => {
    it('pauses an ENABLED binding as a user pause (DISABLED, reason USER)', async () => {
      repository.findByProjectForOwner.mockResolvedValue(binding);
      repository.updateStatus.mockResolvedValue({ ...binding, status: 'DISABLED' });

      const result = await service.disable(PROJECT_ID, OWNER_USER_ID);

      expect(repository.updateStatus).toHaveBeenCalledWith(binding.id, 'DISABLED', 'USER');
      expect(result.status).toBe('DISABLED');
    });

    it('never degrades a REVOKED binding to DISABLED', async () => {
      const revoked = { ...binding, status: 'REVOKED' as const };
      repository.findByProjectForOwner.mockResolvedValue(revoked);

      const result = await service.disable(PROJECT_ID, OWNER_USER_ID);

      expect(repository.updateStatus).not.toHaveBeenCalled();
      expect(result).toEqual(revoked);
    });

    it('turns a suspension pause into a user pause so unsuspend will not reactivate it', async () => {
      const suspended = { ...binding, status: 'DISABLED' as const, disabledReason: 'INSTALLATION_SUSPENDED' as const };
      repository.findByProjectForOwner.mockResolvedValue(suspended);
      repository.updateStatus.mockResolvedValue({ ...suspended, disabledReason: 'USER' });

      await service.disable(PROJECT_ID, OWNER_USER_ID);

      expect(repository.updateStatus).toHaveBeenCalledWith(binding.id, 'DISABLED', 'USER');
    });

    it('throws REPOSITORY_BINDING_NOT_FOUND when the project has no binding', async () => {
      repository.findByProjectForOwner.mockResolvedValue(null);

      await expect(service.disable(PROJECT_ID, OWNER_USER_ID)).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.REPOSITORY_BINDING_NOT_FOUND,
      });
    });
  });

  describe('enable (HU57)', () => {
    const enable = (githubUserId = CREATOR_GITHUB_ID) => service.enable(PROJECT_ID, OWNER_USER_ID, githubUserId);

    it('reactivates a DISABLED binding after revalidating the App and refreshing the installation', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'DISABLED', disabledReason: 'USER' });
      githubAppAuthService.findInstallationForRepository.mockResolvedValue('install-2');
      repository.reactivate.mockResolvedValue({ ...binding, installationId: 'install-2' });

      const result = await enable();

      expect(githubAppAuthService.findInstallationForRepository).toHaveBeenCalledWith('org', 'repo');
      expect(repository.reactivate).toHaveBeenCalledWith(binding.id, 'install-2');
      expect(result.status).toBe('ENABLED');
    });

    it('does not read owner or permission for a DISABLED binding (only REVOKED is revalidated)', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'DISABLED', disabledReason: 'USER' });
      repository.reactivate.mockResolvedValue(binding);

      await enable();

      expect(github.calls).toEqual([]);
    });

    it('reactivates a REVOKED binding when the App recovered access and the owner and repositoryId match', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'REVOKED' });
      repository.reactivate.mockResolvedValue(binding);

      await enable();

      expect(repository.reactivate).toHaveBeenCalledWith(binding.id, 'install-1');
    });

    it('keeps REVOKED and throws GITHUB_APP_ACCESS_REQUIRED when the App has no access', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'REVOKED' });
      githubAppAuthService.findInstallationForRepository.mockResolvedValue(null);

      await expect(enable()).rejects.toMatchObject({ code: ErrorCode.GITHUB_APP_ACCESS_REQUIRED });
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it('keeps REVOKED with 404 GITHUB_REPOSITORY_NOT_FOUND when the repository was deleted and recreated (other repositoryId)', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'REVOKED' });
      github.addRepository('org/repo', { ...ownedByCreator, repositoryId: 'recreated-repo-id' });

      await expect(enable()).rejects.toMatchObject({ code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND, status: 404 });
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it('keeps REVOKED with 404 when GitHub no longer finds the repository', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'REVOKED' });
      github.removeRepository('org/repo');

      await expect(enable()).rejects.toMatchObject({ code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND });
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it('keeps REVOKED with 400 REPOSITORY_OUTSIDE_WORKSPACE when the repository was transferred out of the workspace', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'REVOKED' });
      github.addRepository('org/repo', { ...ownedByCreator, ownerId: OTHER_GITHUB_ID, ownerLogin: 'other' });

      await expect(enable()).rejects.toMatchObject({ code: ErrorCode.REPOSITORY_OUTSIDE_WORKSPACE, status: 400 });
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it('answers 503 and keeps REVOKED when the owner cannot be verified', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'REVOKED' });
      github.ownerMode = 'UNVERIFIABLE';

      await expect(enable()).rejects.toMatchObject({ code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE });
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it('is idempotent: an ENABLED binding is returned as is, without revalidating', async () => {
      repository.findByProjectForOwner.mockResolvedValue(binding);

      const result = await enable();

      expect(result).toEqual(binding);
      expect(githubAppAuthService.findInstallationForRepository).not.toHaveBeenCalled();
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it('throws REPOSITORY_BINDING_NOT_FOUND when the project has no binding', async () => {
      repository.findByProjectForOwner.mockResolvedValue(null);

      await expect(enable()).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.REPOSITORY_BINDING_NOT_FOUND,
      });
    });
  });
});
