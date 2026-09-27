import { describe, expect, it, vi } from 'vitest';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const input = {
  analysisRunId: 'run-1',
  projectId: 'project-1',
  symbolLanguage: 'TYPESCRIPT' as const,
  symbolKind: 'METHOD' as const,
  qualifiedName: 'Thing.doIt',
  filePath: 'src/thing.ts',
  question: 'Expected behavior?',
  rationale: 'No active rule.',
};

function setup(updateCount = 1, existing: object | null = null) {
  const question = { id: 'question-1', ...input };
  const analysisRun = { id: 'run-1', status: 'ACTION_REQUIRED', current: true };
  const tx = {
    analysisRun: {
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(analysisRun),
    },
    functionalQuestion: {
      findFirst: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue(question),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  const repository = new FunctionalQuestionsRepository(prisma as unknown as PrismaService);

  return { repository, prisma, tx, question, analysisRun };
}

describe('FunctionalQuestionsRepository.createForCurrentRun', () => {
  it('atomically transitions a current PROCESSING run and creates its pending question', async () => {
    const { repository, prisma, tx, question, analysisRun } = setup();

    const result = await repository.createForCurrentRun(input, 'PROCESSING');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.analysisRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'PROCESSING', current: true },
      data: { status: 'ACTION_REQUIRED', actionRequiredCount: { increment: 1 } },
    });
    expect(tx.functionalQuestion.create).toHaveBeenCalledWith({ data: input });
    expect(result).toEqual({ question, analysisRun });
  });

  it('creates no question when the run stopped being current before the conditional write', async () => {
    const { repository, tx } = setup(0);

    await expect(repository.createForCurrentRun(input, 'PROCESSING')).resolves.toBeNull();

    expect(tx.functionalQuestion.findFirst).not.toHaveBeenCalled();
    expect(tx.functionalQuestion.create).not.toHaveBeenCalled();
  });

  it('keeps ACTION_REQUIRED during continuation while serializing the question write', async () => {
    const { repository, tx } = setup();

    await repository.createForCurrentRun(input, 'ACTION_REQUIRED');

    expect(tx.analysisRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'ACTION_REQUIRED', current: true },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('reuses an already-created question instead of duplicating a concurrent evaluation', async () => {
    const existing = { id: 'question-existing', status: 'PENDING' };
    const { repository, tx } = setup(1, existing);

    const result = await repository.createForCurrentRun(input, 'ACTION_REQUIRED');

    expect(result?.question).toBe(existing);
    expect(tx.functionalQuestion.create).not.toHaveBeenCalled();
  });
});
