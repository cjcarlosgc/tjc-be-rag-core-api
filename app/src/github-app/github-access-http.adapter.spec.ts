import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAccessHttpAdapter, toPermissionLevel } from './github-access-http.adapter.js';
import { GithubAppUnavailableError } from './github-app-auth.service.js';

const REPO = { installationId: '123', repositoryName: 'acme/widgets' };
const ORG = { installationId: '123', organizationLogin: 'acme' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('GithubAccessHttpAdapter (HU64)', () => {
  const fetchMock = vi.fn();
  let auth: { getInstallationToken: ReturnType<typeof vi.fn>; signAppJwt: ReturnType<typeof vi.fn> };
  let adapter: GithubAccessHttpAdapter;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    auth = {
      getInstallationToken: vi.fn().mockResolvedValue('installation-token'),
      signAppJwt: vi.fn().mockResolvedValue('app-jwt'),
    };
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

  describe('getRepositoryById (HU61, reconciliation part (c))', () => {
    it('reads the current name and owner by the immutable id with the installation token', async () => {
      fetchMock.mockResolvedValue(
        json({ id: 9, full_name: 'acme/renamed', owner: { id: 1001, login: 'acme', type: 'Organization' } }),
      );

      await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({
        status: 'OK',
        value: { repositoryId: '9', repositoryName: 'acme/renamed', ownerId: '1001', ownerLogin: 'acme', ownerType: 'Organization' },
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.github.com/repositories/9');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer installation-token' });
    });

    it('maps 404 to NOT_FOUND, a 404 on the installation token to NOT_INSTALLED', async () => {
      fetchMock.mockResolvedValue(json({ message: 'Not Found' }, 404));
      await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({ status: 'NOT_FOUND' });

      auth.getInstallationToken.mockRejectedValue(new GithubAppUnavailableError('gone', 404));
      await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({ status: 'NOT_INSTALLED' });
    });

    it.each([403, 429, 500])('maps %s, a network error and a malformed body to UNVERIFIABLE, never NOT_FOUND', async (status) => {
      fetchMock.mockResolvedValue(json({ message: 'nope' }, status));
      await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({ status: 'UNVERIFIABLE' });

      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({ status: 'UNVERIFIABLE' });

      fetchMock.mockResolvedValue(json({ id: 9 }));
      await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({ status: 'UNVERIFIABLE' });
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

    it('resolves the login from the numeric id on every verification (no login cache)', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(json({ login: 'octocat', permission: 'write', role_name: 'write' })));

      await adapter.getRepositoryPermission(REPO, '1001');
      await adapter.getRepositoryPermission(REPO, '1001');

      expect(urls().filter((url) => url.endsWith('/user/1001'))).toHaveLength(2);
    });

    it('a login renamed or reassigned to another person does not inherit the permission of the original user', async () => {
      // Antes: "octocat" (id 1001) tiene write. Después la cuenta 1001 se renombra a "renamed" y
      // "octocat" pasa a otra persona (id 2002), sin ningún permiso sobre el repositorio.
      const permissions: Record<string, Response> = {
        octocat: json({ permission: 'write', role_name: 'write' }),
        renamed: json({}, 404),
      };
      let currentLoginOf1001 = 'octocat';
      fetchMock.mockImplementation((url: string) => {
        if (url.endsWith('/user/1001')) return Promise.resolve(json({ id: 1001, login: currentLoginOf1001 }));
        if (url.endsWith('/user/2002')) return Promise.resolve(json({ id: 2002, login: 'octocat-new-owner' }));
        const login = /collaborators\/([^/]+)\/permission/.exec(url)?.[1] ?? '';
        return Promise.resolve((permissions[login] ?? json({}, 404)).clone());
      });

      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'OK', value: 'write' });

      currentLoginOf1001 = 'renamed';
      permissions.renamed = json({ permission: 'write', role_name: 'write' });
      permissions.octocat = json({}, 404); // el login antiguo ahora es de otra persona sin acceso

      // El usuario original sigue resuelto por su id (login nuevo) y conserva su permiso...
      await expect(adapter.getRepositoryPermission(REPO, '1001')).resolves.toEqual({ status: 'OK', value: 'write' });
      expect(urls().at(-1)).toContain('/collaborators/renamed/permission');
      // ...y la persona que ahora se llama "octocat" (id 2002) no hereda el permiso de la cuenta 1001.
      await expect(adapter.getRepositoryPermission(REPO, '2002')).resolves.toEqual({ status: 'NOT_FOUND' });
      expect(urls().at(-1)).toContain('/collaborators/octocat-new-owner/permission');
    });
  });

  describe('listOrganizationInstallations (HU58)', () => {
    const installation = (id: number, account: unknown, suspendedAt: string | null = null) => ({
      id,
      account,
      suspended_at: suspendedAt,
    });

    it('lists only organization installations with the App JWT, marking the suspended ones', async () => {
      fetchMock.mockResolvedValue(
        json([
          installation(1, { id: 10, login: 'acme', type: 'Organization', avatar_url: 'https://avatars/acme' }),
          installation(2, { id: 11, login: 'octocat', type: 'User', avatar_url: 'https://avatars/octocat' }),
          installation(3, { id: 12, login: 'sleepy', type: 'Organization' }, '2026-09-01T00:00:00Z'),
          installation(4, null),
        ]),
      );

      await expect(adapter.listOrganizationInstallations()).resolves.toEqual({
        status: 'OK',
        value: [
          { installationId: '1', organizationId: '10', organizationLogin: 'acme', avatarUrl: 'https://avatars/acme', suspended: false },
          { installationId: '3', organizationId: '12', organizationLogin: 'sleepy', avatarUrl: null, suspended: true },
        ],
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.github.com/app/installations?per_page=100&page=1');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer app-jwt' });
      expect(auth.getInstallationToken).not.toHaveBeenCalled();
    });

    it('returns an empty OK list when the App has no installations', async () => {
      fetchMock.mockResolvedValue(json([]));

      await expect(adapter.listOrganizationInstallations()).resolves.toEqual({ status: 'OK', value: [] });
    });

    it('follows pagination until a short page', async () => {
      const fullPage = Array.from({ length: 100 }, (_, index) =>
        installation(index + 1, { id: 1000 + index, login: `org-${index}`, type: 'Organization' }),
      );
      fetchMock
        .mockResolvedValueOnce(json(fullPage))
        .mockResolvedValueOnce(json([installation(500, { id: 5000, login: 'last', type: 'Organization' })]));

      const result = await adapter.listOrganizationInstallations();

      expect(result.status === 'OK' && result.value).toHaveLength(101);
      expect(urls()[1]).toBe('https://api.github.com/app/installations?per_page=100&page=2');
    });

    it.each([401, 403, 404, 429, 500])('maps %s to UNVERIFIABLE (never an empty list)', async (status) => {
      fetchMock.mockResolvedValue(json({ message: 'nope' }, status));

      await expect(adapter.listOrganizationInstallations()).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });

    it('maps a network error and an unusable App JWT to UNVERIFIABLE', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(adapter.listOrganizationInstallations()).resolves.toEqual({ status: 'UNVERIFIABLE' });

      auth.signAppJwt.mockRejectedValueOnce(new GithubAppUnavailableError('not configured'));
      await expect(adapter.listOrganizationInstallations()).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });
  });

  describe('getOrganizationMembership (HU58)', () => {
    it('resolves the login from the id and reads the membership with the installation token', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ id: 1001, login: 'octocat' }))
        .mockResolvedValueOnce(json({ state: 'active', role: 'admin' }));

      await expect(adapter.getOrganizationMembership(ORG, '1001')).resolves.toEqual({
        status: 'OK',
        value: { role: 'admin', state: 'active' },
      });
      expect(urls()).toEqual([
        'https://api.github.com/user/1001',
        'https://api.github.com/orgs/acme/memberships/octocat',
      ]);
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ headers: { Authorization: 'Bearer installation-token' } });
    });

    it('normalizes member, billing_manager and unknown roles to member, and pending state', async () => {
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(url.includes('/user/') ? json({ login: 'octocat' }) : json({ state: 'pending', role: 'billing_manager' })),
      );

      await expect(adapter.getOrganizationMembership(ORG, '1001')).resolves.toEqual({
        status: 'OK',
        value: { role: 'member', state: 'pending' },
      });
    });

    it('maps 404 (not a member) to NOT_FOUND', async () => {
      fetchMock.mockResolvedValueOnce(json({ login: 'octocat' })).mockResolvedValueOnce(json({}, 404));

      await expect(adapter.getOrganizationMembership(ORG, '1001')).resolves.toEqual({ status: 'NOT_FOUND' });
    });

    it.each([403, 429, 500])('maps %s (Members: read missing, rate limit, outage) to UNVERIFIABLE', async (status) => {
      fetchMock.mockResolvedValueOnce(json({ login: 'octocat' })).mockResolvedValueOnce(json({}, status));

      await expect(adapter.getOrganizationMembership(ORG, '1001')).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });

    it('maps an uninstalled App to NOT_INSTALLED and a suspended one to UNVERIFIABLE', async () => {
      auth.getInstallationToken.mockRejectedValueOnce(new GithubAppUnavailableError('gone', 404));
      await expect(adapter.getOrganizationMembership(ORG, '1001')).resolves.toEqual({ status: 'NOT_INSTALLED' });

      auth.getInstallationToken.mockRejectedValueOnce(new GithubAppUnavailableError('suspended', 403));
      await expect(adapter.getOrganizationMembership(ORG, '1001')).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });

    it('maps an account that no longer exists to NOT_FOUND and a network error to UNVERIFIABLE', async () => {
      fetchMock.mockResolvedValueOnce(json({}, 404));
      await expect(adapter.getOrganizationMembership(ORG, '1001')).resolves.toEqual({ status: 'NOT_FOUND' });

      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await expect(adapter.getOrganizationMembership(ORG, '1001')).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });
  });

  describe('listOrganizationOwners (HU58)', () => {
    it('lists the owners (role=admin) of the organization', async () => {
      fetchMock.mockResolvedValue(json([{ id: 1, login: 'alice' }, { id: 2, login: 'bob' }]));

      await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({
        status: 'OK',
        value: [
          { githubUserId: '1', login: 'alice' },
          { githubUserId: '2', login: 'bob' },
        ],
      });
      expect(urls()).toEqual(['https://api.github.com/orgs/acme/members?role=admin&per_page=100&page=1']);
    });

    it('returns an empty OK list for an organization without owners', async () => {
      fetchMock.mockResolvedValue(json([]));

      await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({ status: 'OK', value: [] });
    });

    it('maps 404 to NOT_FOUND, 403/5xx to UNVERIFIABLE and an uninstalled App to NOT_INSTALLED', async () => {
      fetchMock.mockResolvedValueOnce(json({}, 404));
      await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({ status: 'NOT_FOUND' });

      fetchMock.mockResolvedValueOnce(json({}, 403));
      await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({ status: 'UNVERIFIABLE' });

      fetchMock.mockResolvedValueOnce(json({}, 502));
      await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({ status: 'UNVERIFIABLE' });

      auth.getInstallationToken.mockRejectedValueOnce(new GithubAppUnavailableError('gone', 404));
      await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({ status: 'NOT_INSTALLED' });
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
