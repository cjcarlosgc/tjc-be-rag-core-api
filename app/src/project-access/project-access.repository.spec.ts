import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryPrisma } from '../../test/support/in-memory-prisma.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_LOCK_MAX_WAIT_MS, ACCESS_LOCK_TIMEOUT_MS } from './project-access.constants.js';
import { ProjectAccessRepository } from './project-access.repository.js';

describe('ProjectAccessRepository', () => {
  it('withAccessLock takes ONE transaction-scoped advisory lock keyed by (projectId, userId) before the work, with an explicit timeout', async () => {
    const order: string[] = [];
    const tx = {
      $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        order.push(`lock:${strings.join('?')}:${String(values[0])}`);
        return Promise.resolve(0);
      }),
      project: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      projectAccess: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const repository = new ProjectAccessRepository(prisma as unknown as PrismaService);

    await repository.withAccessLock('p1', 'u1', async (scope) => {
      order.push('work');
      await scope.findProject();
      await scope.findRecord();
      await scope.upsertRecord('READER');
      await scope.deleteRecord();
    });

    expect(order[0]).toContain('pg_advisory_xact_lock(hashtextextended(');
    expect(order[0]).toContain('project_access:p1:u1');
    expect(order[1]).toBe('work');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: ACCESS_LOCK_MAX_WAIT_MS,
      timeout: ACCESS_LOCK_TIMEOUT_MS,
    });
    expect(tx.projectAccess.findUnique).toHaveBeenCalledWith({ where: { projectId_userId: { projectId: 'p1', userId: 'u1' } } });
    expect(tx.projectAccess.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ projectId: 'p1', userId: 'u1', role: 'READER' }),
        update: expect.objectContaining({ role: 'READER' }),
      }),
    );
    expect(tx.projectAccess.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1', userId: 'u1' } });
  });

  it('findVisible applies the accessibleProject predicate and includes only the record of the user', async () => {
    const prisma = { project: { findFirst: vi.fn().mockResolvedValue(null) } };
    const repository = new ProjectAccessRepository(prisma as unknown as PrismaService);

    await repository.findVisible('p1', 'u1');

    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', ...accessibleProject('u1') },
      include: { access: { where: { userId: 'u1' } } },
    });
  });

  it('findUnseenOrganizationProjects excludes what the user already sees and does nothing without organizations', async () => {
    const prisma = { project: { findMany: vi.fn().mockResolvedValue([]) } };
    const repository = new ProjectAccessRepository(prisma as unknown as PrismaService);

    await expect(repository.findUnseenOrganizationProjects('u1', [], [], 10)).resolves.toEqual([]);
    expect(prisma.project.findMany).not.toHaveBeenCalled();

    await repository.findUnseenOrganizationProjects('u1', ['1'], ['2'], 10);

    const where = prisma.project.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.NOT).toEqual(accessibleProject('u1'));
    expect(where.OR).toEqual([
      { githubOrgId: { in: ['1'] } },
      { githubOrgId: { in: ['2'] }, repositoryBinding: { is: { status: { not: 'REVOKED' } } } },
    ]);
  });

  it('findRegisteredOrganizations groups the visible organization projects by organization and flags Admin records', async () => {
    const prisma = {
      project: {
        findMany: vi.fn().mockResolvedValue([
          { githubOrgId: '1', githubOrgLogin: 'a', access: [{ role: 'READER' }] },
          { githubOrgId: '1', githubOrgLogin: 'a', access: [{ role: 'ADMIN' }] },
          { githubOrgId: '2', githubOrgLogin: 'b', access: [{ role: 'MAINTAINER' }] },
        ]),
      },
    };
    const repository = new ProjectAccessRepository(prisma as unknown as PrismaService);

    await expect(repository.findRegisteredOrganizations('u1')).resolves.toEqual([
      { organizationId: '1', login: 'a', hasAdmin: true },
      { organizationId: '2', login: 'b', hasAdmin: false },
    ]);
    expect(prisma.project.findMany.mock.calls[0][0].where).toEqual({
      AND: [accessibleProject('u1'), { githubOrgId: { not: null } }],
    });
  });

  it('findNonAdminUserIds returns only the Maintainer and Reader users of the project', async () => {
    const findMany = vi.fn().mockResolvedValue([{ userId: 'writer' }, { userId: 'reader' }]);
    const repository = new ProjectAccessRepository({ projectAccess: { findMany } } as unknown as PrismaService);

    expect(await repository.findNonAdminUserIds('p1')).toEqual(['writer', 'reader']);
    expect(findMany).toHaveBeenCalledWith({ where: { projectId: 'p1', role: { not: 'ADMIN' } }, select: { userId: true } });
  });

  it('withAccessLock exposes the binding status read with FOR SHARE inside the same transaction (null without a binding)', async () => {
    const queries: string[] = [];
    const rows = [[{ status: 'REVOKED' }], []];
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn((strings: TemplateStringsArray) => {
        queries.push(strings.join('?'));
        return Promise.resolve(rows.shift());
      }),
    };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const repository = new ProjectAccessRepository(prisma as unknown as PrismaService);

    const statuses = await repository.withAccessLock('p1', 'u1', async (scope) => [
      await scope.lockBindingStatus(),
      await scope.lockBindingStatus(),
    ]);

    expect(statuses).toEqual(['REVOKED', null]);
    expect(queries[0]).toContain('FOR SHARE');
    expect(queries[0]).toContain('"repository_bindings"');
  });

  describe('event selection queries (HU61, corte 5b), over the in-memory Prisma', () => {
    let db: InMemoryPrisma;
    let repository: ProjectAccessRepository;

    const org = (id: string, orgId: string, binding: string | null, extra: Record<string, unknown> = {}) => {
      db.insert('project', { id, name: id, ownerUserId: 'o', githubOrgId: orgId, githubOrgLogin: `login-${orgId}`, ...extra });
      if (binding !== null) {
        db.insert('repositoryBinding', { projectId: id, installationId: 'i', repositoryId: binding, repositoryName: `x/${id}`, integrationBranch: 'main' });
      }
    };
    const record = (projectId: string, userId: string, role = 'READER') => db.insert('projectAccess', { projectId, userId, role, verifiedAt: new Date() });

    beforeEach(() => {
      db = new InMemoryPrisma();
      repository = new ProjectAccessRepository(db as unknown as PrismaService);
      org('a1', '42', '100');
      org('a2', '42', '101');
      org('a3', '42', null); // sin repositorio
      org('b1', '7', '200');
      org('gone', '42', '300', { deletedAt: new Date() });
      db.insert('project', { id: 'mine', name: 'mine', ownerUserId: 'creator', githubOrgId: null, githubOrgLogin: null });
      db.insert('repositoryBinding', { projectId: 'mine', installationId: 'i', repositoryId: '400', repositoryName: 'c/mine', integrationBranch: 'main' });
      for (const project of ['a1', 'a2', 'a3', 'b1', 'gone']) {
        record(project, 'u1', 'ADMIN');
      }
      record('a1', 'u2');
    });

    const keys = (records: Array<{ projectId: string; userId: string }>) => records.map((row) => `${row.projectId}:${row.userId}`).sort();

    it('findRecords selects by repository, organization (with or without repository), user and project, only over live organization projects', async () => {
      expect(keys(await repository.findRecords({ repositoryId: '100' }))).toEqual(['a1:u1', 'a1:u2']);
      expect(keys(await repository.findRecords({ organizationId: '42' }))).toEqual(['a1:u1', 'a1:u2', 'a2:u1', 'a3:u1']);
      expect(keys(await repository.findRecords({ organizationId: '42', withRepositoryOnly: true }))).toEqual(['a1:u1', 'a1:u2', 'a2:u1']);
      expect(keys(await repository.findRecords({ organizationId: '42', userId: 'u2' }))).toEqual(['a1:u2']);
      expect(keys(await repository.findRecords({ projectId: 'a1' }))).toEqual(['a1:u1', 'a1:u2']);
      expect(keys(await repository.findRecords({ repositoryId: '300' }))).toEqual([]); // Project borrado
      expect(keys(await repository.findRecords({ repositoryId: '400' }))).toEqual([]); // Project personal
    });

    it('findCandidateProjectIds returns the projects the filter points at even when they have no record', async () => {
      expect((await repository.findCandidateProjectIds({ organizationId: '42', withRepositoryOnly: true })).sort()).toEqual(['a1', 'a2']);
      expect((await repository.findCandidateProjectIds({ organizationId: '42' })).sort()).toEqual(['a1', 'a2', 'a3']);
      expect(await repository.findCandidateProjectIds({ repositoryId: '101' })).toEqual(['a2']);
    });

    it('hasLiveOrganizationProjectForRepository is true only for a repository bound to a live ORGANIZATION project', async () => {
      expect(await repository.hasLiveOrganizationProjectForRepository('100')).toBe(true);
      expect(await repository.hasLiveOrganizationProjectForRepository('300')).toBe(false);
      expect(await repository.hasLiveOrganizationProjectForRepository('400')).toBe(false);
      expect(await repository.hasLiveOrganizationProjectForRepository('999')).toBe(false);
    });

    it('findLiveProjectIdsOfOrganization and findAllUserIds', async () => {
      expect((await repository.findLiveProjectIdsOfOrganization('42')).sort()).toEqual(['a1', 'a2', 'a3']);
      expect((await repository.findAllUserIds('a1')).sort()).toEqual(['u1', 'u2']);
      expect(await repository.findNonAdminUserIds('a1')).toEqual(['u2']);
    });

    it('updateOrganizationLogin only touches the projects of that organization', async () => {
      await repository.updateOrganizationLogin('42', 'renamed');

      expect(db.tables.project.map((row) => `${row.id}:${row.githubOrgLogin}`).sort()).toEqual([
        'a1:renamed', 'a2:renamed', 'a3:renamed', 'b1:login-7', 'gone:renamed', 'mine:null',
      ]);
    });

    it('findOrganizationsWithRecords lists each organization once, only live projects with records; findProjectIdsWithRecords pages by id', async () => {
      db.tables.projectAccess.length = 0;
      record('a1', 'u1');
      record('a2', 'u1');
      record('gone', 'u1');
      expect(await repository.findOrganizationsWithRecords()).toEqual([{ organizationId: '42', login: 'login-42' }]);

      record('b1', 'u1');
      const all = await repository.findProjectIdsWithRecords(null, 10);
      expect(all).toEqual(['a1', 'a2', 'b1']);
      expect(await repository.findProjectIdsWithRecords('a1', 1)).toEqual(['a2']);
      expect(await repository.findProjectIdsWithRecords('b1', 10)).toEqual([]);
    });
  });
});
