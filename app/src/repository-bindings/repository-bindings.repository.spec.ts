import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryBindingsRepository } from './repository-bindings.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('RepositoryBindingsRepository — HU57 status transitions', () => {
  let prisma: { repositoryBinding: { update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> } };
  let repository: RepositoryBindingsRepository;

  beforeEach(() => {
    prisma = { repositoryBinding: { update: vi.fn(), updateMany: vi.fn() } };
    repository = new RepositoryBindingsRepository(prisma as unknown as PrismaService);
  });

  it('updateStatus stores the disabled reason only for DISABLED and clears it otherwise', async () => {
    await repository.updateStatus('b1', 'DISABLED', 'INSTALLATION_SUSPENDED');
    await repository.updateStatus('b1', 'REVOKED');

    expect(prisma.repositoryBinding.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'b1' },
      data: { status: 'DISABLED', disabledReason: 'INSTALLATION_SUSPENDED' },
    });
    expect(prisma.repositoryBinding.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'b1' },
      data: { status: 'REVOKED', disabledReason: null },
    });
  });

  it('reactivate enables, clears the reason and refreshes the installation', async () => {
    await repository.reactivate('b1', 'install-9');

    expect(prisma.repositoryBinding.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { status: 'ENABLED', disabledReason: null, installationId: 'install-9' },
    });
  });

  it('suspend only pauses ENABLED bindings (never REVOKED nor a user pause)', async () => {
    await repository.suspendByInstallation('i1');

    expect(prisma.repositoryBinding.updateMany).toHaveBeenCalledWith({
      where: { installationId: 'i1', status: 'ENABLED' },
      data: { status: 'DISABLED', disabledReason: 'INSTALLATION_SUSPENDED' },
    });
  });

  it('unsuspend only resumes bindings disabled by the suspension', async () => {
    await repository.unsuspendByInstallation('i1');

    expect(prisma.repositoryBinding.updateMany).toHaveBeenCalledWith({
      where: { installationId: 'i1', status: 'DISABLED', disabledReason: 'INSTALLATION_SUSPENDED' },
      data: { status: 'ENABLED', disabledReason: null },
    });
  });

  it('revoke applies to every binding of the installation', async () => {
    await repository.revokeByInstallation('i1');

    expect(prisma.repositoryBinding.updateMany).toHaveBeenCalledWith({
      where: { installationId: 'i1' },
      data: { status: 'REVOKED', disabledReason: null },
    });
  });
});

describe('RepositoryBindingsRepository.findForRun (HU56)', () => {
  it('requires the binding to belong to the Run project and the project to be alive', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new RepositoryBindingsRepository({ repositoryBinding: { findFirst } } as unknown as PrismaService);

    await repository.findForRun({ repositoryId: 'r1', projectId: 'p1' });

    expect(findFirst).toHaveBeenCalledWith({
      where: { repositoryId: 'r1', projectId: 'p1', project: { deletedAt: null } },
    });
  });
});

describe('RepositoryBindingsRepository.create (HU56 — carrera con DELETE /projects)', () => {
  const input = { installationId: 'i1', repositoryId: 'r1', repositoryName: 'org/repo', integrationBranch: 'main' };
  let tx: { $queryRaw: ReturnType<typeof vi.fn>; repositoryBinding: { create: ReturnType<typeof vi.fn> } };
  let repository: RepositoryBindingsRepository;

  beforeEach(() => {
    tx = { $queryRaw: vi.fn(), repositoryBinding: { create: vi.fn().mockResolvedValue({ id: 'b1' }) } };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    repository = new RepositoryBindingsRepository(prisma as unknown as PrismaService);
  });

  it('locks the live project (FOR SHARE) and inserts inside the same transaction', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'p1' }]);

    const result = await repository.create('p1', input);

    expect(result).toEqual({ id: 'b1' });
    const sql = (tx.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('FROM "projects"');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('FOR SHARE');
    expect(tx.repositoryBinding.create).toHaveBeenCalledWith({
      data: { projectId: 'p1', installationId: 'i1', repositoryId: 'r1', repositoryName: 'org/repo', integrationBranch: 'main' },
    });
  });

  it('throws PROJECT_NOT_FOUND and inserts nothing when the project is no longer alive', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(repository.create('p1', input)).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(tx.repositoryBinding.create).not.toHaveBeenCalled();
  });
});

describe('RepositoryBindingsRepository.findByRepositoryId (HU56)', () => {
  it('treats a binding whose project is logically deleted as nonexistent', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new RepositoryBindingsRepository({ repositoryBinding: { findFirst } } as unknown as PrismaService);

    await repository.findByRepositoryId('r1');

    expect(findFirst).toHaveBeenCalledWith({ where: { repositoryId: 'r1', project: { deletedAt: null } } });
  });
});
