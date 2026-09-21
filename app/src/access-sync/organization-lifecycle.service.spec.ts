import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAccessSyncHarness, INSTALLATION_ID, ORG_ID, ORG_LOGIN, socketOf } from '../../test/support/access-sync-harness.js';

const W = 'acme/widgets';

/**
 * Ciclo de vida de la organización sobre `projects.githubOrgId/githubOrgLogin` (HU61,
 * `DEC-ORG-001`): la organización que desaparece, la App desinstalada o sin owners dejan sus
 * Projects ocultos y conservados; reaparecen con el binding `REVOKED` hasta que un Admin lo reactive.
 */
describe('OrganizationLifecycleService (HU61)', () => {
  let h: ReturnType<typeof buildAccessSyncHarness>;

  beforeEach(() => {
    h = buildAccessSyncHarness();
    h.seedOrganization({ boss: 'owner', writer: 'member', reader: 'member' });
    h.seedOrgProject('p1', { repositoryId: '100', repositoryName: W });
    h.seedOrgProject('p2', null);
    h.github.addRepository(W, { repositoryId: '100', ownerId: ORG_ID, ownerLogin: ORG_LOGIN, ownerType: 'Organization' }).setPermission(W, 'gh-writer', 'write').setPermission(W, 'gh-reader', 'read');
    h.grant('p1', 'boss', 'ADMIN');
    h.grant('p1', 'writer', 'MAINTAINER');
    h.grant('p1', 'reader', 'READER');
    h.grant('p2', 'boss', 'ADMIN');
  });

  const installations = async () => {
    const lookup = await h.github.listOrganizationInstallations();
    return lookup.status === 'OK' ? lookup.value : [];
  };
  const org = { organizationId: ORG_ID, login: ORG_LOGIN };

  describe('hide (organization deleted, App uninstalled from the organization, no owners)', () => {
    it('keeps every project and its evidence but hides it: bindings REVOKED, ALL records deleted (Admin too), sockets evicted', async () => {
      const boss = socketOf('boss-socket');
      h.subscriptions.track(boss, 'boss', 'v1', 'p2');

      expect(await h.organizations.hide(ORG_ID)).toBe(2);

      expect(h.bindingOf('p1').status).toBe('REVOKED');
      expect(h.recordsOf('p1')).toEqual([]);
      expect(h.recordsOf('p2')).toEqual([]);
      expect(h.db.tables.project.filter((row) => row.deletedAt == null)).toHaveLength(2);
      expect(boss.leave).toHaveBeenCalled();
    });

    it('nobody sees the hidden project through the access predicate (not even the Admin, whose record is gone)', async () => {
      await h.organizations.hide(ORG_ID);
      h.github.removeOrganization(ORG_LOGIN); // la App ya no está instalada: no se puede reverificar

      for (const userId of ['boss', 'writer', 'reader']) {
        expect(await h.accessRepository.findVisible('p1', userId)).toBeNull();
        expect(await h.access.grantOnEntry('p1', userId, `gh-${userId}`)).toEqual({ status: 'DENIED' });
      }
    });

    it('is idempotent and never touches another organization or a personal project', async () => {
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200' });
      h.db.insert('project', { id: 'other', name: 'other', ownerUserId: 'x', githubOrgId: '777', githubOrgLogin: 'other' });
      h.grant('other', 'someone', 'ADMIN');

      await h.organizations.hide(ORG_ID);
      await h.organizations.hide(ORG_ID);

      expect(h.bindingOf('mine').status).toBe('ENABLED');
      expect(h.recordsOf('other')).toEqual(['someone:ADMIN']);
    });

    it('skips logically deleted projects', async () => {
      h.db.insert('project', { id: 'gone', name: 'gone', ownerUserId: 'x', githubOrgId: ORG_ID, githubOrgLogin: ORG_LOGIN, deletedAt: new Date() });
      h.grant('gone', 'someone', 'ADMIN');

      expect(await h.organizations.hide(ORG_ID)).toBe(2);
      expect(h.recordsOf('gone')).toEqual(['someone:ADMIN']);
    });

    it('a failure on one project does not stop the others and is reported at the end', async () => {
      const original = h.access.revoke.bind(h.access);
      vi.spyOn(h.access, 'revoke').mockImplementation((projectId, userId) =>
        projectId === 'p1' && userId === 'writer' ? Promise.reject(new Error('lock timeout')) : original(projectId, userId),
      );

      await expect(h.organizations.hide(ORG_ID)).rejects.toThrow(/incompleto/);

      expect(h.recordsOf('p2')).toEqual([]); // el otro Project sí se ocultó
      expect(h.bindingOf('p1').status).toBe('REVOKED'); // y el estado del fallido ya oculta el Project a Maintainer/Reader
    });
  });

  describe('reappearance', () => {
    it('when the organization comes back the Admin enters again (record recreated), the binding stays REVOKED until an Admin reactivates it, and only then do Maintainer/Reader recover', async () => {
      await h.organizations.hide(ORG_ID);

      // El acceso se recrea al entrar, verificando en vivo: el owner recupera su Project...
      expect(await h.access.grantOnEntry('p1', 'boss', 'gh-boss')).toEqual({ status: 'GRANTED', role: 'ADMIN' });
      // ...y un Maintainer/Reader NO lo ve mientras el binding siga REVOKED.
      expect(await h.access.grantOnEntry('p1', 'writer', 'gh-writer')).toEqual({ status: 'DENIED' });
      expect(h.bindingOf('p1').status).toBe('REVOKED');

      await h.bindings.reactivate(h.bindingOf('p1').id, INSTALLATION_ID); // `POST .../enable` por un Admin

      expect(await h.access.grantOnEntry('p1', 'writer', 'gh-writer')).toEqual({ status: 'GRANTED', role: 'MAINTAINER' });
      expect(await h.access.grantOnEntry('p2', 'boss', 'gh-boss')).toEqual({ status: 'GRANTED', role: 'ADMIN' }); // sin repositorio: solo Admin
    });
  });

  describe('rename', () => {
    it('updates the stored login of the projects of that organization only', async () => {
      h.db.insert('project', { id: 'other', name: 'other', ownerUserId: 'x', githubOrgId: '777', githubOrgLogin: 'other' });

      await h.organizations.rename(ORG_ID, 'acme-renamed');

      expect(h.db.tables.project.map((row) => `${row.id}:${row.githubOrgLogin}`).sort()).toEqual(['other:other', 'p1:acme-renamed', 'p2:acme-renamed']);
    });

    it('the access checks keep working by id after a rename (the login the resolver uses is the installation one)', async () => {
      h.github.removeOrganization(ORG_LOGIN);
      h.github.addOrganization({ installationId: INSTALLATION_ID, organizationId: ORG_ID, organizationLogin: 'acme-renamed', avatarUrl: null, suspended: false });
      h.github.setMembership('acme-renamed', 'gh-writer', { role: 'member', state: 'active' });
      h.github.setPermission(W, 'gh-writer', 'write');

      expect(await h.access.reverify('p1', 'writer', 'gh-writer')).toBe('UNCHANGED');
    });
  });

  describe('reconcile (part (a)): resolvable organization, App installed, at least one active owner', () => {
    it('OK when the organization is installed with owners and nothing changed', async () => {
      expect(await h.organizations.reconcile(org, await installations())).toBe('OK');
      expect(h.recordsOf('p1')).toHaveLength(3);
    });

    it('HIDDEN when the installation is no longer in the list (App uninstalled: confirmed, not an outage)', async () => {
      h.github.removeOrganization(ORG_LOGIN);

      expect(await h.organizations.reconcile(org, await installations())).toBe('HIDDEN');
      expect(h.recordsOf('p1')).toEqual([]);
      expect(h.bindingOf('p1').status).toBe('REVOKED');
    });

    it.each(['NOT_INSTALLED'] as const)('HIDDEN when the owners read answers %s', async (mode) => {
      h.github.setOrganizationMode(ORG_LOGIN, mode);

      expect(await h.organizations.reconcile(org, await installations())).toBe('HIDDEN');
      expect(h.recordsOf('p2')).toEqual([]);
    });

    it('HIDDEN when the organization has no owners', async () => {
      h.github.setOwners(ORG_LOGIN, []);

      expect(await h.organizations.reconcile(org, await installations())).toBe('HIDDEN');
    });

    it('UNVERIFIABLE (nothing touched) when the owners read is not verifiable (network, 5xx, rate limit, Members: read missing)', async () => {
      h.github.setOrganizationMode(ORG_LOGIN, 'UNVERIFIABLE');

      expect(await h.organizations.reconcile(org, await installations())).toBe('UNVERIFIABLE');
      expect(h.recordsOf('p1')).toHaveLength(3);
      expect(h.bindingOf('p1').status).toBe('ENABLED');
    });

    it('UNVERIFIABLE (nothing touched) for a suspended installation', async () => {
      h.github.removeOrganization(ORG_LOGIN);
      h.github.addOrganization({ installationId: INSTALLATION_ID, organizationId: ORG_ID, organizationLogin: ORG_LOGIN, avatarUrl: null, suspended: true });

      expect(await h.organizations.reconcile(org, await installations())).toBe('UNVERIFIABLE');
      expect(h.recordsOf('p1')).toHaveLength(3);
    });

    it('RENAMED corrects a stored login that no longer matches the installation (a lost or out-of-order organization.renamed)', async () => {
      expect(await h.organizations.reconcile({ organizationId: ORG_ID, login: 'stale-login' }, await installations())).toBe('RENAMED');
      expect(h.db.tables.project.every((row) => row.githubOrgLogin === ORG_LOGIN)).toBe(true);
    });

    it('FAILED (and it never throws) when hiding fails unexpectedly', async () => {
      h.github.setOwners(ORG_LOGIN, []);
      vi.spyOn(h.organizations, 'hide').mockRejectedValue(new Error('db down'));

      expect(await h.organizations.reconcile(org, await installations())).toBe('FAILED');
    });
  });
});
