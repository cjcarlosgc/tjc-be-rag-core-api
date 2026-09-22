import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsRepository } from './projects.repository.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('ProjectsRepository.softDelete (HU56)', () => {
  let tx: {
    project: { updateMany: ReturnType<typeof vi.fn> };
    repositoryBinding: { deleteMany: ReturnType<typeof vi.fn> };
    analysisRun: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    testPublication: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
  };
  let repository: ProjectsRepository;

  beforeEach(() => {
    tx = {
      project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      repositoryBinding: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      analysisRun: {
        findMany: vi.fn().mockResolvedValue([{ id: 'run-1' }, { id: 'run-2' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      testPublication: {
        findMany: vi.fn().mockResolvedValue([{ id: 'pub-1' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: vi.fn().mockResolvedValue(3),
    };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    repository = new ProjectsRepository(prisma as unknown as PrismaService);
  });

  it('marks deletedAt, frees the binding and closes in-flight runs, publications and jobs in one transaction', async () => {
    const result = await repository.softDelete('p1', 'u1');

    expect(result).toBe(true);
    expect(tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', ...accessibleProject('u1', 'ADMIN') },
      data: { deletedAt: expect.any(Date) },
    });
    expect(tx.repositoryBinding.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(tx.analysisRun.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', status: { in: ['QUEUED', 'PROCESSING', 'ACTION_REQUIRED'] } },
      select: { id: true },
    });
    expect(tx.analysisRun.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['run-1', 'run-2'] } },
      data: { status: 'OBSOLETE', current: false, completedAt: expect.any(Date) },
    });
    expect(tx.testPublication.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pub-1'] } },
      data: { status: 'FAILED', failureMessage: 'PROJECT_DELETED' },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('returns false and touches nothing else when the project is missing, foreign or already deleted', async () => {
    tx.project.updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.softDelete('p1', 'u1');

    expect(result).toBe(false);
    expect(tx.repositoryBinding.deleteMany).not.toHaveBeenCalled();
    expect(tx.analysisRun.updateMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('skips the run and publication updates when nothing is in flight but still cancels pending jobs', async () => {
    tx.analysisRun.findMany.mockResolvedValue([]);
    tx.testPublication.findMany.mockResolvedValue([]);

    await repository.softDelete('p1', 'u1');

    expect(tx.analysisRun.updateMany).not.toHaveBeenCalled();
    expect(tx.testPublication.updateMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectsRepository workspace and role operations (HU63)', () => {
  it('createInOrganization inserts the Project and the ADMIN access record of its creator in ONE transaction', async () => {
    const tx = {
      project: { create: vi.fn().mockResolvedValue({ id: 'p-org' }) },
      projectAccess: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const repository = new ProjectsRepository(prisma as unknown as PrismaService);

    await repository.createInOrganization('demo', 'u1', { id: '42', login: 'acme' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.project.create).toHaveBeenCalledWith({
      data: { name: 'demo', ownerUserId: 'u1', githubOrgId: '42', githubOrgLogin: 'acme' },
    });
    expect(tx.projectAccess.create).toHaveBeenCalledWith({
      data: { projectId: 'p-org', userId: 'u1', role: 'ADMIN', verifiedAt: expect.any(Date) },
    });
  });

  it('a personal Project is created without any access record', async () => {
    const prisma = { project: { create: vi.fn().mockResolvedValue({ id: 'p' }) }, projectAccess: { create: vi.fn() } };
    const repository = new ProjectsRepository(prisma as unknown as PrismaService);

    await repository.create('demo', 'u1');

    expect(prisma.project.create).toHaveBeenCalledWith({ data: { name: 'demo', ownerUserId: 'u1' } });
    expect(prisma.projectAccess.create).not.toHaveBeenCalled();
  });

  it('rename only touches a Project the user can administer', async () => {
    const prisma = { project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const repository = new ProjectsRepository(prisma as unknown as PrismaService);

    await expect(repository.rename('p1', 'new', 'u1')).resolves.toBe(true);
    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', ...accessibleProject('u1', 'ADMIN') },
      data: { name: 'new' },
    });

    prisma.project.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.rename('p1', 'new', 'u1')).resolves.toBe(false);
  });

  it('findAll lists the visible Projects with the access record of the user, optionally by workspace', async () => {
    const prisma = { project: { findMany: vi.fn().mockResolvedValue([]) } };
    const repository = new ProjectsRepository(prisma as unknown as PrismaService);

    await repository.findAll(10, 'u1', 'c1', { githubOrgId: '42' });

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { ...accessibleProject('u1'), githubOrgId: '42' },
      include: { access: { where: { userId: 'u1' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 11,
      cursor: { id: 'c1' },
      skip: 1,
    });

    await repository.findAll(10, 'u1');
    expect(prisma.project.findMany.mock.calls[1][0].where).toEqual(accessibleProject('u1'));
  });
});
