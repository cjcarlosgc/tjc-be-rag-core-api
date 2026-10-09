import { describe, expect, it, vi } from 'vitest';
import { ExperimentRunsRepository } from './experiment-runs.repository.js';

describe('ExperimentRunsRepository.create', () => {
  it('persists the effective LLM config in the modelConfig column as a plain JSON object', async () => {
    const createMock = vi.fn().mockResolvedValue({ id: 'exp-1' });
    const repository = new ExperimentRunsRepository({
      experimentRun: { create: createMock },
    } as never);

    await repository.create({
      projectId: 'project-1',
      projectVersionId: 'version-1',
      targetId: 'target-1',
      totalRepetitions: 6,
      modelConfig: {
        provider: 'openai',
        model: 'gpt-6-luna',
        modelVersion: 'gpt-6-luna-2026',
        reasoningEffort: 'xhigh',
        temperature: null,
        maxOutputTokens: 4000,
      },
      randomizationSeed: 'c'.repeat(64),
      budget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 120000 },
      executionProfile: 'NODE_TYPESCRIPT',
      runnerHint: 'JEST',
    });

    expect(createMock).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        totalRepetitions: 6,
        randomizationSeed: 'c'.repeat(64),
        budget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 120000 },
        executionProfile: 'NODE_TYPESCRIPT',
        runnerHint: 'JEST',
        modelConfig: {
          provider: 'openai',
          model: 'gpt-6-luna',
          modelVersion: 'gpt-6-luna-2026',
          reasoningEffort: 'xhigh',
          temperature: null,
          maxOutputTokens: 4000,
        },
      },
    });
  });
});

describe('ExperimentRunsRepository pairing fields', () => {
  it('insertRepetition persists pairId, pairPosition, attempt and technicallyEvaluable when provided', async () => {
    const createMock = vi.fn().mockResolvedValue({ id: 'rep-1' });
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { create: createMock },
    } as never);

    await repository.insertRepetition('exp-1', {
      repetition: 2,
      strategy: 'RAG',
      compiled: null,
      executed: null,
      passed: null,
      valid: null,
      failureType: null,
      errorSummary: null,
      generationDurationMs: 0,
      executionDurationMs: null,
      totalDurationMs: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCost: null,
      retrievedChunks: null,
      selectedChunks: null,
      contextTokens: null,
      toolCalls: null,
      filesInspected: null,
      trajectory: undefined,
      pairId: 'pair-2',
      pairPosition: 1,
      attempt: 2,
      technicallyEvaluable: false,
    });

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        experimentId: 'exp-1',
        repetition: 2,
        pairId: 'pair-2',
        pairPosition: 1,
        attempt: 2,
        technicallyEvaluable: false,
      }),
    });
  });

  it('insertRepetition leaves pairing columns to their defaults when the caller does not provide them', async () => {
    const createMock = vi.fn().mockResolvedValue({ id: 'rep-1' });
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { create: createMock },
    } as never);

    await repository.insertRepetition('exp-1', {
      repetition: 1,
      strategy: 'GENERALIST_AGENT',
      compiled: null,
      executed: null,
      passed: null,
      valid: null,
      failureType: null,
      errorSummary: null,
      generationDurationMs: 0,
      executionDurationMs: null,
      totalDurationMs: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCost: null,
      retrievedChunks: null,
      selectedChunks: null,
      contextTokens: null,
      toolCalls: null,
      filesInspected: null,
      trajectory: undefined,
    });

    const data = createMock.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('pairId');
    expect(data).not.toHaveProperty('pairPosition');
    expect(data).not.toHaveProperty('technicallyEvaluable');
  });
});

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
    const update = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { updateMany: update },
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
      where: { id: 'repetition-1', state: 'RUNNING' },
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

  const metrics = {
    repetition: 1,
    strategy: 'RAG',
    compiled: true,
    executed: true,
    passed: true,
    valid: true,
    failureType: null,
    errorSummary: null,
    generationDurationMs: 1,
    executionDurationMs: 1,
    totalDurationMs: 2,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCost: null,
    retrievedChunks: null,
    selectedChunks: null,
    contextTokens: null,
    toolCalls: null,
    filesInspected: null,
    trajectory: undefined,
  } as never;

  it('H3 (WI-CORE-030): does not overwrite an attempt that is no longer RUNNING and reports that nothing was written', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { updateMany },
    } as never);

    const written = await repository.updateRepetitionById('repetition-1', metrics, 'FAILED');

    expect(written).toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'repetition-1', state: 'RUNNING' });
  });
});

