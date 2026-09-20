import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryBindingsService } from './repository-bindings.service.js';
import { RepositoryBindingsRepository } from './repository-bindings.repository.js';
import { GithubRepositoryAccessService } from './github/github-repository-access.service.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
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
  let githubRepositoryAccessService: {
    requireInstallation: ReturnType<typeof vi.fn>;
    resolveRepositoryId: ReturnType<typeof vi.fn>;
    listBranches: ReturnType<typeof vi.fn>;
  };

  const OWNER_USER_ID = 'user-1';
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

  beforeEach(async () => {
    repository = {
      create: vi.fn(),
      findByProjectForOwner: vi.fn(),
      updateStatus: vi.fn(),
      reactivate: vi.fn(),
      findByRepositoryId: vi.fn().mockResolvedValue(null),
    };
    projectsRepository = { findById: vi.fn() };
    githubRepositoryAccessService = {
      requireInstallation: vi.fn().mockResolvedValue('install-1'),
      resolveRepositoryId: vi.fn().mockResolvedValue('repo-1'),
      listBranches: vi.fn().mockResolvedValue([{ name: 'main', protected: false }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryBindingsService,
        { provide: RepositoryBindingsRepository, useValue: repository },
        { provide: ProjectsRepository, useValue: projectsRepository },
        { provide: GithubRepositoryAccessService, useValue: githubRepositoryAccessService },
      ],
    }).compile();

    service = module.get(RepositoryBindingsService);
  });

  describe('create', () => {
    const input = { repositoryId: 'repo-1', repositoryName: 'org/repo', integrationBranch: 'main' };

    it('resolves the installation, validates the branch and creates the binding', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      repository.findByProjectForOwner.mockResolvedValue(null);
      repository.create.mockResolvedValue(binding);

      const result = await service.create(PROJECT_ID, input, OWNER_USER_ID);

      expect(githubRepositoryAccessService.requireInstallation).toHaveBeenCalledWith('org/repo');
      expect(githubRepositoryAccessService.listBranches).toHaveBeenCalledWith('org/repo', 'install-1');
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

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.PROJECT_NOT_FOUND });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('throws REPOSITORY_BINDING_ALREADY_EXISTS when the project already has a binding', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      repository.findByProjectForOwner.mockResolvedValue(binding);

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.REPOSITORY_BINDING_ALREADY_EXISTS });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('throws INTEGRATION_BRANCH_NOT_FOUND when the chosen branch does not exist', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      repository.findByProjectForOwner.mockResolvedValue(null);
      githubRepositoryAccessService.listBranches.mockResolvedValue([
        { name: 'develop', protected: false },
      ]);

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.INTEGRATION_BRANCH_NOT_FOUND });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('propagates GITHUB_APP_ACCESS_REQUIRED when the App has no access to the repository', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      repository.findByProjectForOwner.mockResolvedValue(null);
      const accessError = new AppException(
        ErrorCode.GITHUB_APP_ACCESS_REQUIRED,
        'no access',
        403,
      );
      githubRepositoryAccessService.requireInstallation.mockRejectedValue(accessError);

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toBe(accessError);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('create — repository conflicts (HU57)', () => {
    const input = { repositoryId: 'repo-1', repositoryName: 'org/repo', integrationBranch: 'main' };

    beforeEach(() => {
      projectsRepository.findById.mockResolvedValue(project);
      repository.findByProjectForOwner.mockResolvedValue(null);
    });

    it('throws REPOSITORY_ALREADY_BOUND (409) with a generic message when another project uses the repository', async () => {
      repository.findByRepositoryId.mockResolvedValue({ ...binding, projectId: 'other-project' });

      const error = await service.create(PROJECT_ID, input, OWNER_USER_ID).catch((e: AppException) => e);

      expect(error).toMatchObject({ code: ErrorCode.REPOSITORY_ALREADY_BOUND });
      expect((error as AppException).message).not.toContain('other-project');
      expect(repository.create).not.toHaveBeenCalled();
      expect(githubRepositoryAccessService.listBranches).not.toHaveBeenCalled();
    });

    it('checks the App access before the repository conflict', async () => {
      const accessError = new AppException(ErrorCode.GITHUB_APP_ACCESS_REQUIRED, 'no access', 403);
      githubRepositoryAccessService.requireInstallation.mockRejectedValue(accessError);
      repository.findByRepositoryId.mockResolvedValue({ ...binding, projectId: 'other-project' });

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toBe(accessError);
    });

    it('checks the repository conflict before the branch', async () => {
      repository.findByRepositoryId.mockResolvedValue({ ...binding, projectId: 'other-project' });
      githubRepositoryAccessService.listBranches.mockResolvedValue([]);

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.REPOSITORY_ALREADY_BOUND,
      });
    });

    it('does not trust the client repositoryId: a mismatch with GitHub is GITHUB_REPOSITORY_NOT_FOUND', async () => {
      githubRepositoryAccessService.resolveRepositoryId.mockResolvedValue('real-repo-id');

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('maps a concurrent unique violation on the repository to REPOSITORY_ALREADY_BOUND, never 500', async () => {
      repository.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.REPOSITORY_ALREADY_BOUND,
      });
    });

    it('maps a concurrent unique violation on the project to REPOSITORY_BINDING_ALREADY_EXISTS', async () => {
      repository.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
      repository.findByProjectForOwner.mockResolvedValueOnce(null).mockResolvedValueOnce(binding);

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.REPOSITORY_BINDING_ALREADY_EXISTS,
      });
    });

    it('rethrows non-unique persistence errors untouched', async () => {
      const boom = new Error('connection lost');
      repository.create.mockRejectedValue(boom);

      await expect(service.create(PROJECT_ID, input, OWNER_USER_ID)).rejects.toBe(boom);
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

      await expect(service.get(PROJECT_ID, OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({
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

      await expect(service.disable(PROJECT_ID, OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.REPOSITORY_BINDING_NOT_FOUND });
    });
  });

  describe('enable (HU57)', () => {
    it('reactivates a DISABLED binding after revalidating the App and refreshing the installation', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'DISABLED', disabledReason: 'USER' });
      githubRepositoryAccessService.requireInstallation.mockResolvedValue('install-2');
      repository.reactivate.mockResolvedValue({ ...binding, installationId: 'install-2' });

      const result = await service.enable(PROJECT_ID, OWNER_USER_ID);

      expect(githubRepositoryAccessService.requireInstallation).toHaveBeenCalledWith('org/repo');
      expect(repository.reactivate).toHaveBeenCalledWith(binding.id, 'install-2');
      expect(result.status).toBe('ENABLED');
    });

    it('reactivates a REVOKED binding when the App recovered access', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'REVOKED' });
      repository.reactivate.mockResolvedValue(binding);

      await service.enable(PROJECT_ID, OWNER_USER_ID);

      expect(repository.reactivate).toHaveBeenCalledWith(binding.id, 'install-1');
    });

    it('keeps REVOKED and throws GITHUB_APP_ACCESS_REQUIRED when the App has no access', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'REVOKED' });
      const accessError = new AppException(ErrorCode.GITHUB_APP_ACCESS_REQUIRED, 'no access', 403);
      githubRepositoryAccessService.requireInstallation.mockRejectedValue(accessError);

      await expect(service.enable(PROJECT_ID, OWNER_USER_ID)).rejects.toBe(accessError);
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it('is idempotent: an ENABLED binding is returned as is, without revalidating', async () => {
      repository.findByProjectForOwner.mockResolvedValue(binding);

      const result = await service.enable(PROJECT_ID, OWNER_USER_ID);

      expect(result).toEqual(binding);
      expect(githubRepositoryAccessService.requireInstallation).not.toHaveBeenCalled();
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it('throws REPOSITORY_BINDING_NOT_FOUND when the project has no binding', async () => {
      repository.findByProjectForOwner.mockResolvedValue(null);

      await expect(service.enable(PROJECT_ID, OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.REPOSITORY_BINDING_NOT_FOUND });
    });
  });
});
