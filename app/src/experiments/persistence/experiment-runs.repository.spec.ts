import { describe, expect, it, vi } from 'vitest';
import { ExperimentRunsRepository } from './experiment-runs.repository.js';

describe('ExperimentRunsRepository.findRepetitions', () => {
  it('returns only the latest attempt for each strategy and repetition', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'rag-2', strategy: 'RAG', repetition: 1, attempt: 2 },
      { id: 'rag-1', strategy: 'RAG', repetition: 1, attempt: 1 },
      { id: 'rag-other', strategy: 'RAG', repetition: 2, attempt: 1 },
      {
        id: 'agent-1',
        strategy: 'GENERALIST_AGENT',
        repetition: 1,
        attempt: 1,
      },
    ]);
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { findMany },
    } as never);

    const repetitions = await repository.findRepetitions('experiment-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { experimentId: 'experiment-1' },
      orderBy: [
        { strategy: 'asc' },
        { repetition: 'asc' },
        { attempt: 'desc' },
      ],
    });
    expect(repetitions.map(({ id }) => id)).toEqual([
      'rag-2',
      'rag-other',
      'agent-1',
    ]);
  });
});

describe('ExperimentRunsRepository.updateRepetitionById', () => {
  it('updates metrics and state on the attempt created by beginAttempt without persisting a second trajectory', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'repetition-1' });
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { update },
    } as never);

    await repository.updateRepetitionById(
      'repetition-1',
      {
        repetition: 2,
        strategy: 'GENERALIST_AGENT',
        compiled: true,
        executed: true,
        passed: true,
        valid: true,
        failureType: null,
        errorSummary: null,
        generationDurationMs: 100,
        executionDurationMs: 200,
        totalDurationMs: 300,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        estimatedCost: 0.1,
        retrievedChunks: null,
        selectedChunks: null,
        contextTokens: null,
        toolCalls: 2,
        filesInspected: 1,
        trajectory: undefined,
      },
      'COMPLETED',
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'repetition-1' },
      data: {
        compiled: true,
        executed: true,
        passed: true,
        valid: true,
        failureType: null,
        errorSummary: null,
        generationDurationMs: 100,
        executionDurationMs: 200,
        totalDurationMs: 300,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        estimatedCost: 0.1,
        retrievedChunks: null,
        selectedChunks: null,
        contextTokens: null,
        toolCalls: 2,
        filesInspected: 1,
        state: 'COMPLETED',
      },
    });
  });
});

describe('ExperimentRunsRepository.refreshCompletedRepetitions', () => {
  it('counts distinct logical slots across retries instead of counting attempts', async () => {
    const terminalAttempts = Array.from({ length: 6 }, (_, index) => {
      const repetition = (index % 3) + 1;
      const strategy = index < 3 ? 'RAG' : 'GENERALIST_AGENT';
      return [
        { strategy, repetition },
        { strategy, repetition },
      ];
    }).flat();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      experimentRepetition: {
        findMany: vi.fn().mockResolvedValue(terminalAttempts),
      },
      experimentRun: {
        update: vi
          .fn()
          .mockResolvedValue({ id: 'experiment-1', completedRepetitions: 6 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const repository = new ExperimentRunsRepository(prisma as never);

    await repository.refreshCompletedRepetitions('experiment-1');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.experimentRepetition.findMany).toHaveBeenCalledWith({
      where: {
        experimentId: 'experiment-1',
        state: { in: ['COMPLETED', 'FAILED'] },
      },
      select: { strategy: true, repetition: true },
    });
    expect(tx.experimentRun.update).toHaveBeenCalledWith({
      where: { id: 'experiment-1' },
      data: { completedRepetitions: 6 },
    });
  });

  it('counts only logical slots with a terminal attempt after a partial failure', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      experimentRepetition: {
        findMany: vi.fn().mockResolvedValue([
          { strategy: 'RAG', repetition: 1 },
          { strategy: 'RAG', repetition: 1 },
          { strategy: 'RAG', repetition: 2 },
          { strategy: 'GENERALIST_AGENT', repetition: 1 },
        ]),
      },
      experimentRun: {
        update: vi
          .fn()
          .mockResolvedValue({ id: 'experiment-1', completedRepetitions: 3 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const repository = new ExperimentRunsRepository(prisma as never);

    await repository.refreshCompletedRepetitions('experiment-1');

    expect(tx.experimentRun.update).toHaveBeenCalledWith({
      where: { id: 'experiment-1' },
      data: { completedRepetitions: 3 },
    });
  });
});
