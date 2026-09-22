import { beforeEach, describe, expect, it } from 'vitest';
import { TestTargetsRepository } from './test-targets.repository.js';
import { InMemoryPrisma } from '../../../test/support/in-memory-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * POST /experiments (hallazgo de la revisión de la etapa 2b): el target debe pertenecer al
 * Project indicado en el body; verlo en OTRO Project propio no basta.
 */
describe('TestTargetsRepository.findByIdForOwner scoped to a project', () => {
  const prisma = new InMemoryPrisma();
  const repository = new TestTargetsRepository(prisma as unknown as PrismaService);

  beforeEach(() => {
    prisma.reset();
    prisma.insert('project', { id: 'project-1', ownerUserId: 'user-1' });
    prisma.insert('project', { id: 'project-2', ownerUserId: 'user-1' });
    prisma.insert('project', { id: 'foreign', ownerUserId: 'user-2' });
    prisma.insert('projectVersion', { id: 'version-1', projectId: 'project-1' });
    prisma.insert('projectVersion', { id: 'version-2', projectId: 'project-2' });
    prisma.insert('projectVersion', { id: 'version-foreign', projectId: 'foreign' });
    prisma.insert('testTarget', { id: 'target-1', projectVersionId: 'version-1' });
    prisma.insert('testTarget', { id: 'target-2', projectVersionId: 'version-2' });
    prisma.insert('testTarget', { id: 'target-foreign', projectVersionId: 'version-foreign' });
  });

  it('finds a target that belongs to the given project', async () => {
    expect(await repository.findByIdForOwner('target-1', 'user-1', 'project-1')).toMatchObject({ id: 'target-1' });
  });

  it('does not find a target of ANOTHER project the user also sees (same result as a missing target)', async () => {
    expect(await repository.findByIdForOwner('target-2', 'user-1', 'project-1')).toBeNull();
    expect(await repository.findByIdForOwner('missing', 'user-1', 'project-1')).toBeNull();
  });

  it('keeps hiding targets of projects the user cannot see, with or without a project', async () => {
    expect(await repository.findByIdForOwner('target-foreign', 'user-1', 'foreign')).toBeNull();
    expect(await repository.findByIdForOwner('target-foreign', 'user-1')).toBeNull();
  });

  it('without a project keeps the previous behavior (any visible target)', async () => {
    expect(await repository.findByIdForOwner('target-2', 'user-1')).toMatchObject({ id: 'target-2' });
  });
});
