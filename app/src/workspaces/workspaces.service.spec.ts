import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationInstallation } from '../github-app/github-access.port.js';
import { FakeGithubAccessPort } from '../../test/support/fake-github-access.port.js';
import { WorkspacesService } from './workspaces.service.js';
import { OrganizationAccessResolver } from '../project-access/organization-access.resolver.js';
import {
  ACCESS_VERIFICATION_BUDGET as WORKSPACE_VERIFICATION_BUDGET,
  ACCESS_VERIFICATION_CONCURRENCY as WORKSPACE_VERIFICATION_CONCURRENCY,
} from '../project-access/project-access.constants.js';

const USER_ID = 'sub-1';
const GITHUB_USER_ID = '1001';

function installation(id: number, login: string, extra: Partial<OrganizationInstallation> = {}): OrganizationInstallation {
  return {
    installationId: `inst-${id}`,
    organizationId: String(id),
    organizationLogin: login,
    avatarUrl: `https://avatars/${login}`,
    suspended: false,
    ...extra,
  };
}

describe('WorkspacesService (HU58)', () => {
  let github: FakeGithubAccessPort;
  let identity: { findGithubLogin: ReturnType<typeof vi.fn> };
  let accessRepository: { findRegisteredOrganizations: ReturnType<typeof vi.fn> };
  let service: WorkspacesService;

  beforeEach(() => {
    github = new FakeGithubAccessPort();
    identity = { findGithubLogin: vi.fn().mockResolvedValue('octocat') };
    accessRepository = { findRegisteredOrganizations: vi.fn().mockResolvedValue([]) };
    service = new WorkspacesService(new OrganizationAccessResolver(github), accessRepository as never, identity as never);
  });

  it('lists only the personal workspace, first and as ADMIN, for a user without organizations', async () => {
    await expect(service.list(USER_ID, GITHUB_USER_ID)).resolves.toEqual({
      items: [
        {
          kind: 'PERSONAL',
          id: GITHUB_USER_ID,
          login: 'octocat',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1001',
          role: 'ADMIN',
        },
      ],
    });
  });

  it('exposes a null login for a personal workspace whose login Core does not know yet', async () => {
    identity.findGithubLogin.mockResolvedValue(null);

    const { items } = await service.list(USER_ID, GITHUB_USER_ID);

    expect(items[0]).toMatchObject({ kind: 'PERSONAL', login: null });
  });

  it('adds the organizations with the App installed where the user is an active member, ordered by login', async () => {
    github
      .addOrganization(installation(30, 'zeta'))
      .addOrganization(installation(10, 'Acme'))
      .addOrganization(installation(20, 'beta'))
      .setMembership('zeta', GITHUB_USER_ID, { role: 'admin', state: 'active' })
      .setMembership('Acme', GITHUB_USER_ID, { role: 'member', state: 'active' })
      .setMembership('beta', GITHUB_USER_ID, { role: 'member', state: 'active' });

    const { items } = await service.list(USER_ID, GITHUB_USER_ID);

    expect(items.map((item) => [item.kind, item.login, item.role])).toEqual([
      ['PERSONAL', 'octocat', 'ADMIN'],
      ['ORGANIZATION', 'Acme', 'MEMBER'],
      ['ORGANIZATION', 'beta', 'MEMBER'],
      ['ORGANIZATION', 'zeta', 'ADMIN'],
    ]);
    expect(items[1]).toEqual({
      kind: 'ORGANIZATION',
      id: '10',
      login: 'Acme',
      avatarUrl: 'https://avatars/Acme',
      role: 'MEMBER',
    });
  });

  it('does not offer an organization where the user is not a member, has a pending invitation or is unverifiable', async () => {
    github
      .addOrganization(installation(1, 'stranger-org')) // sin membresía fijada = NOT_FOUND
      .addOrganization(installation(2, 'pending-org'))
      .addOrganization(installation(3, 'no-members-read')) // Members: read sin aceptar
      .addOrganization(installation(4, 'uninstalled-org')) // NOT_INSTALLED al pedir el token
      .addOrganization(installation(5, 'ok-org'))
      .setMembership('pending-org', GITHUB_USER_ID, { role: 'admin', state: 'pending' })
      .setMembership('no-members-read', GITHUB_USER_ID, { role: 'admin', state: 'active' })
      .setOrganizationMode('no-members-read', 'UNVERIFIABLE')
      .setOrganizationMode('uninstalled-org', 'NOT_INSTALLED')
      .setMembership('ok-org', GITHUB_USER_ID, { role: 'member', state: 'active' });

    const { items } = await service.list(USER_ID, GITHUB_USER_ID);

    expect(items.map((item) => item.login)).toEqual(['octocat', 'ok-org']);
  });

  it('does not offer the organizations of another user membership (membership is per githubUserId)', async () => {
    github.addOrganization(installation(1, 'acme')).setMembership('acme', '2002', { role: 'admin', state: 'active' });

    const { items } = await service.list(USER_ID, GITHUB_USER_ID);

    expect(items.map((item) => item.kind)).toEqual(['PERSONAL']);
  });

  it('skips suspended installations without verifying them and lists an organization once', async () => {
    github
      .addOrganization(installation(1, 'sleepy', { suspended: true }))
      .addOrganization(installation(2, 'acme'))
      .setMembership('acme', GITHUB_USER_ID, { role: 'member', state: 'active' });

    const { items } = await service.list(USER_ID, GITHUB_USER_ID);

    expect(items.map((item) => item.login)).toEqual(['octocat', 'acme']);
    expect(github.calls.filter((call) => call.method === 'getOrganizationMembership')).toHaveLength(1);
  });

  it('degrades to the personal workspace only when GitHub cannot list the installations', async () => {
    github.installationsMode = 'UNVERIFIABLE';

    const { items } = await service.list(USER_ID, GITHUB_USER_ID);

    expect(items.map((item) => item.kind)).toEqual(['PERSONAL']);
    expect(github.calls.some((call) => call.method === 'getOrganizationMembership')).toBe(false);
  });

  describe('fallback with the organizations of registered access (corte 3)', () => {
    const registered = (organizationId: string, login: string, hasAdmin: boolean) => ({ organizationId, login, hasAdmin });

    it('with GitHub down offers the personal workspace plus the organizations where the user already has access, ordered by login', async () => {
      github.installationsMode = 'UNVERIFIABLE';
      accessRepository.findRegisteredOrganizations.mockResolvedValue([
        registered('30', 'zeta', false),
        registered('10', 'Acme', true),
      ]);

      const { items } = await service.list(USER_ID, GITHUB_USER_ID);

      expect(items.map((item) => [item.kind, item.id, item.login, item.role])).toEqual([
        ['PERSONAL', GITHUB_USER_ID, 'octocat', 'ADMIN'],
        ['ORGANIZATION', '10', 'Acme', 'ADMIN'],
        ['ORGANIZATION', '30', 'zeta', 'MEMBER'],
      ]);
      expect(items[1].avatarUrl).toBe('https://avatars.githubusercontent.com/u/10');
      expect(accessRepository.findRegisteredOrganizations).toHaveBeenCalledWith(USER_ID);
    });

    it('never offers a NEW organization when GitHub is down (nothing registered)', async () => {
      github.installationsMode = 'UNVERIFIABLE';
      github.addOrganization(installation(1, 'acme')).setMembership('acme', GITHUB_USER_ID, { role: 'admin', state: 'active' });

      const { items } = await service.list(USER_ID, GITHUB_USER_ID);

      expect(items.map((item) => item.kind)).toEqual(['PERSONAL']);
    });

    it('keeps a registered organization whose membership is unverifiable or whose installation is suspended, with the current login', async () => {
      github
        .addOrganization(installation(1, 'flaky-renamed'))
        .addOrganization(installation(2, 'sleepy', { suspended: true }))
        .setOrganizationMode('flaky-renamed', 'UNVERIFIABLE');
      accessRepository.findRegisteredOrganizations.mockResolvedValue([
        registered('1', 'flaky', false),
        registered('2', 'sleepy', true),
      ]);

      const { items } = await service.list(USER_ID, GITHUB_USER_ID);

      expect(items.slice(1).map((item) => [item.login, item.role])).toEqual([
        ['flaky-renamed', 'MEMBER'],
        ['sleepy', 'ADMIN'],
      ]);
    });

    it('does not offer a registered organization whose App was uninstalled (absent from the installations) or where the user is no longer a member', async () => {
      github
        .addOrganization(installation(2, 'left-org'))
        .setMembership('left-org', '9999', { role: 'member', state: 'active' });
      accessRepository.findRegisteredOrganizations.mockResolvedValue([
        registered('1', 'uninstalled-org', true),
        registered('2', 'left-org', true),
      ]);

      const { items } = await service.list(USER_ID, GITHUB_USER_ID);

      expect(items.map((item) => item.kind)).toEqual(['PERSONAL']);
    });

    it('does not query the registered access when every organization was verified', async () => {
      github.addOrganization(installation(1, 'acme')).setMembership('acme', GITHUB_USER_ID, { role: 'member', state: 'active' });

      await service.list(USER_ID, GITHUB_USER_ID);

      expect(accessRepository.findRegisteredOrganizations).not.toHaveBeenCalled();
    });
  });

  it('keeps the verifiable organizations when GitHub fails for one of them', async () => {
    github
      .addOrganization(installation(1, 'flaky'))
      .addOrganization(installation(2, 'acme'))
      .setMembership('flaky', GITHUB_USER_ID, { role: 'member', state: 'active' })
      .setOrganizationMode('flaky', 'UNVERIFIABLE')
      .setMembership('acme', GITHUB_USER_ID, { role: 'member', state: 'active' });

    const { items } = await service.list(USER_ID, GITHUB_USER_ID);

    expect(items.map((item) => item.login)).toEqual(['octocat', 'acme']);
  });

  it('bounds the verifications per request and never exceeds the concurrency limit', async () => {
    const total = WORKSPACE_VERIFICATION_BUDGET + 7;
    for (let id = 1; id <= total; id += 1) {
      const login = `org-${String(id).padStart(3, '0')}`;
      github.addOrganization(installation(id, login)).setMembership(login, GITHUB_USER_ID, { role: 'member', state: 'active' });
    }
    let active = 0;
    let peak = 0;
    const original = github.getOrganizationMembership.bind(github);
    github.getOrganizationMembership = async (...args) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      const result = await original(...args);
      active -= 1;
      return result;
    };

    const { items } = await service.list(USER_ID, GITHUB_USER_ID);

    expect(github.calls.filter((call) => call.method === 'getOrganizationMembership')).toHaveLength(
      WORKSPACE_VERIFICATION_BUDGET,
    );
    expect(items).toHaveLength(1 + WORKSPACE_VERIFICATION_BUDGET);
    expect(peak).toBeLessThanOrEqual(WORKSPACE_VERIFICATION_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it('personalRef returns the personal workspace reference of the session', async () => {
    await expect(service.personalRef(USER_ID, GITHUB_USER_ID)).resolves.toEqual({
      kind: 'PERSONAL',
      id: GITHUB_USER_ID,
      login: 'octocat',
    });
    expect(identity.findGithubLogin).toHaveBeenCalledWith(USER_ID);
  });
});
