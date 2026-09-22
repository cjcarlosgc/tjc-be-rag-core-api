import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGithubAccessPort } from '../../test/support/fake-github-access.port.js';
import { OrganizationAccessResolver, VerificationContext } from './organization-access.resolver.js';

const installation = (id: number, login: string, extra: Record<string, unknown> = {}) => ({
  installationId: `inst-${id}`,
  organizationId: String(id),
  organizationLogin: login,
  avatarUrl: null,
  suspended: false,
  ...extra,
});

describe('OrganizationAccessResolver', () => {
  let github: FakeGithubAccessPort;
  let resolver: OrganizationAccessResolver;

  beforeEach(() => {
    github = new FakeGithubAccessPort();
    resolver = new OrganizationAccessResolver(github);
  });

  describe('resolveWorkspace', () => {
    it('omitted or the own numeric id is the personal workspace, without calling GitHub', async () => {
      await expect(resolver.resolveWorkspace(undefined, '1001')).resolves.toEqual({ status: 'PERSONAL' });
      await expect(resolver.resolveWorkspace('1001', '1001')).resolves.toEqual({ status: 'PERSONAL' });
      expect(github.calls).toEqual([]);
    });

    it.each(['octocat', '01001', '', '-5', '1e3'])('a non-numeric value (%s) is not a workspace and does not reach GitHub', async (value) => {
      await expect(resolver.resolveWorkspace(value, '1001')).resolves.toEqual({ status: 'NOT_FOUND' });
      expect(github.calls).toEqual([]);
    });

    it('resolves an organization where the user is an active member, with the live login and the owner role', async () => {
      github.addOrganization(installation(42, 'acme-live')).setMembership('acme-live', '1001', { role: 'admin', state: 'active' });

      await expect(resolver.resolveWorkspace('42', '1001')).resolves.toEqual({
        status: 'ORGANIZATION',
        organization: { organizationId: '42', login: 'acme-live', installationId: 'inst-42', avatarUrl: null, role: 'ADMIN' },
      });
    });

    it.each([
      ['a foreign account id', () => undefined],
      ['an organization without the App', () => undefined],
    ])('%s is NOT_FOUND', async () => {
      await expect(resolver.resolveWorkspace('4242', '1001')).resolves.toEqual({ status: 'NOT_FOUND' });
    });

    it('a non-member, a pending invitation and an uninstalled App are all NOT_FOUND (indistinguishable)', async () => {
      github
        .addOrganization(installation(1, 'strangers'))
        .addOrganization(installation(2, 'pending-org'))
        .addOrganization(installation(3, 'gone-org'))
        .setMembership('pending-org', '1001', { role: 'admin', state: 'pending' })
        .setOrganizationMode('gone-org', 'NOT_INSTALLED');

      for (const id of ['1', '2', '3']) {
        await expect(resolver.resolveWorkspace(id, '1001')).resolves.toEqual({ status: 'NOT_FOUND' });
      }
    });

    it('is UNVERIFIABLE when the installations cannot be listed, the installation is suspended or the membership is unverifiable', async () => {
      github.addOrganization(installation(1, 'sleepy', { suspended: true })).addOrganization(installation(2, 'flaky'));
      github.setOrganizationMode('flaky', 'UNVERIFIABLE');

      await expect(resolver.resolveWorkspace('1', '1001')).resolves.toEqual({ status: 'UNVERIFIABLE' });
      await expect(resolver.resolveWorkspace('2', '1001')).resolves.toEqual({ status: 'UNVERIFIABLE' });

      github.installationsMode = 'UNVERIFIABLE';
      await expect(resolver.resolveWorkspace('2', '1001', new VerificationContext())).resolves.toEqual({ status: 'UNVERIFIABLE' });
    });
  });

  it('a VerificationContext lists the installations only once across resolutions, but membership is read every time', async () => {
    github.addOrganization(installation(1, 'a')).addOrganization(installation(2, 'b'));
    const context = new VerificationContext();

    await resolver.resolve('1', '1001', context);
    await resolver.resolve('2', '1001', context);
    await resolver.resolve('2', '1001', context);

    expect(github.calls.filter((call) => call.method === 'listOrganizationInstallations')).toHaveLength(1);
    expect(github.calls.filter((call) => call.method === 'getOrganizationMembership')).toHaveLength(3);
  });

  it('listMemberOrganizations separates members from unverifiable installations', async () => {
    github
      .addOrganization(installation(1, 'ok'))
      .addOrganization(installation(2, 'flaky'))
      .addOrganization(installation(3, 'sleepy', { suspended: true }))
      .addOrganization(installation(4, 'strangers'))
      .setMembership('ok', '1001', { role: 'member', state: 'active' })
      .setOrganizationMode('flaky', 'UNVERIFIABLE');

    const result = await resolver.listMemberOrganizations('1001');

    expect(result.status).toBe('OK');
    if (result.status === 'OK') {
      expect(result.member.map((organization) => organization.login)).toEqual(['ok']);
      expect(result.unverifiable.map((organization) => organization.organizationLogin).sort()).toEqual(['flaky', 'sleepy']);
    }
  });
});
