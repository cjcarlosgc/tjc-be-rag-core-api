import { describe, expect, it, vi } from 'vitest';
import { ProjectVersionsRepository } from './project-versions.repository.js';

describe('ProjectVersionsRepository snapshotKey', () => {
  function setup() {
    const prisma = {
      projectVersion: {
        update: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: 'version-1' }),
      },
      project: { update: vi.fn().mockResolvedValue(undefined) },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    return { repository: new ProjectVersionsRepository(prisma as never), prisma };
  }

  it('setSnapshotKey updates only the snapshotKey column of the version', async () => {
    const { repository, prisma } = setup();

    await repository.setSnapshotKey('version-1', 'project-versions/version-1/snapshot.zip');

    expect(prisma.projectVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: { snapshotKey: 'project-versions/version-1/snapshot.zip' },
    });
  });

  it('createPending does not write snapshotKey', async () => {
    const { repository, prisma } = setup();

    await repository.createPending({
      projectId: 'project-1',
      commitSha: 'abc',
      language: 'TYPESCRIPT',
      effectiveProjectRoot: '.',
    });

    const data = prisma.projectVersion.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('snapshotKey');
  });

  it('completeAndPromote does not write snapshotKey', async () => {
    const { repository, prisma } = setup();

    await repository.completeAndPromote('project-1', 'version-1', {
      filesProcessed: 5,
      chunksCount: 2,
      detectedFramework: null,
      targetsTotal: 1,
      targetsWithTest: 0,
      projectRoot: '.',
    });

    expect(prisma.projectVersion.update.mock.calls[0][0].data).not.toHaveProperty('snapshotKey');
  });

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
