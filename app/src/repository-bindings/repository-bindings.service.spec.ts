import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryBindingsService } from './repository-bindings.service.js';
import { RepositoryBindingsRepository } from './repository-bindings.repository.js';
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
  };
  let projectsRepository: { findById: ReturnType<typeof vi.fn> };

  const OWNER_USER_ID = 'user-1';
  const PROJECT_ID = 'project-1';

  const project: Project = {
    id: PROJECT_ID,
    name: 'demo',
    ownerUserId: OWNER_USER_ID,
    currentVersionId: null,
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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    repository = {
      create: vi.fn(),
      findByProjectForOwner: vi.fn(),
      updateStatus: vi.fn(),
    };
    projectsRepository = { findById: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryBindingsService,
        { provide: RepositoryBindingsRepository, useValue: repository },
        { provide: ProjectsRepository, useValue: projectsRepository },
      ],
    }).compile();

    service = module.get(RepositoryBindingsService);
  });

  describe('create', () => {
    it('creates the binding when the project exists and has no binding yet', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      repository.findByProjectForOwner.mockResolvedValue(null);
      repository.create.mockResolvedValue(binding);

      const input = {
        installationId: 'install-1',
        repositoryId: 'repo-1',
        repositoryName: 'org/repo',
      };
      const result = await service.create(PROJECT_ID, input, OWNER_USER_ID);

      expect(repository.create).toHaveBeenCalledWith(PROJECT_ID, input);
      expect(result).toEqual(binding);
    });

    it('throws PROJECT_NOT_FOUND when the project does not belong to the owner', async () => {
      projectsRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          PROJECT_ID,
          { installationId: 'i', repositoryId: 'r', repositoryName: 'n' },
          OWNER_USER_ID,
        ),
      ).rejects.toMatchObject<Partial<AppException>>({ code: ErrorCode.PROJECT_NOT_FOUND });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('throws REPOSITORY_BINDING_ALREADY_EXISTS when the project already has a binding', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      repository.findByProjectForOwner.mockResolvedValue(binding);

      await expect(
        service.create(
          PROJECT_ID,
          { installationId: 'i', repositoryId: 'r', repositoryName: 'n' },
          OWNER_USER_ID,
        ),
      ).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.REPOSITORY_BINDING_ALREADY_EXISTS,
      });
      expect(repository.create).not.toHaveBeenCalled();
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

  describe('disable / enable', () => {
    it('disable transitions an existing binding to DISABLED', async () => {
      repository.findByProjectForOwner.mockResolvedValue(binding);
      repository.updateStatus.mockResolvedValue({ ...binding, status: 'DISABLED' });

      const result = await service.disable(PROJECT_ID, OWNER_USER_ID);

      expect(repository.updateStatus).toHaveBeenCalledWith(binding.id, 'DISABLED');
      expect(result.status).toBe('DISABLED');
    });

    it('enable transitions an existing binding to ENABLED', async () => {
      repository.findByProjectForOwner.mockResolvedValue({ ...binding, status: 'DISABLED' });
      repository.updateStatus.mockResolvedValue(binding);

      const result = await service.enable(PROJECT_ID, OWNER_USER_ID);

      expect(repository.updateStatus).toHaveBeenCalledWith(binding.id, 'ENABLED');
      expect(result.status).toBe('ENABLED');
    });

    it('disable throws REPOSITORY_BINDING_NOT_FOUND when the project has no binding', async () => {
      repository.findByProjectForOwner.mockResolvedValue(null);

      await expect(service.disable(PROJECT_ID, OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({
        code: ErrorCode.REPOSITORY_BINDING_NOT_FOUND,
      });
    });
  });
});