describe('ExperimentRunsRepository H4 (WI-CORE-030): a retried run does not keep the failure of a previous attempt', () => {
  it('markStarted clears failureCode, failureMessage and completedAt', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'exp-1' });
    const repository = new ExperimentRunsRepository({ experimentRun: { update } } as never);

    await repository.markStarted('exp-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'exp-1' },
      data: {
        status: 'RUNNING',
        startedAt: expect.any(Date),
        failureCode: null,
        failureMessage: null,
        completedAt: null,
      },
    });
  });

  it('complete clears failureCode and failureMessage left by a previous markFailed', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      experimentRun: {
        findUnique: vi.fn().mockResolvedValue({ totalRepetitions: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'exp-1' }),
      },
      experimentRepetition: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([{ strategy: 'RAG', repetition: 1 }]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const repository = new ExperimentRunsRepository(prisma as never);

    await repository.complete('exp-1');

    expect(tx.experimentRun.update).toHaveBeenCalledWith({
      where: { id: 'exp-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        failureCode: null,
        failureMessage: null,
      }),
    });
  });
});

describe('ExperimentRunsRepository sandboxTimedOut (WI-CORE-025 (1))', () => {
  const baseMetrics = {
    repetition: 1,
    strategy: 'RAG' as const,
    compiled: null,
    executed: null,
    passed: null,
    valid: false,
    failureType: 'INFRASTRUCTURE' as const,
    errorSummary: 'La ejecución en el Sandbox agotó el tiempo límite.',
    generationDurationMs: 100,
    executionDurationMs: 200,
    totalDurationMs: 300,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCost: null,
    retrievedChunks: null,
    selectedChunks: null,
    contextTokens: null,
    toolCalls: null,
    filesInspected: null,
    trajectory: undefined,
  };

  it('updateRepetitionById persists sandboxTimedOut=true when the Sandbox timed out', async () => {
    const update = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { updateMany: update },
    } as never);

    await repository.updateRepetitionById(
      'repetition-1',
      { ...baseMetrics, sandboxTimedOut: true },
      'FAILED',
    );

    expect(update.mock.calls[0][0].data).toMatchObject({ sandboxTimedOut: true, state: 'FAILED' });
  });

  it('updateRepetitionById leaves sandboxTimedOut untouched when the caller does not provide it', async () => {
    const update = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { updateMany: update },
    } as never);

    await repository.updateRepetitionById('repetition-1', baseMetrics, 'FAILED');

    expect(update.mock.calls[0][0].data).not.toHaveProperty('sandboxTimedOut');
  });

  it('insertRepetition persists sandboxTimedOut when provided', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'repetition-1' });
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { create },
    } as never);

    await repository.insertRepetition('exp-1', { ...baseMetrics, sandboxTimedOut: true });

    expect(create.mock.calls[0][0].data).toMatchObject({ experimentId: 'exp-1', sandboxTimedOut: true });
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

