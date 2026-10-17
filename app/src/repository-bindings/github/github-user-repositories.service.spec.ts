import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubUserRepositoriesService } from './github-user-repositories.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { GithubIntegrationClientError } from '../../github-app/github-integration.client.js';

const PROVIDER_TOKEN = 'gho_user-token';

const apiRepo = {
  repositoryId: '42',
  name: 'widgets',
  repositoryName: 'acme/widgets',
  owner: {
    login: 'acme',
    type: 'Organization',
    avatarUrl: 'https://example.com/a.png',
  },
  private: true,
  defaultBranch: 'main',
  permissions: { admin: false, maintain: true, push: true, pull: true },
};

describe('GithubUserRepositoriesService', () => {
  let service: GithubUserRepositoriesService;
  let client: { post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    client = { post: vi.fn() };
    service = new GithubUserRepositoriesService(client as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps discovery repositories and preserves the upstream pagination marker', async () => {
    client.post.mockResolvedValue({ items: [apiRepo], hasNextPage: true });

    const result = await service.list(PROVIDER_TOKEN, 1, 1);

    expect(result).toEqual({
      items: [
        {
          repositoryId: '42',
          name: 'widgets',
          repositoryName: 'acme/widgets',
          owner: {
            login: 'acme',
            type: 'Organization',
            avatarUrl: 'https://example.com/a.png',
          },
          private: true,
          defaultBranch: 'main',
          permissions: { admin: false, maintain: true, push: true, pull: true },
        },
      ],
      hasNextPage: true,
    });
  });

  it('sends page filters in JSON and the provider token only in the ephemeral header', async () => {
    client.post.mockResolvedValue({ items: [], hasNextPage: false });

    await service.list(PROVIDER_TOKEN, 2, 30);

    expect(client.post).toHaveBeenCalledWith(
      '/repositories/discovery',
      { page: 2, perPage: 30 },
      { headers: { 'X-GitHub-Provider-Token': PROVIDER_TOKEN } },
    );
    const [path, body, options] = client.post.mock.calls[0];
    expect(path).toBe('/repositories/discovery');
    expect(JSON.stringify(body)).not.toContain(PROVIDER_TOKEN);
    expect(options.headers['X-GitHub-Provider-Token']).toBe(PROVIDER_TOKEN);
  });

  it('maps only the explicit GITHUB_USER_TOKEN_INVALID code to public 401', async () => {
    client.post.mockRejectedValue(
      new GithubIntegrationClientError('GITHUB_USER_TOKEN_INVALID', 401, false),
    );

    await expect(service.list(PROVIDER_TOKEN, 1, 30)).rejects.toMatchObject({
      code: ErrorCode.GITHUB_USER_TOKEN_INVALID,
      status: 401,
    });
  });

  it('does not misreport an ambiguous upstream 403 as an expired user token', async () => {
    client.post.mockRejectedValue(
      new GithubIntegrationClientError(
        'GITHUB_UPSTREAM_UNAVAILABLE',
        403,
        true,
      ),
    );

    await expect(service.list(PROVIDER_TOKEN, 1, 30)).rejects.toMatchObject({
      code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
      status: 503,
      message:
        'GitHub no pudo completar la búsqueda de repositorios. Reintenta más tarde.',
    });
    await expect(service.list(PROVIDER_TOKEN, 1, 30)).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('does not expose raw integration failure text', async () => {
    client.post.mockRejectedValue(
      new Error('sensitive upstream body and token'),
    );

    await expect(service.list(PROVIDER_TOKEN, 1, 30)).rejects.toMatchObject({
      code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
      status: 503,
      message:
        'GitHub no pudo completar la búsqueda de repositorios. Reintenta más tarde.',
    });
  });

  describe('personal workspace filter (HU64)', () => {
    const mine = {
      ...apiRepo,
      repositoryId: '1',
      repositoryName: 'octocat/mine',
      owner: { login: 'octocat', type: 'User', avatarUrl: null },
    };

    it('requests repositories owned by the personal account id', async () => {
      client.post.mockResolvedValue({ items: [mine], hasNextPage: false });

      const result = await service.list(PROVIDER_TOKEN, 1, 30, {
        personalOwnerId: '1001',
      });

      expect(client.post.mock.calls[0][1]).toEqual({
        page: 1,
        perPage: 30,
        personalOwnerId: '1001',
      });
      expect(result.items.map((item) => item.repositoryName)).toEqual([
        'octocat/mine',
      ]);
    });

    it('preserves the service pagination marker when the filtered page is sparse', async () => {
      client.post.mockResolvedValue({ items: [mine], hasNextPage: true });

      const result = await service.list(PROVIDER_TOKEN, 1, 2, {
        personalOwnerId: '1001',
      });

      expect(result.items).toHaveLength(1);
      expect(result.hasNextPage).toBe(true);
    });

    it('does not add workspace owner filters without a workspace', async () => {
      client.post.mockResolvedValue({ items: [mine, apiRepo], hasNextPage: false });

      const result = await service.list(PROVIDER_TOKEN, 1, 30);

      expect(client.post.mock.calls[0][1]).toEqual({ page: 1, perPage: 30 });
      expect(result.items).toHaveLength(2);
    });
  });

  describe('organization workspace filter (HU64)', () => {
    const acme = {
      ...apiRepo,
      repositoryId: '2',
      repositoryName: 'acme/widgets',
      owner: { login: 'acme', type: 'Organization', avatarUrl: null },
    };

    it('requests repositories of organization members filtered by organization id', async () => {
      client.post.mockResolvedValue({
        items: [acme],
        hasNextPage: false,
      });

      const result = await service.list(PROVIDER_TOKEN, 1, 30, {
        organizationOwnerId: '42',
      });

      expect(client.post.mock.calls[0][1]).toEqual({
        page: 1,
        perPage: 30,
        organizationOwnerId: '42',
      });
      expect(result.items.map((item) => item.repositoryName)).toEqual([
        'acme/widgets',
      ]);
    });

    it('preserves the integration pagination marker despite an owner filter', async () => {
      client.post.mockResolvedValue({ items: [acme], hasNextPage: true });

      const result = await service.list(PROVIDER_TOKEN, 1, 2, {
        organizationOwnerId: '42',
      });

      expect(result.items).toHaveLength(1);
      expect(result.hasNextPage).toBe(true);
    });
  });
});
