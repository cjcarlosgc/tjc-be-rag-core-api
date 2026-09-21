import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationInstallation } from '../github-app/github-access.port.js';
import { FakeGithubAccessPort } from '../../test/support/fake-github-access.port.js';
import { WorkspacesService } from './workspaces.service.js';
import { WORKSPACE_VERIFICATION_BUDGET, WORKSPACE_VERIFICATION_CONCURRENCY } from './workspaces.constants.js';

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
  let service: WorkspacesService;

  beforeEach(() => {
    github = new FakeGithubAccessPort();
    identity = { findGithubLogin: vi.fn().mockResolvedValue('octocat') };
    service = new WorkspacesService(github, identity as never);
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
