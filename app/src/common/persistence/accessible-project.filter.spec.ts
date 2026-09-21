import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryPrisma } from '../../../test/support/in-memory-prisma.js';
import { accessibleProject, isRoleAtLeast, rolesAtLeast } from './accessible-project.filter.js';
import type { ProjectRole } from '../../generated/prisma/client.js';

describe('rolesAtLeast / isRoleAtLeast (hierarchy ADMIN ⊃ MAINTAINER ⊃ READER)', () => {
  it('lists the roles that satisfy a minimum, from the lowest to the highest', () => {
    expect(rolesAtLeast('READER')).toEqual(['READER', 'MAINTAINER', 'ADMIN']);
    expect(rolesAtLeast('MAINTAINER')).toEqual(['MAINTAINER', 'ADMIN']);
    expect(rolesAtLeast('ADMIN')).toEqual(['ADMIN']);
  });

  it.each([
    ['ADMIN', 'READER', true],
    ['ADMIN', 'MAINTAINER', true],
    ['ADMIN', 'ADMIN', true],
    ['MAINTAINER', 'READER', true],
    ['MAINTAINER', 'ADMIN', false],
    ['READER', 'MAINTAINER', false],
    ['READER', 'READER', true],
  ] as const)('%s vs minimum %s -> %s', (role, min, expected) => {
    expect(isRoleAtLeast(role, min)).toBe(expected);
  });
});

/**
 * Semántica del predicado `accessibleProject` evaluada sobre datos (no solo su forma):
 * personal por creador, organización por registro suficiente Y (binding no REVOKED o
 * rol ADMIN), en cada petición y sin depender de que un `REVOKED` haya borrado registros.
 */
