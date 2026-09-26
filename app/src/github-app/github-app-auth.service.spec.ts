import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GithubAppAuthService,
  GithubAppUnavailableError,
} from './github-app-auth.service.js';
import { GithubIntegrationClientError } from './github-integration.client.js';

describe('GithubAppAuthService', () => {
  let service: GithubAppAuthService;
  let client: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    client = { get: vi.fn(), post: vi.fn() };
    service = new GithubAppAuthService(client as never);
  });

  describe('findInstallationForRepository', () => {
    it('resolves an installation through the internal GitHub Integration endpoint', async () => {
      client.post.mockResolvedValue({ installationId: '555' });

      await expect(
        service.findInstallationForRepository('acme', 'widgets'),
      ).resolves.toBe('555');
      expect(client.post).toHaveBeenCalledWith('/repositories/installation', {
        repositoryName: 'acme/widgets',
      });
    });

    it('preserves a confirmed absence as null', async () => {
      client.post.mockResolvedValue({ installationId: null });

      await expect(
        service.findInstallationForRepository('acme', 'widgets'),
      ).resolves.toBeNull();
    });

    it('maps integration failures to a safe Core error and preserves only the status', async () => {
      client.post.mockRejectedValue(
        new GithubIntegrationClientError(
          'GITHUB_RESOURCE_NOT_FOUND',
          404,
          false,
        ),
      );

      await expect(
        service.findInstallationForRepository('acme', 'widgets'),
      ).rejects.toMatchObject({
        name: 'GithubAppUnavailableError',
        status: 404,
        message: 'GitHub App no pudo resolver la instalación del repositorio.',
      });
    });
  });

  describe('getAppInfo', () => {
    it('maps GitHub Integration app metadata to the existing Core shape', async () => {
      client.get.mockResolvedValue({
        slug: 'rag-tesis-gh-app',
        displayName: 'RAG Tesis GitHub App',
        configureUrl:
          'https://github.com/apps/rag-tesis-gh-app/installations/new',
      });

      await expect(service.getAppInfo()).resolves.toEqual({
        slug: 'rag-tesis-gh-app',
        name: 'RAG Tesis GitHub App',
      });
      expect(client.get).toHaveBeenCalledWith('/app');
    });

    it('caches the app metadata', async () => {
      client.get.mockResolvedValue({ slug: 'app', displayName: 'App' });

      await service.getAppInfo();
      await service.getAppInfo();

      expect(client.get).toHaveBeenCalledTimes(1);
    });

    it('does not expose integration error details or raw upstream text', async () => {
      client.get.mockRejectedValue(
        new GithubIntegrationClientError(
          'GITHUB_UPSTREAM_UNAVAILABLE',
          503,
          true,
        ),
      );

      await expect(service.getAppInfo()).rejects.toMatchObject({
        name: 'GithubAppUnavailableError',
        status: 503,
        message: 'GitHub App no pudo resolver su propia información.',
      });
      await expect(service.getAppInfo()).rejects.toBeInstanceOf(
        GithubAppUnavailableError,
      );
    });
  });
});
