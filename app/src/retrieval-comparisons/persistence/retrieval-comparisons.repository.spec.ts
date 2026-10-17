import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { RetrievalComparisonsRepository } from './retrieval-comparisons.repository.js';

function makePrisma() {
  const tx = {
    retrievalComparison: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    retrievalComparisonResult: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    retrievalComparison: {
      create: vi.fn().mockResolvedValue({ id: 'cmp-1' }),
      findUnique: vi.fn().mockResolvedValue({ id: 'cmp-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    retrievalComparisonResult: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };

  return { prisma, tx };
}

describe('RetrievalComparisonsRepository', () => {
  it('create stores the symbol snapshot, the idempotency key and a null ground truth as DbNull', async () => {
    const { prisma } = makePrisma();
    const repository = new RetrievalComparisonsRepository(prisma as never);

    await repository.create({
      analysisRunId: 'run-1',
      projectId: 'project-1',
      projectVersionId: 'version-1',
      symbol: { language: 'TYPESCRIPT', kind: 'FUNCTION', qualifiedName: 'foo', filePath: 'src/foo.ts', changeKind: 'DIRECTLY_CHANGED' },
      idempotencyKey: 'key-1',
      groundTruth: null,
    });

    expect(prisma.retrievalComparison.create).toHaveBeenCalledWith({
      data: {
        analysisRunId: 'run-1',
        projectId: 'project-1',
        projectVersionId: 'version-1',
        symbol: { language: 'TYPESCRIPT', kind: 'FUNCTION', qualifiedName: 'foo', filePath: 'src/foo.ts', changeKind: 'DIRECTLY_CHANGED' },
        idempotencyKey: 'key-1',
        groundTruth: Prisma.DbNull,
      },
    });
  });

  it('create writes inside the given transaction client when one is provided', async () => {
    const { prisma } = makePrisma();
    const txCreate = vi.fn().mockResolvedValue({ id: 'cmp-tx' });
    const repository = new RetrievalComparisonsRepository(prisma as never);

    await repository.create(
      {
        analysisRunId: 'run-1',
        projectId: 'project-1',
        projectVersionId: 'version-1',
        symbol: {},
        idempotencyKey: null,
        groundTruth: [{ filePath: 'a.ts', symbolQualifiedName: 'A.b' }],
      },
      { retrievalComparison: { create: txCreate } } as never,
    );

    expect(prisma.retrievalComparison.create).not.toHaveBeenCalled();
    expect(txCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ groundTruth: [{ filePath: 'a.ts', symbolQualifiedName: 'A.b' }] }),
    });
  });

  it('listByAnalysisRun orders newest first, takes limit+1 and resumes after the cursor', async () => {
    const { prisma } = makePrisma();
    const repository = new RetrievalComparisonsRepository(prisma as never);

    await repository.listByAnalysisRun('run-1', 21, 'cmp-9');

    expect(prisma.retrievalComparison.findMany).toHaveBeenCalledWith({
      where: { analysisRunId: 'run-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
      cursor: { id: 'cmp-9' },
      skip: 1,
    });
  });

  it('markRunning only moves PENDING, RUNNING or FAILED and never a COMPLETED comparison', async () => {
    const { prisma } = makePrisma();
    const repository = new RetrievalComparisonsRepository(prisma as never);

    await expect(repository.markRunning('cmp-1')).resolves.toBe(true);

    expect(prisma.retrievalComparison.updateMany).toHaveBeenCalledWith({
      where: { id: 'cmp-1', status: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
      data: expect.objectContaining({ status: 'RUNNING', failureCode: null, failureMessage: null }),
    });
  });

  it('markFailed and recordFailure only write while the comparison is open', async () => {
    const { prisma } = makePrisma();
    const repository = new RetrievalComparisonsRepository(prisma as never);

    await repository.markFailed('cmp-1', 'RETRIEVAL_TARGET_UNRESOLVABLE', 'msg');
    await repository.recordFailure('cmp-1', 'RETRIEVAL_COMPARISON_FAILED', 'msg2');

    expect(prisma.retrievalComparison.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'cmp-1', status: { in: ['PENDING', 'RUNNING'] } },
      data: expect.objectContaining({ status: 'FAILED', failureCode: 'RETRIEVAL_TARGET_UNRESOLVABLE', failureMessage: 'msg' }),
    });
    expect(prisma.retrievalComparison.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'cmp-1', status: { in: ['PENDING', 'RUNNING'] } },
      data: { failureCode: 'RETRIEVAL_COMPARISON_FAILED', failureMessage: 'msg2' },
    });
  });

  it('markFailed reports false when the comparison was already closed', async () => {
    const { prisma } = makePrisma();
    prisma.retrievalComparison.updateMany.mockResolvedValueOnce({ count: 0 });
    const repository = new RetrievalComparisonsRepository(prisma as never);

    await expect(repository.markFailed('cmp-1', 'RETRIEVAL_COMPARISON_WORKER_LOST', 'msg')).resolves.toBe(false);
  });

  it('saveResultsAndComplete upserts both modes by (comparisonId, mode) and completes in one transaction', async () => {
    const { prisma, tx } = makePrisma();
    const repository = new RetrievalComparisonsRepository(prisma as never);

    const saved = await repository.saveResultsAndComplete('cmp-1', [
      { mode: 'SE', config: { semanticTopK: 20 }, candidates: [{ rank: 1 }], metrics: null },
      { mode: 'SEM', config: { semanticTopK: 20 }, candidates: [], metrics: { precisionAt5: 0.2 } },
    ]);

    expect(saved).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.retrievalComparison.updateMany).toHaveBeenCalledWith({
      where: { id: 'cmp-1', status: { in: ['PENDING', 'RUNNING'] } },
      data: expect.objectContaining({ status: 'COMPLETED', failureCode: null, failureMessage: null }),
    });
    expect(tx.retrievalComparisonResult.upsert).toHaveBeenCalledTimes(2);
    expect(tx.retrievalComparisonResult.upsert).toHaveBeenNthCalledWith(1, {
      where: { comparisonId_mode: { comparisonId: 'cmp-1', mode: 'SE' } },
      create: expect.objectContaining({ id: expect.any(String), comparisonId: 'cmp-1', mode: 'SE', metrics: Prisma.DbNull }),
      update: expect.objectContaining({ config: { semanticTopK: 20 }, metrics: Prisma.DbNull }),
    });
  });

  it('saveResultsAndComplete writes nothing when the comparison is already closed', async () => {
    const { prisma, tx } = makePrisma();
    tx.retrievalComparison.updateMany.mockResolvedValueOnce({ count: 0 });
    const repository = new RetrievalComparisonsRepository(prisma as never);

    await expect(
      repository.saveResultsAndComplete('cmp-1', [{ mode: 'SE', config: {}, candidates: [], metrics: null }]),
    ).resolves.toBe(false);
    expect(tx.retrievalComparisonResult.upsert).not.toHaveBeenCalled();
  });
});
