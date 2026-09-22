import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubUserRepositoriesService } from './github-user-repositories.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { GithubAppUnavailableError } from '../../github-app/github-app-auth.service.js';

const PROVIDER_TOKEN = 'gho_user-token';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

const apiRepo = {
  id: 42,
  name: 'widgets',
  full_name: 'acme/widgets',
  owner: { id: 777, login: 'acme', type: 'Organization', avatar_url: 'https://example.com/a.png' },
  private: true,
  default_branch: 'main',
  permissions: { admin: false, maintain: true, push: true, pull: true },
};

describe('GithubUserRepositoriesService', () => {
  const service = new GithubUserRepositoriesService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps GitHub repos to GitHubUserRepositoryResponse and signals a next page when full', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([apiRepo])));

    const result = await service.list(PROVIDER_TOKEN, 1, 1);

    expect(result).toEqual({
      items: [
        {
          repositoryId: '42',
          name: 'widgets',
          repositoryName: 'acme/widgets',
          owner: { login: 'acme', type: 'Organization', avatarUrl: 'https://example.com/a.png' },
          private: true,
          defaultBranch: 'main',
          permissions: { admin: false, maintain: true, push: true, pull: true },
        },
      ],
      hasNextPage: true,
    });
  });

  it('sends the provider token as Bearer and uses cursor/limit as page/per_page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await service.list(PROVIDER_TOKEN, 2, 30);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/user/repos?per_page=30&page=2&sort=updated',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${PROVIDER_TOKEN}` }),
      }),
    );
  });

  it('throws GITHUB_USER_TOKEN_INVALID when GitHub rejects the provider token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 401)));

    await expect(service.list(PROVIDER_TOKEN, 1, 30)).rejects.toMatchObject<Partial<AppException>>({
      code: ErrorCode.GITHUB_USER_TOKEN_INVALID,
    });
  });

  it('throws GithubAppUnavailableError on unexpected GitHub failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));

    await expect(service.list(PROVIDER_TOKEN, 1, 30)).rejects.toBeInstanceOf(GithubAppUnavailableError);
  });

  describe('personal workspace filter (HU64)', () => {
    const mine = { ...apiRepo, id: 1, full_name: 'octocat/mine', owner: { id: 1001, login: 'octocat', type: 'User', avatar_url: null } };
    const org = { ...apiRepo, id: 2, full_name: 'acme/widgets' };

    it('asks GitHub for owned repositories only and keeps the ones whose owner id is the personal account', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([mine, org]));
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.list(PROVIDER_TOKEN, 1, 30, { personalOwnerId: '1001' });

      expect(fetchMock.mock.calls[0][0]).toContain('affiliation=owner');
      expect(result.items.map((item) => item.repositoryName)).toEqual(['octocat/mine']);
    });

    it('keeps paginating from the raw page size, not from the filtered count', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([mine, org])));

      const result = await service.list(PROVIDER_TOKEN, 1, 2, { personalOwnerId: '1001' });

      expect(result.items).toHaveLength(1);
      expect(result.hasNextPage).toBe(true);
    });

    it('does not filter nor add the affiliation without a workspace (compatibility)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([mine, org]));
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.list(PROVIDER_TOKEN, 1, 30);

      expect(fetchMock.mock.calls[0][0]).not.toContain('affiliation');
      expect(result.items).toHaveLength(2);
    });
  });

  describe('organization workspace filter (HU64, 4b)', () => {
    const mine = { ...apiRepo, id: 1, full_name: 'octocat/mine', owner: { id: 1001, login: 'octocat', type: 'User', avatar_url: null } };
    const acme = { ...apiRepo, id: 2, full_name: 'acme/widgets', owner: { id: 42, login: 'acme', type: 'Organization', avatar_url: null } };
    const other = { ...apiRepo, id: 3, full_name: 'other/lib', owner: { id: 77, login: 'other', type: 'Organization', avatar_url: null } };

    it('asks for the repositories of the organizations the user belongs to and keeps only the ones owned by that organization id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([mine, acme, other]));
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.list(PROVIDER_TOKEN, 1, 30, { organizationOwnerId: '42' });

      expect(fetchMock.mock.calls[0][0]).toContain('affiliation=organization_member');
      expect(result.items.map((item) => item.repositoryName)).toEqual(['acme/widgets']);
    });

    it('keeps paginating from the raw page size, not from the filtered count', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([mine, acme])));

      const result = await service.list(PROVIDER_TOKEN, 1, 2, { organizationOwnerId: '42' });

      expect(result.items).toHaveLength(1);
      expect(result.hasNextPage).toBe(true);
    });
  });
});
