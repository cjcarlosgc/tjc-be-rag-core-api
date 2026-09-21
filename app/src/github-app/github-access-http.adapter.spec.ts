import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAccessHttpAdapter, toPermissionLevel } from './github-access-http.adapter.js';
import { GithubAppUnavailableError } from './github-app-auth.service.js';

const REPO = { installationId: '123', repositoryName: 'acme/widgets' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('GithubAccessHttpAdapter (HU64)', () => {
  const fetchMock = vi.fn();
  let auth: { getInstallationToken: ReturnType<typeof vi.fn> };
  let adapter: GithubAccessHttpAdapter;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    auth = { getInstallationToken: vi.fn().mockResolvedValue('installation-token') };
    adapter = new GithubAccessHttpAdapter(auth as never);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  const urls = () => fetchMock.mock.calls.map((call) => call[0] as string);

  describe('getRepositoryOwner', () => {
    it('reads the real repository id and the owner id with the installation token', async () => {
      fetchMock.mockResolvedValue(json({ id: 9, full_name: 'acme/widgets', owner: { id: 1001, login: 'acme', type: 'Organization' } }));

      await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
        status: 'OK',
        value: { repositoryId: '9', ownerId: '1001', ownerLogin: 'acme', ownerType: 'Organization' },
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.github.com/repos/acme/widgets');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer installation-token' });
    });

    it('maps 404 to NOT_FOUND', async () => {
      fetchMock.mockResolvedValue(json({ message: 'Not Found' }, 404));

      await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({ status: 'NOT_FOUND' });
    });

    it.each([403, 429, 500, 502])('maps %s to UNVERIFIABLE, never NOT_FOUND', async (status) => {
      fetchMock.mockResolvedValue(json({ message: 'nope' }, status));

      await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });

    it('maps a network error to UNVERIFIABLE', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });

    it('maps a 404 on the installation token to NOT_INSTALLED', async () => {
      auth.getInstallationToken.mockRejectedValue(new GithubAppUnavailableError('gone', 404));

      await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({ status: 'NOT_INSTALLED' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([403, 500, undefined])('maps an installation token failure (%s) to UNVERIFIABLE', async (status) => {
      auth.getInstallationToken.mockRejectedValue(new GithubAppUnavailableError('boom', status));

      await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });
  });

  describe('getRepositoryPermission', () => {
    it('resolves the login from the numeric id (GET /user/{id}) and reads role_name for that login', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ id: 1001, login: 'octocat' }))
        .mockResolvedValueOnce(json({ permission: 'write', role_name: 'maintain' }));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({
        status: 'OK',
        value: 'maintain',
      });
      expect(urls()).toEqual([
        'https://api.github.com/user/1001',
        'https://api.github.com/repos/acme/widgets/collaborators/octocat/permission',
      ]);
    });

    it('maps no permission (permission none) to NOT_FOUND', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ login: 'octocat' }))
        .mockResolvedValueOnce(json({ permission: 'none', role_name: 'none' }));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'NOT_FOUND' });
    });

    it('maps a 404 on the permission to NOT_FOUND', async () => {
      fetchMock.mockResolvedValueOnce(json({ login: 'octocat' })).mockResolvedValueOnce(json({}, 404));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'NOT_FOUND' });
    });

    it('maps an account that no longer exists (404 on /user/{id}) to NOT_FOUND', async () => {
      fetchMock.mockResolvedValueOnce(json({}, 404));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'NOT_FOUND' });
    });

    it.each([403, 429, 500])('maps %s on /user/{id} to UNVERIFIABLE', async (status) => {
      fetchMock.mockResolvedValueOnce(json({}, status));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });

    it.each([403, 429, 500])('maps %s on the permission read to UNVERIFIABLE, never NOT_FOUND', async (status) => {
      fetchMock.mockResolvedValueOnce(json({ login: 'octocat' })).mockResolvedValueOnce(json({}, status));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });

    it('maps a network error to UNVERIFIABLE', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });

    it('maps an uninstalled App to NOT_INSTALLED', async () => {
      auth.getInstallationToken.mockRejectedValue(new GithubAppUnavailableError('gone', 404));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'NOT_INSTALLED' });
    });

    it('retries once with the freshly resolved login when a cached login answers 404 (renamed account)', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ login: 'old-name' }))
        .mockResolvedValueOnce(json({ permission: 'write', role_name: 'write' }));
      await adapter.getRepositoryPermission(REPO, '1001'); // cachea old-name
      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce(json({}, 404)) // permiso con el login cacheado
        .mockResolvedValueOnce(json({ login: 'new-name' })) // login recién resuelto
        .mockResolvedValueOnce(json({ permission: 'admin', role_name: 'admin' }));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'OK', value: 'admin' });
      expect(urls()).toEqual([
        'https://api.github.com/repos/acme/widgets/collaborators/old-name/permission',
        'https://api.github.com/user/1001',
        'https://api.github.com/repos/acme/widgets/collaborators/new-name/permission',
      ]);
    });

    it('does not retry when the fresh login equals the cached one', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ login: 'octocat' }))
        .mockResolvedValueOnce(json({ permission: 'write', role_name: 'write' }));
      await adapter.getRepositoryPermission(REPO, '1001');
      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce(json({}, 404))
        .mockResolvedValueOnce(json({ login: 'octocat' }));

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'NOT_FOUND' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe('toPermissionLevel', () => {
  it.each(['admin', 'maintain', 'write', 'triage', 'read'] as const)('keeps the known role_name %s', (role) => {
    expect(toPermissionLevel({ role_name: role, permission: 'read' })).toBe(role);
  });

  it('collapses maintain/triage only through role_name: permission alone never grants maintain', () => {
    expect(toPermissionLevel({ permission: 'write' })).toBe('write');
    expect(toPermissionLevel({ permission: 'read' })).toBe('read');
  });

  it('maps a custom role by its base permission', () => {
    expect(toPermissionLevel({ role_name: 'release-manager', permission: 'write' })).toBe('write');
    expect(toPermissionLevel({ role_name: 'auditor', permission: 'read' })).toBe('read');
  });

  it('maps none or an unknown shape to no access', () => {
    expect(toPermissionLevel({ role_name: 'none', permission: 'none' })).toBeNull();
    expect(toPermissionLevel({})).toBeNull();
  });
});
