import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubRepositoryAccessService } from './github-repository-access.service.js';
import {
  GithubAppAuthService,
  GithubAppUnavailableError,
} from '../../github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../../github-app/github-repository-content.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';

describe('GithubRepositoryAccessService', () => {
  let service: GithubRepositoryAccessService;
  let githubAppAuthService: {
    findInstallationForRepository: ReturnType<typeof vi.fn>;
    getInstallationToken: ReturnType<typeof vi.fn>;
  };
  let githubRepositoryContentService: { listBranches: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    githubAppAuthService = {
      findInstallationForRepository: vi.fn(),
      getInstallationToken: vi.fn().mockResolvedValue('installation-token'),
    };
    githubRepositoryContentService = { listBranches: vi.fn() };
    configService = {
      get: vi.fn((key: string) => {
        if (key === 'GITHUB_APP_SLUG') return 'tjc-core';
        if (key === 'GITHUB_APP_NAME') return 'TJC Core';
        return undefined;
      }),
    };
    service = new GithubRepositoryAccessService(
      githubAppAuthService as unknown as GithubAppAuthService,
      githubRepositoryContentService as unknown as GithubRepositoryContentService,
      configService as never,
    );
  });

  describe('getAppInfo', () => {
    it('builds the configure URL from GITHUB_APP_SLUG', () => {
      expect(service.getAppInfo()).toEqual({
        displayName: 'TJC Core',
        configureUrl: 'https://github.com/apps/tjc-core/installations/new',
      });
    });

    it('throws GithubAppUnavailableError when GITHUB_APP_SLUG is missing', () => {
      configService.get.mockReturnValue(undefined);

      expect(() => service.getAppInfo()).toThrow(GithubAppUnavailableError);
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
});