describe('ExperimentRunsRepository recovery (WI-CORE-025 (3c))', () => {
  function makeTx(overrides: { running?: number; terminal?: Array<{ strategy: string; repetition: number }>; totalRepetitions?: number } = {}) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      experimentRun: {
        findUnique: vi.fn().mockResolvedValue({ totalRepetitions: overrides.totalRepetitions ?? 6 }),
        update: vi.fn().mockResolvedValue({ id: 'exp-1' }),
        updateMany: vi.fn(),
      },
      experimentRepetition: {
        count: vi.fn().mockResolvedValue(overrides.running ?? 0),
        findMany: vi.fn().mockResolvedValue(overrides.terminal ?? []),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      contextTrace: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      experimentRepetition: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    return { tx, prisma };
  }

  const sixTerminal = [
    ...[1, 2, 3].map((repetition) => ({ strategy: 'RAG', repetition })),
    ...[1, 2, 3].map((repetition) => ({ strategy: 'GENERALIST_AGENT', repetition })),
  ];

  it('complete marks COMPLETED only when all six logical slots are terminal and nothing is RUNNING', async () => {
    const { tx, prisma } = makeTx({ terminal: sixTerminal });
    const repository = new ExperimentRunsRepository(prisma as never);

    await repository.complete('exp-1');

    expect(tx.experimentRepetition.count).toHaveBeenCalledWith({
      where: { experimentId: 'exp-1', state: 'RUNNING' },
    });
    expect(tx.experimentRun.update).toHaveBeenCalledWith({
      where: { id: 'exp-1' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
  });

  it('complete never marks COMPLETED while a repetition is still RUNNING', async () => {
    const { tx, prisma } = makeTx({ running: 1, terminal: sixTerminal });
    const repository = new ExperimentRunsRepository(prisma as never);

    await expect(repository.complete('exp-1')).rejects.toThrow('RUNNING');
    expect(tx.experimentRun.update).not.toHaveBeenCalled();
  });

  it('complete never marks COMPLETED when a logical slot has no terminal attempt', async () => {
    const { tx, prisma } = makeTx({ terminal: sixTerminal.slice(1) });
    const repository = new ExperimentRunsRepository(prisma as never);

    await expect(repository.complete('exp-1')).rejects.toThrow('slots lógicos');
    expect(tx.experimentRun.update).not.toHaveBeenCalled();
  });

  it('touchRepetitionHeartbeat renews only an attempt that is still RUNNING', async () => {
    const { prisma } = makeTx();
    const repository = new ExperimentRunsRepository(prisma as never);
    const at = new Date('2026-10-09T12:00:00.000Z');

    await repository.touchRepetitionHeartbeat('rep-1', at);

    expect(prisma.experimentRepetition.updateMany).toHaveBeenCalledWith({
      where: { id: 'rep-1', state: 'RUNNING' },
      data: { lastHeartbeatAt: at },
    });
  });

  it('closeInterruptedRepetition closes a RUNNING attempt as INFRASTRUCTURE and keeps the rest of its columns', async () => {
    const { tx, prisma } = makeTx();
    const repository = new ExperimentRunsRepository(prisma as never);

    await repository.closeInterruptedRepetition('rep-2', {
      errorSummary: 'interrumpido',
      technicallyEvaluable: false,
    });

    expect(tx.experimentRepetition.updateMany).toHaveBeenCalledWith({
      where: { id: 'rep-2', state: 'RUNNING' },
      data: {
        state: 'FAILED',
        failureType: 'INFRASTRUCTURE',
        errorSummary: 'interrumpido',
        technicallyEvaluable: false,
      },
    });
    expect(tx.contextTrace.updateMany).toHaveBeenCalledWith({
      where: { experimentRepetitionId: 'rep-2', state: 'CAPTURING' },
      data: { state: 'FAILED' },
    });
  });

  it('closeInterruptedRepetition of the first attempt does not touch technicallyEvaluable', async () => {
    const { tx, prisma } = makeTx();
    const repository = new ExperimentRunsRepository(prisma as never);

    await repository.closeInterruptedRepetition('rep-1', { errorSummary: 'interrumpido' });

    const data = tx.experimentRepetition.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('technicallyEvaluable');
  });

  it('closeInterruptedRepetition is a no-op when the attempt is no longer RUNNING', async () => {
    const { tx, prisma } = makeTx();
    tx.experimentRepetition.updateMany.mockResolvedValue({ count: 0 });
    const repository = new ExperimentRunsRepository(prisma as never);

    await repository.closeInterruptedRepetition('rep-1', { errorSummary: 'interrumpido' });

    expect(tx.contextTrace.updateMany).not.toHaveBeenCalled();
  });
});
