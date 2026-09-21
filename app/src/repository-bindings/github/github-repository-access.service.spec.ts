import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubRepositoryAccessService } from './github-repository-access.service.js';
import {
  GithubAppAuthService,
  GithubAppUnavailableError,
} from '../../github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../../github-app/github-repository-content.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { FakeGithubAccessPort } from '../../../test/support/fake-github-access.port.js';

describe('GithubRepositoryAccessService', () => {
  let service: GithubRepositoryAccessService;
  let githubAppAuthService: {
    findInstallationForRepository: ReturnType<typeof vi.fn>;
    getInstallationToken: ReturnType<typeof vi.fn>;
    getAppInfo: ReturnType<typeof vi.fn>;
  };
  let githubRepositoryContentService: { listBranches: ReturnType<typeof vi.fn> };
  let github: FakeGithubAccessPort;

  beforeEach(() => {
    githubAppAuthService = {
      findInstallationForRepository: vi.fn(),
      getInstallationToken: vi.fn().mockResolvedValue('installation-token'),
      getAppInfo: vi.fn().mockResolvedValue({ slug: 'rag-tesis-gh-app', name: 'rag-tesis-gh-app' }),
    };
    githubRepositoryContentService = { listBranches: vi.fn() };
    github = new FakeGithubAccessPort();
    service = new GithubRepositoryAccessService(
      githubAppAuthService as unknown as GithubAppAuthService,
      githubRepositoryContentService as unknown as GithubRepositoryContentService,
      github,
    );
  });

  describe('getAppInfo', () => {
    it('builds the configure URL from the slug resolved via GithubAppAuthService', async () => {
      await expect(service.getAppInfo()).resolves.toEqual({
        displayName: 'rag-tesis-gh-app',
        configureUrl: 'https://github.com/apps/rag-tesis-gh-app/installations/new',
      });
    });

    it('propagates GithubAppUnavailableError from GithubAppAuthService', async () => {
      githubAppAuthService.getAppInfo.mockRejectedValue(new GithubAppUnavailableError('boom'));

      await expect(service.getAppInfo()).rejects.toBeInstanceOf(GithubAppUnavailableError);
    });
  });

  describe('resolveInstallation', () => {
    it('splits repositoryName and delegates to findInstallationForRepository', async () => {
      githubAppAuthService.findInstallationForRepository.mockResolvedValue('123');

      const result = await service.resolveInstallation('acme/widgets');

      expect(githubAppAuthService.findInstallationForRepository).toHaveBeenCalledWith(
        'acme',
        'widgets',
      );
      expect(result).toBe('123');
    });

    it('returns null when there is no installation', async () => {
      githubAppAuthService.findInstallationForRepository.mockResolvedValue(null);

      await expect(service.resolveInstallation('acme/widgets')).resolves.toBeNull();
    });

    it('maps a GitHub failure while resolving the installation to 503 GITHUB_VERIFICATION_UNAVAILABLE, never NOT_AUTHORIZED', async () => {
      githubAppAuthService.findInstallationForRepository.mockRejectedValue(
        new GithubAppUnavailableError('boom', 500),
      );

      await expect(service.resolveInstallation('acme/widgets')).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        status: 503,
      });
    });
  });

  describe('requireInstallation', () => {
    it('returns the installation id when authorized', async () => {
      githubAppAuthService.findInstallationForRepository.mockResolvedValue('123');

      await expect(service.requireInstallation('acme/widgets')).resolves.toBe('123');
    });

    it('throws GITHUB_APP_ACCESS_REQUIRED when NOT_AUTHORIZED', async () => {
      githubAppAuthService.findInstallationForRepository.mockResolvedValue(null);

      await expect(service.requireInstallation('acme/widgets')).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.GITHUB_APP_ACCESS_REQUIRED });
    });
  });

  describe('listBranches', () => {
    it('exchanges the installation id for a token and lists branches', async () => {
      githubRepositoryContentService.listBranches.mockResolvedValue([
        { name: 'main', protected: true },
      ]);

      const branches = await service.listBranches('acme/widgets', '123');

      expect(githubAppAuthService.getInstallationToken).toHaveBeenCalledWith('123');
      expect(githubRepositoryContentService.listBranches).toHaveBeenCalledWith(
        'acme/widgets',
        'installation-token',
      );
      expect(branches).toEqual([{ name: 'main', protected: true }]);
    });

    it('maps a 404 from GitHub to GITHUB_REPOSITORY_NOT_FOUND', async () => {
      githubRepositoryContentService.listBranches.mockRejectedValue(
        new GithubAppUnavailableError('not found', 404),
      );

      await expect(service.listBranches('acme/widgets', '123')).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND });
    });

    it('rethrows unexpected GitHub failures', async () => {
      const error = new GithubAppUnavailableError('boom', 500);
      githubRepositoryContentService.listBranches.mockRejectedValue(error);

      await expect(service.listBranches('acme/widgets', '123')).rejects.toBe(error);
    });
  });

  describe('getUserPermission (HU64)', () => {
    it.each(['admin', 'maintain', 'write', 'triage', 'read'] as const)('returns %s from the port', async (level) => {
      github.setPermission('acme/widgets', '1001', level);

      await expect(service.getUserPermission('acme/widgets', '123', '1001')).resolves.toBe(level);
    });

    it('returns NONE when GitHub confirms the user has no permission', async () => {
      await expect(service.getUserPermission('acme/widgets', '123', '1001')).resolves.toBe('NONE');
    });

    it('returns APP_NOT_INSTALLED when the installation is gone', async () => {
      github.permissionMode = 'NOT_INSTALLED';

      await expect(service.getUserPermission('acme/widgets', '123', '1001')).resolves.toBe('APP_NOT_INSTALLED');
    });

    it('answers 503 GITHUB_VERIFICATION_UNAVAILABLE (never NONE) when the permission is unverifiable', async () => {
      github.permissionMode = 'UNVERIFIABLE';

      await expect(service.getUserPermission('acme/widgets', '123', '1001')).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        status: 503,
      });
    });
  });

  describe('requireSufficientUserPermission (HU64)', () => {
    it.each(['maintain', 'write', 'admin'] as const)('accepts %s', async (level) => {
      github.setPermission('acme/widgets', '1001', level);

      await expect(service.requireSufficientUserPermission('acme/widgets', '123', '1001')).resolves.toBeUndefined();
    });

    it.each(['read', 'triage'] as const)('rejects %s with 403 REPOSITORY_PERMISSION_INSUFFICIENT', async (level) => {
      github.setPermission('acme/widgets', '1001', level);

      await expect(service.requireSufficientUserPermission('acme/widgets', '123', '1001')).rejects.toMatchObject({
        code: ErrorCode.REPOSITORY_PERMISSION_INSUFFICIENT,
        status: 403,
      });
    });

    it('rejects a user without any permission with 404 GITHUB_REPOSITORY_NOT_FOUND', async () => {
      await expect(service.requireSufficientUserPermission('acme/widgets', '123', '1001')).rejects.toMatchObject({
        code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
        status: 404,
      });
    });

    it('rejects an unverifiable permission with 503, never 404 nor 403', async () => {
      github.permissionMode = 'UNVERIFIABLE';

      await expect(service.requireSufficientUserPermission('acme/widgets', '123', '1001')).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        status: 503,
      });
    });
  });

  describe('requireRepositoryOwner (HU64)', () => {
    it('returns the real repositoryId and owner from GitHub', async () => {
      const owner = { repositoryId: '9', ownerId: '1001', ownerLogin: 'octocat', ownerType: 'User' as const };
      github.addRepository('acme/widgets', owner);

      await expect(service.requireRepositoryOwner('acme/widgets', '123')).resolves.toEqual(owner);
    });

    it('answers 404 GITHUB_REPOSITORY_NOT_FOUND when GitHub does not find the repository', async () => {
      await expect(service.requireRepositoryOwner('acme/widgets', '123')).rejects.toMatchObject({
        code: ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
      });
    });

    it('answers 503 when the owner is unverifiable', async () => {
      github.ownerMode = 'UNVERIFIABLE';

      await expect(service.requireRepositoryOwner('acme/widgets', '123')).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
      });
    });
  });
});
