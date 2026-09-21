import { describe, expect, it, vi } from 'vitest';
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
});
