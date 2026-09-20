import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryBindingsController } from './repository-bindings.controller.js';
import { RepositoryBindingsService } from './repository-bindings.service.js';
import { GithubUserRepositoriesService } from './github/github-user-repositories.service.js';
import { GithubRepositoryAccessService } from './github/github-repository-access.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';

describe('RepositoryBindingsController', () => {
  let controller: RepositoryBindingsController;
  let repositoryBindingsService: {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
    enable: ReturnType<typeof vi.fn>;
  };
  let githubUserRepositoriesService: { list: ReturnType<typeof vi.fn> };
  let githubRepositoryAccessService: {
    resolveInstallation: ReturnType<typeof vi.fn>;
    requireInstallation: ReturnType<typeof vi.fn>;
    listBranches: ReturnType<typeof vi.fn>;
    getAppInfo: ReturnType<typeof vi.fn>;
  };

  const binding: RepositoryBinding = {
    id: 'binding-1',
    projectId: 'project-1',
    installationId: 'install-1',
    repositoryId: 'repo-1',
    repositoryName: 'acme/widgets',
    integrationBranch: 'main',
    status: 'ENABLED',
    disabledReason: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    repositoryBindingsService = { create: vi.fn(), get: vi.fn(), disable: vi.fn(), enable: vi.fn() };
    githubUserRepositoriesService = { list: vi.fn() };
    githubRepositoryAccessService = {
      resolveInstallation: vi.fn(),
      requireInstallation: vi.fn(),
      listBranches: vi.fn(),
      getAppInfo: vi.fn().mockResolvedValue({
        displayName: 'TJC Core',
        configureUrl: 'https://github.com/apps/tjc-core/installations/new',
      }),
    };
    controller = new RepositoryBindingsController(
      repositoryBindingsService as unknown as RepositoryBindingsService,
      githubUserRepositoriesService as unknown as GithubUserRepositoriesService,
      githubRepositoryAccessService as unknown as GithubRepositoryAccessService,
    );
  });

  describe('listRepositories', () => {
    it('throws GITHUB_ACCOUNT_REQUIRED when the provider token header is missing', async () => {
      await expect(controller.listRepositories({}, undefined)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.GITHUB_ACCOUNT_REQUIRED });
      expect(githubUserRepositoriesService.list).not.toHaveBeenCalled();
    });

    it('defaults to page 1 and returns the next cursor when there is another page', async () => {
      githubUserRepositoriesService.list.mockResolvedValue({ items: [], hasNextPage: true });

      const result = await controller.listRepositories({}, 'provider-token');

      expect(githubUserRepositoriesService.list).toHaveBeenCalledWith('provider-token', 1, 30);
      expect(result.nextCursor).toBe('2');
    });

    it('returns nextCursor null when there is no further page', async () => {
      githubUserRepositoriesService.list.mockResolvedValue({ items: [], hasNextPage: false });

      const result = await controller.listRepositories({ cursor: '3', limit: 10 }, 'provider-token');

      expect(githubUserRepositoriesService.list).toHaveBeenCalledWith('provider-token', 3, 10);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('verifyAppAccess', () => {
    it('returns AUTHORIZED with the resolved installationId', async () => {
      githubRepositoryAccessService.resolveInstallation.mockResolvedValue('123');

      const result = await controller.verifyAppAccess({
        repositoryId: 'repo-1',
        repositoryName: 'acme/widgets',
      });

      expect(result).toEqual({
        repositoryId: 'repo-1',
        repositoryName: 'acme/widgets',
        status: 'AUTHORIZED',
        installationId: '123',
        app: { displayName: 'TJC Core', configureUrl: 'https://github.com/apps/tjc-core/installations/new' },
      });
    });

    it('returns NOT_AUTHORIZED with a null installationId', async () => {
      githubRepositoryAccessService.resolveInstallation.mockResolvedValue(null);

      const result = await controller.verifyAppAccess({
        repositoryId: 'repo-1',
        repositoryName: 'acme/widgets',
      });

      expect(result.status).toBe('NOT_AUTHORIZED');
      expect(result.installationId).toBeNull();
    });
  });

  describe('listBranches', () => {
    it('joins owner/repo, resolves the installation and lists branches', async () => {
      githubRepositoryAccessService.requireInstallation.mockResolvedValue('123');
      githubRepositoryAccessService.listBranches.mockResolvedValue([{ name: 'main', protected: true }]);

      const result = await controller.listBranches('acme', 'widgets');

      expect(githubRepositoryAccessService.requireInstallation).toHaveBeenCalledWith('acme/widgets');
      expect(githubRepositoryAccessService.listBranches).toHaveBeenCalledWith('acme/widgets', '123');
      expect(result).toEqual({ items: [{ name: 'main', protected: true }] });
    });
  });

  describe('create / get / remove', () => {
    it('create delegates to the service and maps the response', async () => {
      repositoryBindingsService.create.mockResolvedValue(binding);

      const result = await controller.create(
        'project-1',
        { repositoryId: 'repo-1', repositoryName: 'acme/widgets', integrationBranch: 'main' },
        'user-1',
      );

      expect(repositoryBindingsService.create).toHaveBeenCalledWith(
        'project-1',
        { repositoryId: 'repo-1', repositoryName: 'acme/widgets', integrationBranch: 'main' },
        'user-1',
      );
      expect(result.repositoryName).toBe('acme/widgets');
      expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('get delegates to the service and maps the response', async () => {
      repositoryBindingsService.get.mockResolvedValue(binding);

      const result = await controller.get('project-1', 'user-1');

      expect(repositoryBindingsService.get).toHaveBeenCalledWith('project-1', 'user-1');
      expect(result.projectId).toBe('project-1');
    });

    it('remove disables the binding', async () => {
      repositoryBindingsService.disable.mockResolvedValue(binding);

      await controller.remove('project-1', 'user-1');

      expect(repositoryBindingsService.disable).toHaveBeenCalledWith('project-1', 'user-1');
    });

    it('enable reactivates the binding and maps the response', async () => {
      repositoryBindingsService.enable.mockResolvedValue(binding);

      const result = await controller.enable('project-1', 'user-1');

      expect(repositoryBindingsService.enable).toHaveBeenCalledWith('project-1', 'user-1');
      expect(result.status).toBe('ENABLED');
    });
  });
});
