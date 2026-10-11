import { describe, expect, it, vi } from 'vitest';
import { ProjectVersionsRepository } from './project-versions.repository.js';

describe('ProjectVersionsRepository.completeAndPromote', () => {
  function setup() {
    const prisma = {
      projectVersion: { update: vi.fn().mockResolvedValue(undefined) },
      project: { update: vi.fn().mockResolvedValue(undefined) },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    return { repository: new ProjectVersionsRepository(prisma as never), prisma };
  }

  it('promotes a detected root atomically with the completed version', async () => {
    const { repository, prisma } = setup();

    await repository.completeAndPromote('project-1', 'version-1', {
      filesProcessed: 5,
      chunksCount: 2,
      detectedFramework: null,
      targetsTotal: 1,
      targetsWithTest: 0,
      projectRoot: 'backend',
    });

    expect(prisma.projectVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'version-1' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { currentVersionId: 'version-1', projectRoot: 'backend' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('promotes a legacy-resolved repository root atomically with the completed version', async () => {
    const { repository, prisma } = setup();

    await repository.completeAndPromote('project-1', 'version-1', {
      filesProcessed: 5,
      chunksCount: 2,
      detectedFramework: null,
      targetsTotal: 1,
      targetsWithTest: 0,
      projectRoot: '.',
    });

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { currentVersionId: 'version-1', projectRoot: '.' },
    });
  });
});
