import { describe, expect, it, vi } from 'vitest';
import { AnalysisRunsRepository } from './analysis-runs.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function setup(transitionCount = 1) {
  const run = { id: 'run-1', status: 'OBSOLETE', current: false };
  const tx = {
    analysisRun: {
      updateMany: vi.fn().mockResolvedValue({ count: transitionCount }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(run),
    },
    functionalQuestion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  const repository = new AnalysisRunsRepository(prisma as unknown as PrismaService);

  return { repository, tx, run };
}

describe('AnalysisRunsRepository.transitionCurrent', () => {
  it('does not overwrite a newer lifecycle state when the compare-and-set loses a race', async () => {
    const { repository, tx } = setup(0);

    await expect(
      repository.transitionCurrent('run-1', 'PROCESSING', 'ACTION_REQUIRED', {}),
    ).resolves.toBeNull();

    expect(tx.analysisRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'PROCESSING', current: true },
      data: { status: 'ACTION_REQUIRED' },
    });
    expect(tx.functionalQuestion.updateMany).not.toHaveBeenCalled();
  });

  it('atomically obsoletes pending questions when a current run is obsoleted', async () => {
    const { repository, tx, run } = setup();

    const result = await repository.transitionCurrent('run-1', 'PROCESSING', 'OBSOLETE', { current: false });

    expect(tx.functionalQuestion.updateMany).toHaveBeenCalledWith({
      where: { analysisRunId: 'run-1', status: 'PENDING' },
      data: { status: 'OBSOLETE' },
    });
    expect(result).toEqual(run);
  });
});
