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
  owner: { login: 'acme', type: 'Organization', avatar_url: 'https://example.com/a.png' },
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
});