describe('accessibleProject (predicate evaluated over data)', () => {
  let db: InMemoryPrisma;

  const seedProject = (id: string, fields: Record<string, unknown> = {}) =>
    db.insert('project', { id, name: id, ownerUserId: 'creator', githubOrgId: null, githubOrgLogin: null, ...fields });
  const org = { githubOrgId: '42', githubOrgLogin: 'acme' };
  const bind = (projectId: string, status: string) =>
    db.insert('repositoryBinding', { projectId, status, repositoryName: `acme/${projectId}` });
  const grant = (projectId: string, userId: string, role: ProjectRole) =>
    db.insert('projectAccess', { projectId, userId, role, verifiedAt: new Date() });

  async function visibleTo(userId: string, minRole?: ProjectRole): Promise<string[]> {
    const rows = (await (db.project as { findMany: (a: unknown) => Promise<Array<{ id: string }>> }).findMany({
      where: accessibleProject(userId, minRole),
    })) as Array<{ id: string }>;
    return rows.map((row) => row.id).sort();
  }

  beforeEach(() => {
    db = new InMemoryPrisma();
    seedProject('personal', { ownerUserId: 'creator' });
    seedProject('org-no-repo', org);
    seedProject('org-enabled', org);
    seedProject('org-disabled', org);
    seedProject('org-revoked', org);
    seedProject('org-deleted', { ...org, deletedAt: new Date() });
    seedProject('personal-deleted', { ownerUserId: 'creator', deletedAt: new Date() });
    bind('org-enabled', 'ENABLED');
    bind('org-disabled', 'DISABLED');
    bind('org-revoked', 'REVOKED');
    // Un Admin (owner) en todos; un Maintainer y un Reader con registro en los que tienen repositorio.
    for (const id of ['org-no-repo', 'org-enabled', 'org-disabled', 'org-revoked', 'org-deleted']) {
      grant(id, 'owner', 'ADMIN');
    }
    for (const id of ['org-enabled', 'org-disabled', 'org-revoked']) {
      grant(id, 'maintainer', 'MAINTAINER');
      grant(id, 'reader', 'READER');
    }
  });

  it('a personal project is visible only to its creator (role ADMIN, no access record), never shared', async () => {
    expect(await visibleTo('creator')).toEqual(['personal']);
    expect(await visibleTo('collaborator')).toEqual([]);
    expect(await visibleTo('creator', 'ADMIN')).toEqual(['personal']);
  });

  it('a personal project is not made visible by an access record of another user (records exist only for organizations)', async () => {
    grant('personal', 'intruder', 'ADMIN');

    expect(await visibleTo('intruder')).toEqual([]);
  });

  it('an organization Admin sees every live project, even without repository or with the binding REVOKED', async () => {
    expect(await visibleTo('owner')).toEqual(['org-disabled', 'org-enabled', 'org-no-repo', 'org-revoked']);
  });

  it('a Maintainer or Reader record gives NO access while the binding is REVOKED, even though the record still exists', async () => {
    expect(db.tables.projectAccess.some((row) => row.projectId === 'org-revoked' && row.userId === 'maintainer')).toBe(true);
    expect(await visibleTo('maintainer')).toEqual(['org-disabled', 'org-enabled']);
    expect(await visibleTo('reader')).toEqual(['org-disabled', 'org-enabled']);
  });

  it('is evaluated on every request: flipping the binding to REVOKED (without deleting records) hides the project at once, and reactivating restores it', async () => {
    expect(await visibleTo('reader')).toContain('org-enabled');

    (db.tables.repositoryBinding.find((row) => row.projectId === 'org-enabled') as { status: string }).status = 'REVOKED';
    expect(await visibleTo('reader')).not.toContain('org-enabled');
    expect(await visibleTo('owner')).toContain('org-enabled');

    (db.tables.repositoryBinding.find((row) => row.projectId === 'org-enabled') as { status: string }).status = 'ENABLED';
    expect(await visibleTo('reader')).toContain('org-enabled');
  });

  it('a project without repository only shows to its Admins (a Maintainer record does not make it visible for lacking binding-independent proof)', async () => {
    // El alta nunca crea Maintainer/Reader sin repositorio; el registro Admin sí ve el Project.
    expect(await visibleTo('owner')).toContain('org-no-repo');
    expect(await visibleTo('maintainer')).not.toContain('org-no-repo');
    expect(await visibleTo('reader')).not.toContain('org-no-repo');
  });

  it('honors the minimum role: a Reader does not satisfy MAINTAINER or ADMIN, a Maintainer does not satisfy ADMIN', async () => {
    expect(await visibleTo('reader', 'MAINTAINER')).toEqual([]);
    expect(await visibleTo('maintainer', 'MAINTAINER')).toEqual(['org-disabled', 'org-enabled']);
    expect(await visibleTo('maintainer', 'ADMIN')).toEqual([]);
    expect(await visibleTo('owner', 'ADMIN')).toEqual(['org-disabled', 'org-enabled', 'org-no-repo', 'org-revoked']);
  });

  it('a logically deleted project is invisible to everyone, personal or organization', async () => {
    expect(await visibleTo('owner')).not.toContain('org-deleted');
    expect(await visibleTo('creator')).not.toContain('personal-deleted');
  });

  it('a user without any record or ownership sees nothing (external collaborator / stranger)', async () => {
    expect(await visibleTo('stranger')).toEqual([]);
  });

  it('works as a relation filter (project: accessibleProject(...)) for descendant resources', async () => {
    db.insert('analysisRun', { id: 'run-revoked', projectId: 'org-revoked' });
    db.insert('analysisRun', { id: 'run-enabled', projectId: 'org-enabled' });
    db.insert('analysisRun', { id: 'run-personal', projectId: 'personal' });
    const runs = async (userId: string) =>
      (
        (await (db.analysisRun as { findMany: (a: unknown) => Promise<Array<{ id: string }>> }).findMany({
          where: { project: accessibleProject(userId) },
        })) as Array<{ id: string }>
      )
        .map((row) => row.id)
        .sort();

    expect(await runs('reader')).toEqual(['run-enabled']);
    expect(await runs('owner')).toEqual(['run-enabled', 'run-revoked']);
    expect(await runs('creator')).toEqual(['run-personal']);
    expect(await runs('stranger')).toEqual([]);
  });
});
