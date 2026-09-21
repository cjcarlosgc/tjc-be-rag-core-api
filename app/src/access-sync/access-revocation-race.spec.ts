import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAccessSyncHarness, INSTALLATION_ID, ORG_ID, ORG_LOGIN } from '../../test/support/access-sync-harness.js';
import { OrganizationAccessResolver } from '../project-access/organization-access.resolver.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import { BindingLifecycleService } from './binding-lifecycle.service.js';

const REPO = 'acme/w';

/**
 * Carrera alta vs evento de revocación, en su lado de eventos (`014/plan.md`, corte 5): un
 * alta cuya verificación comenzó antes de que el binding pasara a `REVOKED` no puede crear
 * (ni conservar) un registro Maintainer/Reader con el estado anterior. Las revocaciones
 * cambian el estado ANTES de borrar y el alta confirma el binding con `FOR SHARE` justo
 * antes del upsert.
 */
describe('signup vs revocation event race (HU59, HU61)', () => {
  let h: ReturnType<typeof buildAccessSyncHarness>;
  let access: ProjectAccessService;
  let lifecycle: BindingLifecycleService;

  beforeEach(() => {
    h = buildAccessSyncHarness();
    access = new ProjectAccessService(
      h.accessRepository,
      new OrganizationAccessResolver(h.github),
      { resolve: (userId: string) => Promise.resolve(`gh-${userId}`) } as never,
      h.github,
    );
    lifecycle = new BindingLifecycleService(h.bindings, h.accessRepository, access, h.subscriptions, h.identities as never);
    h.seedOrgProject('p1', { repositoryId: '100', repositoryName: REPO });
    h.github.addOrganization({ installationId: INSTALLATION_ID, organizationId: ORG_ID, organizationLogin: ORG_LOGIN, avatarUrl: null, suspended: false });
    h.github
      .addRepository(REPO, { repositoryId: '100', ownerId: ORG_ID, ownerLogin: ORG_LOGIN, ownerType: 'Organization' })
      .setMembership(ORG_LOGIN, 'gh-newbie', { role: 'member', state: 'active' })
      .setPermission(REPO, 'gh-newbie', 'read');
  });

  const bindingRow = () => h.db.tables.repositoryBinding[0] as unknown as Parameters<typeof lifecycle.revokeBinding>[0];

  it('an entry verification in flight while the binding is REVOKED does not create the record (and answers no access)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const permission = h.github.getRepositoryPermission.bind(h.github);
    vi.spyOn(h.github, 'getRepositoryPermission').mockImplementation(async (repository, githubUserId) => {
      await gate; // la verificación viva está "en vuelo" con el binding aún ENABLED en su lectura
      return permission(repository, githubUserId);
    });

    const signup = access.grantOnEntry('p1', 'newbie', 'gh-newbie');
    await vi.waitFor(() => expect(h.github.calls.some((call) => call.method === 'getOrganizationMembership')).toBe(true));

    await lifecycle.revokeBinding(bindingRow()); // el evento llega y termina primero (sin registros aún)
    release();

    expect(await signup).toEqual({ status: 'DENIED' });
    expect(h.recordsOf('p1')).toEqual([]);
    expect(h.bindingOf('p1').status).toBe('REVOKED');
  });

  it('a signup that committed before the revocation is removed by it', async () => {
    expect(await access.grantOnEntry('p1', 'newbie', 'gh-newbie')).toEqual({ status: 'GRANTED', role: 'READER' });
    expect(h.recordsOf('p1')).toEqual(['newbie:READER']);

    await lifecycle.revokeBinding(bindingRow());

    expect(h.recordsOf('p1')).toEqual([]);
  });

  it('a signup that starts after the revocation is denied without recreating anything', async () => {
    await lifecycle.revokeBinding(bindingRow());

    expect(await access.grantOnEntry('p1', 'newbie', 'gh-newbie')).toEqual({ status: 'DENIED' });
    expect(h.recordsOf('p1')).toEqual([]);
  });

  it('the Admin keeps entering with a REVOKED binding (to reactivate or delete the project)', async () => {
    h.github.setMembership(ORG_LOGIN, 'gh-boss', { role: 'admin', state: 'active' });
    await lifecycle.revokeBinding(bindingRow());

    expect(await access.grantOnEntry('p1', 'boss', 'gh-boss')).toEqual({ status: 'GRANTED', role: 'ADMIN' });
  });
});
