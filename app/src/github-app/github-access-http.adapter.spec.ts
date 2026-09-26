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
