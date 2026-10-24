import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAccessHttpAdapter } from './github-access-http.adapter.js';
import { GithubIntegrationClientError } from './github-integration.client.js';

const REPO = { installationId: '123', repositoryName: 'acme/widgets' };
const ORG = { installationId: '123', organizationLogin: 'acme' };

const owner = {
  repositoryId: '9',
  ownerId: '1001',
  ownerLogin: 'acme',
  ownerType: 'Organization' as const,
};
const repository = { ...owner, repositoryName: 'acme/renamed' };

describe('GithubAccessHttpAdapter (HU64)', () => {
  let client: { post: ReturnType<typeof vi.fn> };
  let adapter: GithubAccessHttpAdapter;

  beforeEach(() => {
    client = { post: vi.fn() };
    adapter = new GithubAccessHttpAdapter(client as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getRepositoryOwner', () => {
    it('delegates owner lookup to the internal endpoint and preserves the lookup result', async () => {
      client.post.mockResolvedValue({ status: 'OK', value: owner });

      await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
        status: 'OK',
        value: owner,
      });
      expect(client.post).toHaveBeenCalledWith('/repositories/owner', {
        installationId: '123',
        repositoryName: 'acme/widgets',
      });
    });

    it.each(['NOT_FOUND', 'NOT_INSTALLED', 'UNVERIFIABLE'] as const)(
      'preserves the %s domain result',
      async (status) => {
        client.post.mockResolvedValue({ status });

        await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
          status,
        });
      },
    );

    it('maps transport failures and malformed successful data to UNVERIFIABLE', async () => {
      client.post.mockRejectedValue(
        new GithubIntegrationClientError(
          'GITHUB_UPSTREAM_UNAVAILABLE',
          503,
          true,
        ),
      );
      await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
        status: 'UNVERIFIABLE',
      });

      client.post.mockResolvedValue({
        status: 'OK',
        value: { repositoryId: '9' },
      });
      await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
        status: 'UNVERIFIABLE',
      });
    });
  });

  describe('getRepositoryById (HU61, reconciliation part (c))', () => {
    it('reads current name and owner by immutable repository id', async () => {
      client.post.mockResolvedValue({ status: 'OK', value: repository });

      await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({
        status: 'OK',
        value: repository,
      });
      expect(client.post).toHaveBeenCalledWith('/repositories/by-id', {
        installationId: '123',
        repositoryId: '9',
      });
    });

    it('preserves NOT_FOUND and NOT_INSTALLED from GitHub Integration', async () => {
      client.post.mockResolvedValueOnce({ status: 'NOT_FOUND' });
      await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({
        status: 'NOT_FOUND',
      });

      client.post.mockResolvedValueOnce({ status: 'NOT_INSTALLED' });
      await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({
        status: 'NOT_INSTALLED',
      });
    });
  });

  describe('getRepositoryPermission', () => {
    it('delegates permission lookup by immutable GitHub user id', async () => {
      client.post.mockResolvedValue({ status: 'OK', value: 'maintain' });

      await expect(
        adapter.getRepositoryPermission(REPO, '1001'),
      ).resolves.toEqual({
        status: 'OK',
        value: 'maintain',
      });
      expect(client.post).toHaveBeenCalledWith('/repositories/permission', {
        installationId: '123',
        repositoryName: 'acme/widgets',
        githubUserId: '1001',
      });
    });

    it('preserves confirmed absence and does not locally resolve or cache user logins', async () => {
      client.post.mockResolvedValue({ status: 'NOT_FOUND' });

      await expect(
        adapter.getRepositoryPermission(REPO, '1001'),
      ).resolves.toEqual({ status: 'NOT_FOUND' });
      await adapter.getRepositoryPermission(REPO, '1001');

      expect(client.post).toHaveBeenCalledTimes(2);
      expect(client.post.mock.calls[0][0]).toBe('/repositories/permission');
    });

    it('maps malformed or unknown permission values to UNVERIFIABLE', async () => {
      client.post.mockResolvedValue({
        status: 'OK',
        value: 'custom-role-not-normalized',
      });

      await expect(
        adapter.getRepositoryPermission(REPO, '1001'),
      ).resolves.toEqual({
        status: 'UNVERIFIABLE',
      });
    });
  });

  describe('listOrganizationInstallations (HU58)', () => {
    const installations = [
      {
        installationId: '1',
        organizationId: '10',
        organizationLogin: 'acme',
        avatarUrl: 'https://avatars/acme',
        suspended: false,
      },
      {
        installationId: '3',
        organizationId: '12',
        organizationLogin: 'sleepy',
        avatarUrl: null,
        suspended: true,
      },
    ];

    it('delegates app-wide installation listing and preserves suspended organizations', async () => {
      client.post.mockResolvedValue({ status: 'OK', value: installations });

      await expect(adapter.listOrganizationInstallations()).resolves.toEqual({
        status: 'OK',
        value: installations,
      });
      expect(client.post).toHaveBeenCalledWith(
        '/organizations/installations',
        {},
      );
    });

    it('preserves a confirmed empty list and maps upstream errors to UNVERIFIABLE', async () => {
      client.post.mockResolvedValueOnce({ status: 'OK', value: [] });
      await expect(adapter.listOrganizationInstallations()).resolves.toEqual({
        status: 'OK',
        value: [],
      });

      client.post.mockResolvedValueOnce({ status: 'NOT_FOUND' });
      await expect(adapter.listOrganizationInstallations()).resolves.toEqual({
        status: 'UNVERIFIABLE',
      });

      client.post.mockRejectedValueOnce(
        new Error('raw integration response body'),
      );
      await expect(adapter.listOrganizationInstallations()).resolves.toEqual({
        status: 'UNVERIFIABLE',
      });
    });
  });

  describe('getOrganizationMembership (HU58)', () => {
    it('delegates membership lookup by GitHub user id and preserves normalized membership', async () => {
      client.post.mockResolvedValue({
        status: 'OK',
        value: { role: 'admin', state: 'active' },
      });

      await expect(
        adapter.getOrganizationMembership(ORG, '1001'),
      ).resolves.toEqual({
        status: 'OK',
        value: { role: 'admin', state: 'active' },
      });
      expect(client.post).toHaveBeenCalledWith('/organizations/membership', {
        installationId: '123',
        organizationLogin: 'acme',
        githubUserId: '1001',
      });
    });

    it('preserves not-a-member and uninstalled results', async () => {
      client.post.mockResolvedValueOnce({ status: 'NOT_FOUND' });
      await expect(
        adapter.getOrganizationMembership(ORG, '1001'),
      ).resolves.toEqual({
        status: 'NOT_FOUND',
      });

      client.post.mockResolvedValueOnce({ status: 'NOT_INSTALLED' });
      await expect(
        adapter.getOrganizationMembership(ORG, '1001'),
      ).resolves.toEqual({
        status: 'NOT_INSTALLED',
      });
    });

    it('maps malformed membership data to UNVERIFIABLE rather than granting access', async () => {
      client.post.mockResolvedValue({
        status: 'OK',
        value: { role: 'admin', state: 'unknown' },
      });

      await expect(
        adapter.getOrganizationMembership(ORG, '1001'),
      ).resolves.toEqual({
        status: 'UNVERIFIABLE',
      });
    });
  });

  describe('listOrganizationOwners (HU58)', () => {
    it('delegates owner listing to the service using the installation and organization login', async () => {
      const owners = [
        { githubUserId: '1', login: 'alice' },
        { githubUserId: '2', login: 'bob' },
      ];
      client.post.mockResolvedValue({ status: 'OK', value: owners });

      await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({
        status: 'OK',
        value: owners,
      });
      expect(client.post).toHaveBeenCalledWith('/organizations/owners', {
        installationId: '123',
        organizationLogin: 'acme',
      });
    });

    it('keeps an empty owner list UNVERIFIABLE and preserves confirmed lookup states', async () => {
      client.post.mockResolvedValueOnce({ status: 'OK', value: [] });
      await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({
        status: 'UNVERIFIABLE',
      });

      client.post.mockResolvedValueOnce({ status: 'NOT_FOUND' });
      await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({
        status: 'NOT_FOUND',
      });
    });
  });

  it('never calls api.github.com or includes credentials in gateway requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client.post.mockResolvedValue({ status: 'NOT_FOUND' });

    await adapter.getRepositoryOwner(REPO);

    expect(client.post.mock.calls[0]).toEqual([
      '/repositories/owner',
      { installationId: '123', repositoryName: 'acme/widgets' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GithubAccessHttpAdapter diagnostics (WI-CORE-087)', () => {
  let client: { post: ReturnType<typeof vi.fn> };
  let adapter: GithubAccessHttpAdapter;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const warnings = (): string[] =>
    warnSpy.mock.calls.map((call) => String(call[0]));

  beforeEach(() => {
    client = { post: vi.fn() };
    adapter = new GithubAccessHttpAdapter(client as never);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers ERROR_CLIENTE with code, HTTP status and retryable flag, and keeps UNVERIFIABLE', async () => {
    client.post.mockRejectedValue(
      new GithubIntegrationClientError('SERVICE_UNAUTHORIZED', 401, false),
    );

    await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
      status: 'UNVERIFIABLE',
    });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(
      /"\/repositories\/owner": motivo=ERROR_CLIENTE:SERVICE_UNAUTHORIZED, estatus=401, reintentable=false, duracion=\d+ ms\./,
    );
  });

  it('registers "sin respuesta" when the client error has no HTTP status', async () => {
    client.post.mockRejectedValue(
      new GithubIntegrationClientError(
        'GITHUB_UPSTREAM_UNAVAILABLE',
        undefined,
        true,
      ),
    );

    await expect(adapter.getRepositoryById('123', '9')).resolves.toEqual({
      status: 'UNVERIFIABLE',
    });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(
      /"\/repositories\/by-id": motivo=ERROR_CLIENTE:GITHUB_UPSTREAM_UNAVAILABLE, estatus=sin respuesta, reintentable=true, duracion=\d+ ms\./,
    );
  });

  it('registers only the error name for unexpected errors and never its message', async () => {
    client.post.mockRejectedValue(
      new TypeError('token sk-test-SECRET-9f3a leaked in message'),
    );

    await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
      status: 'UNVERIFIABLE',
    });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(
      /motivo=ERROR_INESPERADO:TypeError, estatus=n\/a, reintentable=n\/a, duracion=\d+ ms\./,
    );
    expect(warnings()[0]).not.toContain('sk-test-SECRET-9f3a');
  });

  it('registers INTEGRATION_UNVERIFIABLE when Integration itself answers UNVERIFIABLE', async () => {
    client.post.mockResolvedValue({ status: 'UNVERIFIABLE' });

    await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
      status: 'UNVERIFIABLE',
    });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(
      /motivo=INTEGRATION_UNVERIFIABLE, estatus=n\/a, reintentable=n\/a, duracion=\d+ ms\./,
    );
  });

  it('registers RESPUESTA_NO_RECONOCIDA for malformed or unknown responses', async () => {
    client.post.mockResolvedValueOnce('not-an-object');
    await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
      status: 'UNVERIFIABLE',
    });

    client.post.mockResolvedValueOnce({ status: 'SOMETHING_NEW' });
    await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
      status: 'UNVERIFIABLE',
    });

    client.post.mockResolvedValueOnce({
      status: 'OK',
      value: { repositoryId: '9' },
    });
    await expect(adapter.getRepositoryOwner(REPO)).resolves.toEqual({
      status: 'UNVERIFIABLE',
    });

    expect(warnings()).toHaveLength(3);
    for (const message of warnings()) {
      expect(message).toMatch(/motivo=RESPUESTA_NO_RECONOCIDA, /);
    }
  });

  it('registers INSTALACIONES_NOT_FOUND_COMO_UNVERIFIABLE and keeps the UNVERIFIABLE result', async () => {
    client.post.mockResolvedValue({ status: 'NOT_FOUND' });

    await expect(adapter.listOrganizationInstallations()).resolves.toEqual({
      status: 'UNVERIFIABLE',
    });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(
      /"\/organizations\/installations": motivo=INSTALACIONES_NOT_FOUND_COMO_UNVERIFIABLE, estatus=n\/a, reintentable=n\/a, duracion=\d+ ms\./,
    );
  });

  it('registers LISTA_DE_OWNERS_VACIA for an empty owner list and keeps the UNVERIFIABLE result', async () => {
    client.post.mockResolvedValue({ status: 'OK', value: [] });

    await expect(adapter.listOrganizationOwners(ORG)).resolves.toEqual({
      status: 'UNVERIFIABLE',
    });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(
      /"\/organizations\/owners": motivo=LISTA_DE_OWNERS_VACIA, estatus=n\/a, reintentable=n\/a, duracion=\d+ ms\./,
    );
  });

  it('does not log for legitimate results', async () => {
    client.post.mockResolvedValueOnce({ status: 'OK', value: owner });
    await adapter.getRepositoryOwner(REPO);
    client.post.mockResolvedValueOnce({ status: 'NOT_FOUND' });
    await adapter.getRepositoryById('123', '9');
    client.post.mockResolvedValueOnce({ status: 'NOT_INSTALLED' });
    await adapter.getOrganizationMembership(ORG, '1001');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('never leaks request identifiers or raw error text into logs', async () => {
    const request = {
      installationId: 'inst-LEAK-7781',
      repositoryName: 'leak/repo-LEAK',
      organizationLogin: 'leak-org',
      githubUserId: 'user-LEAK-42',
    };
    client.post.mockRejectedValueOnce(
      new Error(
        `raw body for ${request.installationId} ${request.githubUserId}`,
      ),
    );
    await adapter.getRepositoryPermission(
      {
        installationId: request.installationId,
        repositoryName: request.repositoryName,
      },
      request.githubUserId,
    );
    client.post.mockResolvedValueOnce({ status: 'NOT_FOUND' });
    await adapter.listOrganizationInstallations();
    client.post.mockResolvedValueOnce({ status: 'OK', value: [] });
    await adapter.listOrganizationOwners({
      installationId: request.installationId,
      organizationLogin: request.organizationLogin,
    });

    expect(warnings()).toHaveLength(3);
    for (const message of warnings()) {
      expect(message).not.toContain(request.installationId);
      expect(message).not.toContain(request.repositoryName);
      expect(message).not.toContain(request.organizationLogin);
      expect(message).not.toContain(request.githubUserId);
      expect(message).not.toContain('raw body');
    }
  });
});
