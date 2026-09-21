import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryBindingsController } from './repository-bindings.controller.js';
import { RepositoryBindingsService } from './repository-bindings.service.js';
import { GithubUserRepositoriesService } from './github/github-user-repositories.service.js';
import { GithubRepositoryAccessService } from './github/github-repository-access.service.js';
import type { GithubAppAuthService } from '../github-app/github-app-auth.service.js';
import type { GithubRepositoryContentService } from '../github-app/github-repository-content.service.js';
import { GithubAppUnavailableError } from '../github-app/github-app-auth.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { FakeGithubAccessPort } from '../../test/support/fake-github-access.port.js';
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
  let githubAppAuthService: {
    findInstallationForRepository: ReturnType<typeof vi.fn>;
    getInstallationToken: ReturnType<typeof vi.fn>;
    getAppInfo: ReturnType<typeof vi.fn>;
  };
  let githubRepositoryContentService: { listBranches: ReturnType<typeof vi.fn> };
  let github: FakeGithubAccessPort;

  const GITHUB_USER_ID = '1001';

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
    githubAppAuthService = {
      findInstallationForRepository: vi.fn(),
      getInstallationToken: vi.fn().mockResolvedValue('installation-token'),
      getAppInfo: vi.fn().mockResolvedValue({ slug: 'tjc-core', name: 'TJC Core' }),
    };
    githubRepositoryContentService = { listBranches: vi.fn() };
    github = new FakeGithubAccessPort();
    controller = new RepositoryBindingsController(
      repositoryBindingsService as unknown as RepositoryBindingsService,
      githubUserRepositoriesService as unknown as GithubUserRepositoriesService,
      new GithubRepositoryAccessService(
        githubAppAuthService as unknown as GithubAppAuthService,
        githubRepositoryContentService as unknown as GithubRepositoryContentService,
        github,
      ),
    );
  });

  describe('listRepositories', () => {
    it('throws GITHUB_ACCOUNT_REQUIRED when the provider token header is missing', async () => {
      await expect(controller.listRepositories({}, undefined, GITHUB_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.GITHUB_ACCOUNT_REQUIRED });
      expect(githubUserRepositoriesService.list).not.toHaveBeenCalled();
    });

    it('defaults to page 1 and returns the next cursor when there is another page', async () => {
      githubUserRepositoriesService.list.mockResolvedValue({ items: [], hasNextPage: true });

      const result = await controller.listRepositories({}, 'provider-token', GITHUB_USER_ID);

      expect(githubUserRepositoriesService.list).toHaveBeenCalledWith('provider-token', 1, 30, undefined);
      expect(result.nextCursor).toBe('2');
    });

    it('returns nextCursor null when there is no further page', async () => {
      githubUserRepositoriesService.list.mockResolvedValue({ items: [], hasNextPage: false });

      const result = await controller.listRepositories(
        { cursor: '3', limit: 10 },
        'provider-token',
        GITHUB_USER_ID,
      );

      expect(githubUserRepositoriesService.list).toHaveBeenCalledWith('provider-token', 3, 10, undefined);
      expect(result.nextCursor).toBeNull();
    });

    it('filters to the personal workspace when workspaceId is the session GitHub identity (HU64)', async () => {
      githubUserRepositoriesService.list.mockResolvedValue({ items: [], hasNextPage: false });

      await controller.listRepositories({ workspaceId: GITHUB_USER_ID }, 'provider-token', GITHUB_USER_ID);

      expect(githubUserRepositoriesService.list).toHaveBeenCalledWith('provider-token', 1, 30, {
        personalOwnerId: GITHUB_USER_ID,
      });
    });

    it('answers 404 WORKSPACE_NOT_FOUND for the id of an organization or any other workspace (bundle A)', async () => {
      await expect(
        controller.listRepositories({ workspaceId: '424242' }, 'provider-token', GITHUB_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.WORKSPACE_NOT_FOUND, status: 404 });
      expect(githubUserRepositoriesService.list).not.toHaveBeenCalled();
    });
  });

  describe('verifyAppAccess (HU64)', () => {
    const body = { repositoryId: 'repo-1', repositoryName: 'acme/widgets' };
    const app = { displayName: 'TJC Core', configureUrl: 'https://github.com/apps/tjc-core/installations/new' };

    beforeEach(() => {
      githubAppAuthService.findInstallationForRepository.mockResolvedValue('123');
    });

    it.each(['maintain', 'write', 'admin'] as const)(
      'returns AUTHORIZED with the resolved installationId for permission %s',
      async (level) => {
        github.setPermission('acme/widgets', GITHUB_USER_ID, level);

        await expect(controller.verifyAppAccess(body, GITHUB_USER_ID)).resolves.toEqual({
          repositoryId: 'repo-1',
          repositoryName: 'acme/widgets',
          status: 'AUTHORIZED',
          installationId: '123',
          app,
        });
      },
    );

    it.each(['read', 'triage'] as const)('answers 403 REPOSITORY_PERMISSION_INSUFFICIENT for permission %s', async (level) => {
      github.setPermission('acme/widgets', GITHUB_USER_ID, level);

      await expect(controller.verifyAppAccess(body, GITHUB_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.REPOSITORY_PERMISSION_INSUFFICIENT,
        status: 403,
      });
    });

    it('is declared to answer 200 (INTEROP §6.8), not the Nest default 201 for POST', () => {
      const httpCode = Reflect.getMetadata('__httpCode__', RepositoryBindingsController.prototype.verifyAppAccess);

      expect(httpCode).toBe(200);
    });

    it('returns NOT_AUTHORIZED without revealing the installation when the user has no visibility', async () => {
      const result = await controller.verifyAppAccess(body, GITHUB_USER_ID);

      expect(result.status).toBe('NOT_AUTHORIZED');
      expect(result.installationId).toBeNull();
    });

    it('returns NOT_AUTHORIZED with a null installationId when the App is not installed, without reading any permission', async () => {
      githubAppAuthService.findInstallationForRepository.mockResolvedValue(null);

      const result = await controller.verifyAppAccess(body, GITHUB_USER_ID);

      expect(result.status).toBe('NOT_AUTHORIZED');
      expect(result.installationId).toBeNull();
      expect(github.calls).toEqual([]);
    });

    it('answers 503 GITHUB_VERIFICATION_UNAVAILABLE, never NOT_AUTHORIZED, when the permission is unverifiable', async () => {
      github.permissionMode = 'UNVERIFIABLE';

      await expect(controller.verifyAppAccess(body, GITHUB_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        status: 503,
      });
    });

    it('reads the permission of the session identity, not of a user chosen by the client', async () => {
      github.setPermission('acme/widgets', GITHUB_USER_ID, 'write');

      await controller.verifyAppAccess(body, GITHUB_USER_ID);

      expect(github.calls).toEqual([
        { method: 'getRepositoryPermission', repositoryName: 'acme/widgets', githubUserId: GITHUB_USER_ID },
      ]);
    });
  });

  describe('listBranches (HU64)', () => {
    beforeEach(() => {
      githubAppAuthService.findInstallationForRepository.mockResolvedValue('123');
      githubRepositoryContentService.listBranches.mockResolvedValue([{ name: 'main', protected: true }]);
    });

    it('joins owner/repo and lists branches when the user has maintain, write or admin', async () => {
      github.setPermission('acme/widgets', GITHUB_USER_ID, 'write');

      const result = await controller.listBranches('acme', 'widgets', GITHUB_USER_ID);

      expect(githubAppAuthService.findInstallationForRepository).toHaveBeenCalledWith('acme', 'widgets');
      expect(githubRepositoryContentService.listBranches).toHaveBeenCalledWith('acme/widgets', 'installation-token');
      expect(result).toEqual({ items: [{ name: 'main', protected: true }] });
    });

    it('answers 403 GITHUB_APP_ACCESS_REQUIRED before any permission read when the App is not installed', async () => {
      githubAppAuthService.findInstallationForRepository.mockResolvedValue(null);

      await expect(controller.listBranches('acme', 'widgets', GITHUB_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.GITHUB_APP_ACCESS_REQUIRED,
        status: 403,
      });
      expect(github.calls).toEqual([]);
    });

    it('answers 404 GITHUB_REPOSITORY_NOT_FOUND when the user has no visibility of the repository', async () => {
      await expect(controller.listBranches('acme', 'widgets', GITHUB_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
        status: 404,
      });
      expect(githubRepositoryContentService.listBranches).not.toHaveBeenCalled();
    });

    it.each(['read', 'triage'] as const)('answers 403 REPOSITORY_PERMISSION_INSUFFICIENT for permission %s', async (level) => {
      github.setPermission('acme/widgets', GITHUB_USER_ID, level);

      await expect(controller.listBranches('acme', 'widgets', GITHUB_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.REPOSITORY_PERMISSION_INSUFFICIENT,
        status: 403,
      });
      expect(githubRepositoryContentService.listBranches).not.toHaveBeenCalled();
    });

    it('answers 503 GITHUB_VERIFICATION_UNAVAILABLE, never 404 nor 403, when the permission is unverifiable', async () => {
      github.permissionMode = 'UNVERIFIABLE';

      await expect(controller.listBranches('acme', 'widgets', GITHUB_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        status: 503,
      });
    });

    it('answers 503 when GitHub fails while resolving the installation', async () => {
      githubAppAuthService.findInstallationForRepository.mockRejectedValue(new GithubAppUnavailableError('boom', 500));

      await expect(controller.listBranches('acme', 'widgets', GITHUB_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
      });
    });
  });

  describe('create / get / remove', () => {
    it('create delegates to the service and maps the response', async () => {
      repositoryBindingsService.create.mockResolvedValue(binding);

      const result = await controller.create(
        'project-1',
        { repositoryId: 'repo-1', repositoryName: 'acme/widgets', integrationBranch: 'main' },
        'user-1',
        GITHUB_USER_ID,
      );

      expect(repositoryBindingsService.create).toHaveBeenCalledWith(
        'project-1',
        { repositoryId: 'repo-1', repositoryName: 'acme/widgets', integrationBranch: 'main' },
        'user-1',
        GITHUB_USER_ID,
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

      const result = await controller.enable('project-1', 'user-1', GITHUB_USER_ID);

      expect(repositoryBindingsService.enable).toHaveBeenCalledWith('project-1', 'user-1', GITHUB_USER_ID);
      expect(result.status).toBe('ENABLED');
    });
  });
});
