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
