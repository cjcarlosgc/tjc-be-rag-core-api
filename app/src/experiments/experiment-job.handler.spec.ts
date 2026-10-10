import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { PromptBuilder } from '../generation/prompt-builder.service.js';
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ExperimentJobHandler } from './experiment-job.handler.js';
import { SandboxAcceptedExecutionError, SandboxUnavailableError } from '../sandbox/sandbox-execution.service.js';
import { sandboxExperimentRequestId } from '../sandbox/sandbox-request-id.util.js';
import { SANDBOX_TIMED_OUT_ERROR_SUMMARY } from '../sandbox/map-sandbox-result.js';
import { LLMProviderUnavailableError } from '../providers/llm-provider-unavailable.error.js';
import { experimentPairId, pairOrder } from './pair-order.js';
import { RescheduleJobError } from '../jobs/reschedule-job.error.js';

function makeTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: 'target-1',
    projectVersionId: 'version-1',
    filePath: 'src/foo.ts',
    symbolName: 'foo',
    methodName: null,
    targetType: 'FUNCTION',
    startLine: 1,
    endLine: 3,
    hasTest: false,
    testFilePaths: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function successfulSandboxResult() {
  return {
    status: 'COMPLETED',
    facts: {
      runner: 'VITEST',
      compiled: true,
      executed: true,
      passed: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      testCases: [],
      testCasesTruncated: false,
    },
    failure: null,
  };
}

const effectiveConfig = {
  provider: 'openai' as const,
  model: 'gpt-6-luna',
  modelVersion: 'gpt-6-luna',
  reasoningEffort: 'xhigh',
  temperature: null,
  maxOutputTokens: null,
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const cleanup = vi.fn().mockResolvedValue(undefined);
  let repetitionNumber = 0;
  const agentSteps = [
    {
      step: 1,
      toolName: 'list_files',
      arguments: {},
      status: 'SUCCEEDED',
      resultSummary: 'src/foo.ts\nsrc/bar.ts',
      resultSha256: 'a'.repeat(64),
      truncated: true,
      contextTokens: 0,
      truncationReason: 'CHAR_LIMIT',
      observations: [
        {
          kind: 'FILE_LIST_SUMMARY',
          filePath: null,
          symbolName: null,
          excerpt: null,
          discoveredFilesCount: 2,
        },
      ],
    },
    {
      step: 2,
      toolName: 'read_file',
      arguments: { relativePath: 'src/foo.ts' },
      status: 'SUCCEEDED',
      resultSummary: 'SECRET FULL FILE CONTENT',
      resultSha256: 'b'.repeat(64),
      truncated: false,
      contextTokens: 0,
      truncationReason: null,
      observations: [
        {
          kind: 'FILE_CONTENT',
          filePath: 'src/foo.ts',
          symbolName: null,
          excerpt: {
            filePath: 'src/foo.ts',
            symbolName: null,
            parentSymbolName: null,
            startLine: 1,
            endLine: 2,
            snippet: 'bounded source excerpt',
            before: [{ lineNumber: 0, content: 'must be stripped' }],
            after: [{ lineNumber: 3, content: 'must be stripped' }],
            contentSha256: 'c'.repeat(64),
            truncated: true,
          },
          discoveredFilesCount: null,
        },
      ],
    },
  ];
  const candidate = {
    chunkId: 'candidate-chunk-1',
    filePath: 'src/bar.ts',
    symbolKind: 'FUNCTION',
    symbolName: 'bar',
    parentSymbolName: null,
    startLine: 4,
    endLine: 6,
    content: 'candidate content',
    tokenCount: 20,
    rank: 1,
    semanticScore: 0.9,
    structuralMatch: 'IMPORTS',
    combinedScore: 0.93,
    matchedVia: ['SEMANTIC', 'IMPORTS'],
    decision: 'SELECTED',
    discardReason: null,
  };

  const deps = {
    jobsService: { registerHandler: vi.fn() },
    experimentRunsRepository: {
      findById: vi.fn().mockResolvedValue({ id: 'exp-1', status: 'PENDING' }),
      markStarted: vi.fn(),
      complete: vi.fn(),
      markFailed: vi.fn(),
      updateRepetitionById: vi.fn().mockResolvedValue(true),
      refreshCompletedRepetitions: vi.fn(),
      findRepetitions: vi.fn().mockResolvedValue([]),
    },
    contextTracesRepository: {
      beginAttempt: vi
        .fn()
        .mockImplementation(async (input: Record<string, unknown>) => {
          repetitionNumber += 1;
          return {
            repetition: { id: `repetition-${repetitionNumber}`, ...input },
            trace: { id: `trace-${repetitionNumber}` },
          };
        }),
      updateDetail: vi.fn(),
      updateAgentCounters: vi.fn(),
      finishTrace: vi.fn(),
      failTrace: vi.fn(),
      finishRepetition: vi.fn(),
      insertDiscoveredFiles: vi.fn(),
    },
    projectVersionsRepository: {
      findById: vi.fn().mockResolvedValue({
        id: 'version-1',
        snapshotKey: 'snapshot-key',
        detectedFramework: 'VITEST',
      }),
    },
    testTargetsRepository: {
      findById: vi.fn().mockResolvedValue(makeTarget()),
    },
    retrievalService: {
      retrieve: vi.fn().mockResolvedValue({
        targetChunks: [{ id: 'target-chunk-1' }],
        candidates: [{ chunk: { id: 'candidate-chunk-1' } }],
      }),
    },
    functionalRulesRetriever: {
      retrieve: vi.fn().mockResolvedValue([]),
    },
    contextBuilder: {
      build: vi
        .fn()
        .mockImplementation(
          (retrieval: { targetChunks: unknown[]; candidates: unknown[] }) => {
            if (
              retrieval.targetChunks.length === 0 &&
              retrieval.candidates.length === 0
            ) {
              return {
                target: {
                  filePath: 'src/foo.ts',
                  symbolName: 'foo',
                  methodName: null,
                  targetType: 'FUNCTION',
                  content: '',
                },
                relatedChunks: [],
                functionalRules: [],
                metadata: { language: 'typescript', framework: 'VITEST' },
                retrievedChunks: 0,
                selectedChunks: 0,
                contextTokens: 0,
                audit: {
                  functionalRules: { retrieved: 0, selected: 0, tokenCount: 0, omitted: [] },
                  target: { chunkIds: [], chunks: [], tokenCount: 0 },
                  candidates: [],
                  configuration: {
                    minimumScore: 0,
                    topK: 10,
                    maxContextTokens: 6000,
                    semanticWeight: 0.7,
                    structuralWeight: 0.3,
                  },
                },
              };
            }

            return {
              target: {
                filePath: 'src/foo.ts',
                symbolName: 'foo',
                methodName: null,
                targetType: 'FUNCTION',
                content: 'x',
              },
              relatedChunks: [
                {
                  filePath: candidate.filePath,
                  symbolKind: candidate.symbolKind,
                  symbolName: candidate.symbolName,
                  parentSymbolName: candidate.parentSymbolName,
                  content: candidate.content,
                  score: candidate.combinedScore,
                  matchedVia: candidate.matchedVia,
                },
              ],
              functionalRules: [],
              metadata: { language: 'typescript', framework: 'VITEST' },
              retrievedChunks: 4,
              selectedChunks: 2,
              contextTokens: 123,
              audit: {
                functionalRules: { retrieved: 0, selected: 0, tokenCount: 0, omitted: [] },
                target: {
                  chunkIds: ['target-chunk-1'],
                  chunks: [
                    {
                      chunkId: 'target-chunk-1',
                      filePath: 'src/foo.ts',
                      symbolKind: 'FUNCTION',
                      symbolName: 'foo',
                      parentSymbolName: null,
                      startLine: 1,
                      endLine: 3,
                      content: 'target content',
                      tokenCount: 10,
                    },
                  ],
                  tokenCount: 10,
                },
                candidates: [candidate],
                configuration: {
                  minimumScore: 0,
                  topK: 10,
                  maxContextTokens: 6000,
                  semanticWeight: 0.7,
                  structuralWeight: 0.3,
                },
              },
            };
          },
        ),
    },
    promptBuilder: { build: vi.fn().mockReturnValue('prompt') },
    generalistAgentService: {
      generate: vi.fn().mockImplementation(async (...args: unknown[]) => {
        const callback = args[4] as
          ((event: unknown) => Promise<void>) | undefined;
        if (callback) {
          await callback({
            step: agentSteps[0],
            discoveredFiles: ['src/foo.ts', 'src/bar.ts'],
          });
          await callback({ step: agentSteps[1], discoveredFiles: [] });
        }
        return {
          content: 'agent generated test',
          trajectory: agentSteps,
          toolCallCount: 2,
          filesInspected: 1,
          inputTokens: 40,
          outputTokens: 15,
          contextTokensDelivered: 40,
          toolCallCap: 20,
          contextTokenBudget: 8000,
          capReached: false,
          truncatedSteps: 1,
        };
      }),
    },
    fileDiscoveryService: {
      discover: vi.fn().mockResolvedValue(['src/foo.ts']),
    },
    testFileMergeService: {
      applyCreate: vi.fn().mockReturnValue('export function test() {}'),
      applyMerge: vi.fn().mockReturnValue('merged'),
    },
    sandboxExecutionService: {
      execute: vi.fn().mockResolvedValue(successfulSandboxResult()),
    },
    objectStorageService: {
      get: vi.fn().mockResolvedValue(Buffer.from('zip')),
    },
    zipExtractionService: {
      extract: vi
        .fn()
        .mockResolvedValue({ dir: '/tmp/workspace-does-not-exist', cleanup }),
    },
    configService: {
      get: (key: string, fallback?: unknown) => fallback,
    },
    llmProvider: {
      generate: vi.fn().mockResolvedValue({
        content: 'rag generated test',
        inputTokens: 100,
        outputTokens: 30,
      }),
      resolveEffectiveConfig: vi.fn().mockResolvedValue(effectiveConfig),
    },
    ...overrides,
  };

  return { deps, cleanup };
}

function makeHandler(
  deps: ReturnType<typeof makeDeps>['deps'],
): ExperimentJobHandler {
  return new ExperimentJobHandler(
    deps.jobsService as never,
    deps.experimentRunsRepository as never,
    deps.contextTracesRepository as never,
    deps.projectVersionsRepository as never,
    deps.testTargetsRepository as never,
    deps.retrievalService as never,
    deps.contextBuilder as never,
    deps.functionalRulesRetriever as never,
    deps.promptBuilder as never,
    deps.generalistAgentService as never,
    deps.fileDiscoveryService as never,
    deps.testFileMergeService as never,
    deps.sandboxExecutionService as never,
    deps.objectStorageService as never,
    deps.zipExtractionService as never,
    deps.configService as never,
    deps.llmProvider as never,
  );
}

const payload = {
  experimentId: 'exp-1',
  projectId: 'project-1',
  projectVersionId: 'version-1',
  targetId: 'target-1',
};

const SEED = 'f'.repeat(64);

function seededRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    status: 'PENDING',
    modelConfig: effectiveConfig,
    randomizationSeed: SEED,
    budget: { toolCallCap: 5, contextTokenBudget: 1234, maxDurationMs: 60_000 },
    executionProfile: 'NODE_TYPESCRIPT',
    runnerHint: 'VITEST',
    ...overrides,
  };
}

/** Concurrencia 1: pares y posiciones se ejecutan en el orden exacto del plan. */
function sequentialConfig() {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'EXPERIMENT_REPETITION_CONCURRENCY' ? 1 : fallback,
  };
}

function attemptRow(
  strategy: string,
  repetition: number,
  attempt: number,
  state: 'COMPLETED' | 'FAILED' | 'RUNNING',
  failureType: string | null = null,
  errorSummary: string | null = null,
  sandboxTimedOut: boolean | null = null,
) {
  return { strategy, repetition, attempt, state, failureType, errorSummary, sandboxTimedOut };
}

function failedCompilationResult() {
  const success = successfulSandboxResult();
  return {
    ...success,
    facts: { ...success.facts, compiled: false, executed: false, passed: false, testCases: [] },
  };
}

function timedOutResult() {
  return { status: 'TIMED_OUT', facts: null, failure: null, stageDurations: [] };
}

function beginsOf(deps: ReturnType<typeof makeDeps>['deps']) {
  return (deps.contextTracesRepository.beginAttempt as ReturnType<typeof vi.fn>).mock.calls.map(
    (call: unknown[]) => call[0] as Record<string, unknown>,
  );
}

function executionsOf(deps: ReturnType<typeof makeDeps>['deps']) {
  return (deps.sandboxExecutionService.execute as ReturnType<typeof vi.fn>).mock.calls.map(
    (call: unknown[]) => call[0] as Record<string, unknown>,
  );
}

function writesOf(deps: ReturnType<typeof makeDeps>['deps']) {
  return (
    deps.experimentRunsRepository.updateRepetitionById as ReturnType<typeof vi.fn>
  ).mock.calls.map((call: unknown[]) => call[1] as Record<string, unknown>);
}

describe('ExperimentJobHandler', () => {
  it('registers itself with the jobs service', () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    handler.onModuleInit();

    expect(deps.jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('is a no-op when the experiment no longer exists', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(
      (deps.projectVersionsRepository as { findById: ReturnType<typeof vi.fn> })
        .findById,
    ).not.toHaveBeenCalled();
  });

  it('passes the same config persisted on the run to both arms (WI-CORE-023)', async () => {
    const { deps } = makeDeps();
    const persisted = { ...effectiveConfig, reasoningEffort: 'high', modelVersion: 'gpt-6-luna-2026' };
    (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exp-1',
      status: 'PENDING',
      modelConfig: persisted,
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const ragConfigs = (deps.llmProvider.generate as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => call[1]);
    const agentConfigs = (deps.generalistAgentService.generate as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[3],
    );
    expect(ragConfigs).toHaveLength(3);
    expect(agentConfigs).toHaveLength(3);
    for (const config of [...ragConfigs, ...agentConfigs]) {
      expect(config).toEqual(persisted);
    }
    expect(deps.llmProvider.resolveEffectiveConfig).not.toHaveBeenCalled();
  });

  it('passes the persisted internal endpoint to both arms, and runs created before WI-CORE-031 get none (WI-CORE-031)', async () => {
    const { deps } = makeDeps();
    (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exp-1',
      status: 'PENDING',
      modelConfig: { ...effectiveConfig, endpoint: 'responses' },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const configs = [
      ...(deps.llmProvider.generate as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => call[1]),
      ...(deps.generalistAgentService.generate as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => call[3]),
    ];
    expect(configs).toHaveLength(6);
    for (const config of configs) {
      expect(config).toMatchObject({ endpoint: 'responses' });
    }
  });

  it('does not invent an endpoint for a legacy persisted config without it (WI-CORE-031)', async () => {
    const { deps } = makeDeps();
    (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exp-1',
      status: 'PENDING',
      modelConfig: { ...effectiveConfig },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const configs = (deps.llmProvider.generate as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => call[1]);
    expect(configs).toHaveLength(3);
    for (const config of configs) {
      expect(config).not.toHaveProperty('endpoint');
    }
  });

  it('keeps the persisted config for all six repetitions even if the env or a new resolution would now yield another model (WI-CORE-023)', async () => {
    const { deps } = makeDeps({
      configService: {
        get: (key: string, fallback?: unknown) =>
          key === 'EXPERIMENT_LLM_MODEL' || key === 'EXPERIMENT_LLM_REASONING_EFFORT' ? 'other-model' : fallback,
      },
    });
    (deps.llmProvider.resolveEffectiveConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...effectiveConfig,
      model: 'other-model',
      modelVersion: 'other-model',
      reasoningEffort: 'low',
    });
    (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exp-1',
      status: 'PENDING',
      modelConfig: effectiveConfig,
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const ragConfigs = (deps.llmProvider.generate as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => call[1]);
    const agentConfigs = (deps.generalistAgentService.generate as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[3],
    );
    expect(ragConfigs).toHaveLength(3);
    expect(agentConfigs).toHaveLength(3);
    for (const config of [...ragConfigs, ...agentConfigs]) {
      expect(config).toEqual(effectiveConfig);
    }
    expect(deps.llmProvider.resolveEffectiveConfig).not.toHaveBeenCalled();
    expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
  });

  it('resolves the default config for a legacy run whose modelConfig is NULL', async () => {
    const { deps } = makeDeps();
    (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exp-1',
      status: 'PENDING',
      modelConfig: null,
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.llmProvider.resolveEffectiveConfig).toHaveBeenCalledTimes(1);
    expect((deps.llmProvider.generate as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(effectiveConfig);
    expect((deps.generalistAgentService.generate as ReturnType<typeof vi.fn>).mock.calls[0][3]).toEqual(
      effectiveConfig,
    );
  });

  it('runs 3 repetitions per strategy (6 total), using RAG and the agent for their respective arms', async () => {
    const { deps, cleanup } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.llmProvider.generate).toHaveBeenCalledTimes(3);
    expect(deps.generalistAgentService.generate).toHaveBeenCalledTimes(3);
    expect(deps.sandboxExecutionService.execute).toHaveBeenCalledTimes(6);
    expect(
      deps.experimentRunsRepository.updateRepetitionById,
    ).toHaveBeenCalledTimes(6);
    expect(deps.contextTracesRepository.beginAttempt).toHaveBeenCalledTimes(6);
    expect(
      deps.experimentRunsRepository.refreshCompletedRepetitions,
    ).toHaveBeenCalledTimes(6);
    expect(deps.contextTracesRepository.finishTrace).toHaveBeenCalledTimes(6);
    expect(deps.contextTracesRepository.failTrace).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(6);
    expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith(
      'exp-1',
    );

    const attempts = await Promise.all(
      deps.contextTracesRepository.beginAttempt.mock.results.map(
        (result: { value: Promise<{ repetition: { id: string } }> }) =>
          result.value,
      ),
    );
    expect(
      new Set(
        deps.experimentRunsRepository.updateRepetitionById.mock.calls.map(
          (call: unknown[]) => call[0],
        ),
      ),
    ).toEqual(new Set(attempts.map((attempt) => attempt.repetition.id)));
  });

  it('keeps six completed logical repetitions after retrying when complete() failed', async () => {
    const begunById = new Map<
      string,
      { strategy: string; repetition: number; attempt: number }
    >();
    const attemptsBySlot = new Map<string, number>();
    const terminalSlots = new Set<string>();
    let completedRepetitions = 0;
    let attemptNumber = 0;
    const { deps } = makeDeps();
    deps.experimentRunsRepository.complete = vi
      .fn()
      .mockRejectedValueOnce(new Error('complete failed'));
    deps.experimentRunsRepository.refreshCompletedRepetitions = vi.fn(
      async () => {
        completedRepetitions = terminalSlots.size;
      },
    );
    deps.contextTracesRepository.beginAttempt = vi.fn(
      async (input: { strategy: string; repetition: number }) => {
        const slot = `${input.strategy}:${input.repetition}`;
        const attempt = (attemptsBySlot.get(slot) ?? 0) + 1;
        attemptsBySlot.set(slot, attempt);
        attemptNumber += 1;
        const id = `repetition-${attemptNumber}`;
        begunById.set(id, { ...input, attempt });
        return {
          repetition: { id, ...input, attempt },
          trace: { id: `trace-${id}` },
        };
      },
    );
    deps.contextTracesRepository.finishRepetition = vi.fn(
      async (id: string) => {
        const begun = begunById.get(id);
        if (begun) terminalSlots.add(`${begun.strategy}:${begun.repetition}`);
        return { id };
      },
    );
    deps.experimentRunsRepository.findRepetitions = vi.fn(async () =>
      [...terminalSlots].map((slot) => {
        const [strategy, repetition] = slot.split(':');
        return attemptRow(strategy, Number(repetition), 1, 'COMPLETED');
      }),
    );
    const handler = makeHandler(deps);

    await expect(handler.handle(payload, 'job-1')).rejects.toThrow(
      'complete failed',
    );
    expect(completedRepetitions).toBe(6);

    await handler.handle(payload, 'job-2');

    // La redelivery omite los seis slots terminales: no se abre ningún intento nuevo.
    expect(deps.contextTracesRepository.beginAttempt).toHaveBeenCalledTimes(6);
    expect(
      deps.experimentRunsRepository.refreshCompletedRepetitions,
    ).toHaveBeenCalledTimes(6);
    expect(completedRepetitions).toBe(6);
    expect(deps.experimentRunsRepository.complete).toHaveBeenCalledTimes(2);
  });

  it('runs repetitions concurrently, bounded by EXPERIMENT_REPETITION_CONCURRENCY', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { deps } = makeDeps({
      configService: {
        get: (key: string, fallback?: unknown) =>
          key === 'EXPERIMENT_REPETITION_CONCURRENCY' ? 3 : fallback,
      },
      sandboxExecutionService: {
        execute: vi.fn().mockImplementation(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 10));
          inFlight -= 1;
          return successfulSandboxResult();
        }),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.sandboxExecutionService.execute).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('derives a stable Sandbox requestId per jobId+strategy+repetition (DEC-IDEMP-001)', async () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const requestIds = deps.sandboxExecutionService.execute.mock.calls.map(
      (call: unknown[]) => (call[0] as { requestId: string }).requestId,
    );

    expect(requestIds).toContain(sandboxExperimentRequestId('job-1', 'RAG', 1));
    expect(requestIds).toContain(sandboxExperimentRequestId('job-1', 'RAG', 2));
    expect(requestIds).toContain(sandboxExperimentRequestId('job-1', 'RAG', 3));
    expect(requestIds).toContain(
      sandboxExperimentRequestId('job-1', 'GENERALIST_AGENT', 1),
    );
    expect(new Set(requestIds).size).toBe(6);
  });

  it('records RAG-specific metrics (retrievedChunks/selectedChunks/contextTokens) and null agent metrics for the RAG arm', async () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const ragCall =
      deps.experimentRunsRepository.updateRepetitionById.mock.calls.find(
        (call: unknown[]) =>
          (call[1] as { strategy: string }).strategy === 'RAG',
      );

    expect(ragCall?.[1]).toMatchObject({
      retrievedChunks: 4,
      selectedChunks: 2,
      contextTokens: 123,
      toolCalls: null,
      filesInspected: null,
      valid: true,
      inputTokens: 100,
      outputTokens: 30,
      totalTokens: 130,
    });
  });

  it('records agent metrics but leaves the legacy repetition trajectory empty', async () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const agentCall =
      deps.experimentRunsRepository.updateRepetitionById.mock.calls.find(
        (call: unknown[]) =>
          (call[1] as { strategy: string }).strategy === 'GENERALIST_AGENT',
      );
    if (!agentCall) throw new Error('No se guardó el intento del agente.');

    expect(agentCall[1]).toMatchObject({
      retrievedChunks: null,
      selectedChunks: null,
      contextTokens: null,
      toolCalls: 2,
      filesInspected: 1,
    });
    expect(
      (agentCall[1] as { trajectory?: unknown }).trajectory,
    ).toBeUndefined();
  });

  it('persists compact RAG evidence before calling the LLM without changing prompt context', async () => {
    const { deps } = makeDeps();
    const llmGenerate = deps.llmProvider.generate as ReturnType<typeof vi.fn>;
    const traceRepository = deps.contextTracesRepository as {
      updateDetail: ReturnType<typeof vi.fn>;
    };
    llmGenerate.mockImplementation(async () => {
      const ragDetailWasPersisted =
        traceRepository.updateDetail.mock.calls.some((call: unknown[]) => {
          const detail = call[1] as {
            target?: { excerpt?: { snippet?: string } };
          };
          return detail.target?.excerpt?.snippet === 'target content';
        });
      expect(ragDetailWasPersisted).toBe(true);
      return {
        content: 'rag generated test',
        inputTokens: 100,
        outputTokens: 30,
      };
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const ragDetailCall = traceRepository.updateDetail.mock.calls.find(
      (call: unknown[]) => {
        const detail = call[1] as {
          target?: { excerpt?: { snippet?: string } };
        };
        return detail.target?.excerpt?.snippet === 'target content';
      },
    );
    const persisted = ragDetailCall?.[1] as {
      target: {
        chunkIds: string[];
        excerpt: Record<string, unknown>;
        tokenCount: number;
      };
      candidates: Array<Record<string, unknown>>;
      retrievedChunks: number;
      selectedChunks: number;
      contextTokens: number;
      configuration: Record<string, unknown>;
    };
    expect(persisted).toMatchObject({
      target: { chunkIds: ['target-chunk-1'], tokenCount: 10 },
      retrievedChunks: 4,
      selectedChunks: 2,
      contextTokens: 123,
      candidates: [
        {
          chunkId: 'candidate-chunk-1',
          rank: 1,
          tokenCount: 20,
          decision: 'SELECTED',
          discardReason: null,
        },
      ],
    });
    expect(persisted.target.excerpt).toMatchObject({
      filePath: 'src/foo.ts',
      snippet: 'target content',
      truncated: false,
    });
    expect(persisted.target.excerpt).toHaveProperty(
      'contentSha256',
      expect.any(String),
    );
    expect(persisted.candidates[0].excerpt).toMatchObject({
      filePath: 'src/bar.ts',
      snippet: 'candidate content',
    });
    expect(deps.promptBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedChunks: [
          expect.objectContaining({ content: 'candidate content' }),
        ],
      }),
    );
  });

  it('persists mixed RAG audit decisions with every candidate, counters and configuration', async () => {
    const mixedCandidate = (
      overrides: Record<string, unknown>,
    ): Record<string, unknown> => ({
      filePath: 'src/bar.ts',
      symbolKind: 'FUNCTION',
      symbolName: 'bar',
      parentSymbolName: null,
      startLine: 4,
      endLine: 6,
      content: 'candidate content',
      tokenCount: 20,
      semanticScore: 0.9,
      structuralMatch: 'IMPORTS',
      combinedScore: 0.93,
      matchedVia: ['SEMANTIC', 'IMPORTS'],
      ...overrides,
    });
    const mixedContext = {
      target: {
        filePath: 'src/foo.ts',
        symbolName: 'foo',
        methodName: null,
        targetType: 'FUNCTION',
        content: 'target content',
      },
      relatedChunks: [
        {
          filePath: 'src/bar.ts',
          symbolKind: 'FUNCTION',
          symbolName: 'bar',
          parentSymbolName: null,
          content: 'selected content',
          score: 0.93,
          matchedVia: ['SEMANTIC', 'IMPORTS'],
        },
      ],
      functionalRules: [],
      metadata: { language: 'typescript', framework: 'VITEST' },
      retrievedChunks: 4,
      selectedChunks: 1,
      contextTokens: 30,
      audit: {
        functionalRules: { retrieved: 0, selected: 0, tokenCount: 0, omitted: [] },
        target: {
          chunkIds: ['target-chunk-1'],
          chunks: [
            {
              chunkId: 'target-chunk-1',
              filePath: 'src/foo.ts',
              symbolKind: 'FUNCTION',
              symbolName: 'foo',
              parentSymbolName: null,
              startLine: 1,
              endLine: 3,
              content: 'target content',
              tokenCount: 10,
            },
          ],
          tokenCount: 10,
        },
        candidates: [
          mixedCandidate({
            chunkId: 'selected',
            rank: 1,
            content: 'selected content',
            decision: 'SELECTED',
            discardReason: null,
          }),
          mixedCandidate({
            chunkId: 'top-k',
            rank: 2,
            filePath: 'src/top-k.ts',
            content: 'top-k content',
            tokenCount: 5,
            semanticScore: 0.8,
            structuralMatch: null,
            combinedScore: 0.8,
            matchedVia: ['SEMANTIC'],
            decision: 'DISCARDED',
            discardReason: 'TOP_K_LIMIT',
          }),
          mixedCandidate({
            chunkId: 'budget',
            rank: 3,
            filePath: 'src/budget.ts',
            content: 'budget content',
            tokenCount: 90,
            semanticScore: 0.7,
            structuralMatch: null,
            combinedScore: 0.7,
            matchedVia: ['SEMANTIC'],
            decision: 'DISCARDED',
            discardReason: 'TOKEN_BUDGET',
          }),
          mixedCandidate({
            chunkId: 'below',
            rank: 4,
            filePath: 'src/below.ts',
            content: 'below content',
            tokenCount: 3,
            semanticScore: 0.1,
            structuralMatch: null,
            combinedScore: 0.07,
            matchedVia: ['SEMANTIC'],
            decision: 'DISCARDED',
            discardReason: 'BELOW_MINIMUM_SCORE',
          }),
        ],
        configuration: {
          minimumScore: 0.5,
          topK: 2,
          maxContextTokens: 40,
          semanticWeight: 0.7,
          structuralWeight: 0.3,
        },
      },
    };
    const { deps } = makeDeps({
      contextBuilder: { build: vi.fn().mockReturnValue(mixedContext) },
    });
    const traceRepository = deps.contextTracesRepository as {
      updateDetail: ReturnType<typeof vi.fn>;
    };
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const ragDetailCall = traceRepository.updateDetail.mock.calls.find(
      (call: unknown[]) => {
        const detail = call[1] as {
          target?: { excerpt?: { snippet?: string } };
        };
        return detail.target?.excerpt?.snippet === 'target content';
      },
    );
    const persisted = ragDetailCall?.[1] as {
      target: { chunkIds: string[]; tokenCount: number };
      candidates: Array<Record<string, unknown>>;
      retrievedChunks: number;
      selectedChunks: number;
      contextTokens: number;
      configuration: Record<string, unknown>;
    };
    expect(persisted.target).toMatchObject({
      chunkIds: ['target-chunk-1'],
      tokenCount: 10,
    });
    expect(
      persisted.candidates.map(
        ({ chunkId, rank, decision, discardReason, tokenCount }) => [
          chunkId,
          rank,
          decision,
          discardReason,
          tokenCount,
        ],
      ),
    ).toEqual([
      ['selected', 1, 'SELECTED', null, 20],
      ['top-k', 2, 'DISCARDED', 'TOP_K_LIMIT', 5],
      ['budget', 3, 'DISCARDED', 'TOKEN_BUDGET', 90],
      ['below', 4, 'DISCARDED', 'BELOW_MINIMUM_SCORE', 3],
    ]);
    expect(persisted.candidates.map((candidate) => candidate.excerpt)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filePath: 'src/top-k.ts', snippet: 'top-k content' }),
        expect.objectContaining({ filePath: 'src/budget.ts', snippet: 'budget content' }),
        expect.objectContaining({ filePath: 'src/below.ts', snippet: 'below content' }),
      ]),
    );
    expect(persisted.retrievedChunks).toBe(4);
    expect(persisted.selectedChunks).toBe(1);
    expect(persisted.contextTokens).toBe(30);
    expect(persisted.configuration).toEqual({
      minimumScore: 0.5,
      topK: 2,
      maxContextTokens: 40,
      semanticWeight: 0.7,
      structuralWeight: 0.3,
    });
    expect(deps.promptBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedChunks: [
          expect.objectContaining({ content: 'selected content' }),
        ],
      }),
    );
  });

  it('persists AGENT steps incrementally, strips raw results and sidecar paths from detail', async () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const agentAttemptIndex =
      deps.contextTracesRepository.beginAttempt.mock.calls.findIndex(
        (call: unknown[]) =>
          (call[0] as { strategy: string }).strategy === 'GENERALIST_AGENT',
      );
    const agentTraceId = `trace-${agentAttemptIndex + 1}`;
    const agentDetails =
      deps.contextTracesRepository.updateDetail.mock.calls.filter(
        (call: unknown[]) => call[0] === agentTraceId,
      );
    const finalDetail = agentDetails[agentDetails.length - 1][1] as {
      trajectory: Array<Record<string, unknown>>;
      toolCalls: number;
      filesInspected: number;
      budget: Record<string, unknown>;
    };

    expect(agentDetails.length).toBeGreaterThan(1);
    expect(finalDetail).toMatchObject({ toolCalls: 2, filesInspected: 1 });
    expect(finalDetail.budget).toEqual({
      toolCallCap: 20,
      contextTokenBudget: 8000,
      contextTokensDelivered: 40,
      capReached: false,
      truncatedSteps: 1,
    });
    expect(finalDetail.trajectory[0]).toMatchObject({
      resultSummary: 'Listado disponible: 2 archivos.',
      resultSha256: 'a'.repeat(64),
    });
    expect(finalDetail.trajectory[1]).toMatchObject({
      resultSummary: 'Contenido observado en src/foo.ts (líneas 1-2).',
      resultSha256: 'b'.repeat(64),
      observations: [
        {
          excerpt: {
            snippet: 'bounded source excerpt',
            contentSha256: 'c'.repeat(64),
          },
        },
      ],
    });
    expect(JSON.stringify(finalDetail)).not.toContain(
      'SECRET FULL FILE CONTENT',
    );
    expect(JSON.stringify(finalDetail)).not.toContain('src/bar.ts');
    expect(JSON.stringify(finalDetail)).not.toContain('must be stripped');
    expect(
      deps.contextTracesRepository.insertDiscoveredFiles,
    ).toHaveBeenCalledWith(agentTraceId, 1, ['src/foo.ts', 'src/bar.ts']);
    expect(
      (
        finalDetail.trajectory[1].observations as Array<{
          excerpt: Record<string, unknown>;
        }>
      )[0].excerpt,
    ).not.toHaveProperty('before');
  });

  it('gives the agent the real tool cap and context budget without Functional Knowledge or test paths', async () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const generateCalls = (deps.generalistAgentService.generate as ReturnType<typeof vi.fn>).mock.calls;
    expect(generateCalls.length).toBeGreaterThan(0);
    const [instructions, , limits] = generateCalls[0] as [string, unknown, unknown];
    expect(instructions).toContain('como máximo 20 llamadas a herramientas');
    expect(instructions).toContain('como máximo 8000 tokens');
    expect(instructions).not.toMatch(/orientativo/i);
    expect(instructions).not.toMatch(/functional|oráculo|oracle/i);
    expect(limits).toEqual({ toolCallCap: 20, contextTokenBudget: 8000 });
  });

  it('retains RAG detail and marks the attempt failed when LLM generation fails afterward', async () => {
    const { deps } = makeDeps({
      llmProvider: {
        generate: vi
          .fn()
          .mockRejectedValue(new Error('source text must not be stored')),
        resolveEffectiveConfig: vi.fn().mockResolvedValue(effectiveConfig),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const ragAttemptIndexes =
      deps.contextTracesRepository.beginAttempt.mock.calls
        .map((call: unknown[], index: number) =>
          (call[0] as { strategy: string }).strategy === 'RAG' ? index : -1,
        )
        .filter((index: number) => index >= 0);
    const ragTraceIds = ragAttemptIndexes.map(
      (index: number) => `trace-${index + 1}`,
    );
    expect(deps.contextTracesRepository.updateDetail).toHaveBeenCalled();
    for (const traceId of ragTraceIds) {
      expect(deps.contextTracesRepository.failTrace).toHaveBeenCalledWith(
        traceId,
      );
    }
    const failedRagUpdates =
      deps.experimentRunsRepository.updateRepetitionById.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as { strategy: string }).strategy === 'RAG' &&
          call[2] === 'FAILED',
      );
    expect(failedRagUpdates).toHaveLength(3);
    expect(ragTraceIds.length).toBe(3);
  });

  it('persists contract-shaped empty details before workspace extraction fails', async () => {
    const { deps } = makeDeps({
      zipExtractionService: {
        extract: vi.fn().mockRejectedValue(new Error('invalid snapshot zip')),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.retrievalService.retrieve).not.toHaveBeenCalled();
    expect(deps.fileDiscoveryService.discover).not.toHaveBeenCalled();
    expect(deps.contextTracesRepository.updateDetail).toHaveBeenCalledTimes(6);

    const attempts = deps.contextTracesRepository.beginAttempt.mock.calls;
    for (const [index, [input]] of attempts.entries()) {
      const traceId = `trace-${index + 1}`;
      const detailCall =
        deps.contextTracesRepository.updateDetail.mock.calls.find(
          (call: unknown[]) => call[0] === traceId,
        );
      const detail = detailCall?.[1] as Record<string, unknown> | undefined;
      expect(detail).toBeDefined();

      if ((input as { strategy: string }).strategy === 'RAG') {
        expect(detail).toMatchObject({
          target: {
            chunkIds: [],
            tokenCount: 0,
            excerpt: {
              filePath: 'src/foo.ts',
              snippet: '',
              startLine: null,
              endLine: null,
              truncated: false,
            },
          },
          candidates: [],
          retrievedChunks: 0,
          selectedChunks: 0,
          contextTokens: 0,
          configuration: {
            minimumScore: 0,
            topK: 10,
            maxContextTokens: 6000,
            semanticWeight: 0.7,
            structuralWeight: 0.3,
          },
        });
      } else {
        expect(detail).toEqual({
          trajectory: [],
          toolCalls: 0,
          filesInspected: 0,
        });
        expect(
          deps.contextTracesRepository.updateAgentCounters,
        ).toHaveBeenCalledWith(traceId, { toolCalls: 0, filesInspected: 0 });
      }
    }

    expect(deps.contextTracesRepository.failTrace).toHaveBeenCalledTimes(6);
    expect(
      deps.experimentRunsRepository.updateRepetitionById,
    ).toHaveBeenCalledTimes(6);
  });

  it('retains the empty RAG detail when retrieval fails before producing evidence', async () => {
    const { deps } = makeDeps({
      retrievalService: {
        retrieve: vi.fn().mockRejectedValue(new Error('retrieval unavailable')),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.retrievalService.retrieve).toHaveBeenCalledTimes(3);
    const ragAttemptIndexes =
      deps.contextTracesRepository.beginAttempt.mock.calls
        .map((call: unknown[], index: number) =>
          (call[0] as { strategy: string }).strategy === 'RAG' ? index : -1,
        )
        .filter((index: number) => index >= 0);
    for (const index of ragAttemptIndexes) {
      const traceId = `trace-${index + 1}`;
      const detailCall =
        deps.contextTracesRepository.updateDetail.mock.calls.find(
          (call: unknown[]) => call[0] === traceId,
        );
      expect(detailCall?.[1]).toMatchObject({
        target: {
          chunkIds: [],
          excerpt: { snippet: '', startLine: null, endLine: null },
        },
        candidates: [],
        retrievedChunks: 0,
        selectedChunks: 0,
        contextTokens: 0,
      });
      expect(deps.contextTracesRepository.failTrace).toHaveBeenCalledWith(
        traceId,
      );
    }
  });

  it('records FAILED/INFRASTRUCTURE for a repetition when the Sandbox is unavailable, without stopping the other repetitions', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi
          .fn()
          .mockRejectedValue(
            new SandboxUnavailableError('no sandbox configured'),
          ),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    // Run sin semilla (legacy, WI-CORE-025 (4)): un único intento por slot, sin reintento externo.
    expect(
      deps.experimentRunsRepository.updateRepetitionById,
    ).toHaveBeenCalledTimes(6);
    const anyCall =
      deps.experimentRunsRepository.updateRepetitionById.mock.calls[0];
    expect(anyCall[1]).toMatchObject({
      valid: false,
      failureType: 'INFRASTRUCTURE',
    });
    expect(writesOf(deps).every((write) => !('technicallyEvaluable' in write))).toBe(true);
    expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith(
      'exp-1',
    );
  });

  it('records FAILED/CONFIGURATION without calling the Sandbox when the framework is unknown', async () => {
    const { deps } = makeDeps({
      projectVersionsRepository: {
        findById: vi.fn().mockResolvedValue({
          id: 'version-1',
          snapshotKey: 'key',
          detectedFramework: null,
        }),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.sandboxExecutionService.execute).not.toHaveBeenCalled();
    expect(
      deps.experimentRunsRepository.updateRepetitionById,
    ).toHaveBeenCalledTimes(6);
    expect(
      deps.experimentRunsRepository.updateRepetitionById.mock.calls[0][1],
    ).toMatchObject({
      failureType: 'CONFIGURATION',
    });
  });

  it('marks the experiment FAILED when the target cannot be resolved before any repetition runs', async () => {
    const { deps } = makeDeps({
      testTargetsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });
    const handler = makeHandler(deps);

    await expect(handler.handle(payload, 'job-1')).rejects.toThrow(
      'No existe el target',
    );

    expect(deps.experimentRunsRepository.markFailed).toHaveBeenCalledWith(
      'exp-1',
      'EXPERIMENT_FAILED',
      expect.stringContaining('No existe el target'),
    );
    expect(deps.sandboxExecutionService.execute).not.toHaveBeenCalled();
  });

  it('gives functional rules only to the RAG arm and passes them to the context builder (WI-CORE-021)', async () => {
    const rule = {
      knowledgeId: 'rule-1',
      scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
      normalizedRule: 'Regla de prueba.',
      scope: 'METHOD',
      targetRef: 'src/foo.ts::foo',
      source: 'HUMAN_ANSWER',
      provenance: { confirmedByUserId: null, confirmedRole: null, originHeadSha: null, sourceRef: null },
    };
    const { deps } = makeDeps({
      functionalRulesRetriever: { retrieve: vi.fn().mockResolvedValue([rule]) },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.functionalRulesRetriever.retrieve).toHaveBeenCalledTimes(3);
    expect(deps.functionalRulesRetriever.retrieve).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ filePath: 'src/foo.ts' }),
    );
    const withRules = deps.contextBuilder.build.mock.calls.filter(
      (call: unknown[]) => (call[4] as unknown[]).length > 0,
    );
    expect(withRules).toHaveLength(3);
    for (const call of withRules) {
      expect(call[4]).toEqual([rule]);
    }
  });

  it('persists rule ids and counts in the RAG trace without rule text or provenance, and includes the text only in the prompt', async () => {
    const ruleText = 'TEXTO_REGLA_CONFIDENCIAL_PARA_PROMPT';
    const rule = {
      knowledgeId: 'rule-1',
      scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
      normalizedRule: ruleText,
      scope: 'METHOD',
      targetRef: 'src/foo.ts::foo',
      source: 'HUMAN_ANSWER',
      provenance: { confirmedByUserId: null, confirmedRole: 'ADMIN', originHeadSha: null, sourceRef: null },
    };
    const chunk = {
      id: 'target-chunk-1',
      filePath: 'src/foo.ts',
      symbolKind: 'FUNCTION',
      symbolName: 'foo',
      parentSymbolName: null,
      startLine: 1,
      endLine: 3,
      content: 'target content',
      tokenCount: 5,
    };
    const { deps } = makeDeps({
      retrievalService: { retrieve: vi.fn().mockResolvedValue({ targetChunks: [chunk], candidates: [] }) },
      functionalRulesRetriever: { retrieve: vi.fn().mockResolvedValue([rule]) },
      contextBuilder: new ContextBuilder({ get: (_key: string, fallback: unknown) => fallback } as never),
      promptBuilder: new PromptBuilder(),
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const ragPrompts = deps.llmProvider.generate.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(ragPrompts.some((prompt: string) => prompt.includes('Reglas funcionales') && prompt.includes(ruleText))).toBe(true);
    // Solo los details RAG (forma con `candidates`); el detail del agente no lleva reglas.
    const details = deps.contextTracesRepository.updateDetail.mock.calls
      .map((call: unknown[]) => JSON.stringify(call[1]))
      .filter((serialized: string) => serialized.includes('"candidates"'));
    expect(details.length).toBeGreaterThan(0);
    for (const serialized of details) {
      // WI-CORE-026: el detail persiste los ids y conteos de reglas, nunca su texto ni su procedencia.
      expect(serialized).toContain('"functionalRules"');
      expect(serialized).not.toContain(ruleText);
      expect(serialized).not.toContain('confirmedRole');
      expect(serialized).not.toContain('ADMIN');
      expect(serialized).not.toContain('originHeadSha');
    }
    expect(details.some((serialized: string) => serialized.includes('"functionalRuleIds":["rule-1"]'))).toBe(true);
  });

  describe('OE5 pareado y repetición externa (WI-CORE-025)', () => {
    it('orders each pair by the persisted seed, runs its two positions one after the other and shares pairId', async () => {
      const { deps } = makeDeps({ configService: sequentialConfig() });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );
      const handler = makeHandler(deps);

      await handler.handle(payload, 'job-1');

      const begins = beginsOf(deps);
      const expectedOrder = [1, 2, 3].flatMap((repetition) =>
        pairOrder(SEED, repetition).map((strategy) => ({ strategy, repetition })),
      );
      expect(
        begins.map(({ strategy, repetition }) => ({ strategy, repetition })),
      ).toEqual(expectedOrder);
      for (const repetition of [1, 2, 3]) {
        const pair = begins.filter((begin) => begin.repetition === repetition);
        expect(pair.map((begin) => begin.pairId)).toEqual([
          experimentPairId('exp-1', repetition),
          experimentPairId('exp-1', repetition),
        ]);
        expect(pair.map((begin) => begin.pairPosition)).toEqual([1, 2]);
      }
    });

    it('retries an external failure of the first position before starting the second, with the :2 identity and the same pair', async () => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(new SandboxUnavailableError('down'))
        .mockResolvedValue(successfulSandboxResult());
      const { deps } = makeDeps({
        configService: sequentialConfig(),
        sandboxExecutionService: { execute },
      });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );
      const handler = makeHandler(deps);

      await handler.handle(payload, 'job-1');

      const [first, second] = pairOrder(SEED, 1);
      const begins = beginsOf(deps);
      expect(
        begins.slice(0, 3).map((begin) => `${begin.strategy}:${begin.repetition}`),
      ).toEqual([`${first}:1`, `${first}:1`, `${second}:1`]);
      expect(begins[1].pairId).toBe(begins[0].pairId);
      expect(begins[1].pairPosition).toBe(begins[0].pairPosition);

      const executions = executionsOf(deps);
      expect(executions).toHaveLength(7);
      expect(executions.slice(0, 3).map((execution) => execution.requestId)).toEqual([
        sandboxExperimentRequestId('job-1', first, 1),
        sandboxExperimentRequestId('job-1', first, 1, 2),
        sandboxExperimentRequestId('job-1', second, 1),
      ]);
      expect(writesOf(deps)[0]).toMatchObject({ valid: false, failureType: 'INFRASTRUCTURE' });
      expect(writesOf(deps)[0]).not.toHaveProperty('technicallyEvaluable');
    });

    it('keeps a second external failure as technicallyEvaluable=false without any third attempt', async () => {
      const execute = vi.fn().mockRejectedValue(new SandboxUnavailableError('down'));
      const { deps } = makeDeps({ sandboxExecutionService: { execute } });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );
      const handler = makeHandler(deps);

      await handler.handle(payload, 'job-1');

      expect(execute).toHaveBeenCalledTimes(12);
      expect(beginsOf(deps)).toHaveLength(12);
      expect(new Set(beginsOf(deps).map((begin) => begin.pairId)).size).toBe(3);
      const writes = writesOf(deps);
      expect(writes.filter((write) => write.technicallyEvaluable === false)).toHaveLength(6);
      expect(writes.filter((write) => write.technicallyEvaluable === undefined)).toHaveLength(6);
      expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
    });

    it('does not retry a strategy failure and leaves the repetition technically evaluable', async () => {
      const execute = vi.fn().mockResolvedValue(failedCompilationResult());
      const { deps } = makeDeps({
        configService: sequentialConfig(),
        sandboxExecutionService: { execute },
      });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );
      const handler = makeHandler(deps);

      await handler.handle(payload, 'job-1');

      expect(execute).toHaveBeenCalledTimes(6);
      expect(beginsOf(deps)).toHaveLength(6);
      const writes = writesOf(deps);
      expect(writes.every((write) => write.failureType === 'COMPILATION')).toBe(true);
      expect(writes.every((write) => !('technicallyEvaluable' in write))).toBe(true);
    });

    it('does not retry a Sandbox timeout: TIMED_OUT is not an external failure', async () => {
      const execute = vi.fn().mockResolvedValue(timedOutResult());
      const { deps } = makeDeps({
        configService: sequentialConfig(),
        sandboxExecutionService: { execute },
      });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );
      const handler = makeHandler(deps);

      await handler.handle(payload, 'job-1');

      expect(execute).toHaveBeenCalledTimes(6);
      expect(beginsOf(deps)).toHaveLength(6);
      const writes = writesOf(deps);
      expect(writes.every((write) => write.failureType === 'INFRASTRUCTURE')).toBe(true);
      expect(writes.every((write) => write.errorSummary === SANDBOX_TIMED_OUT_ERROR_SUMMARY)).toBe(true);
      expect(writes.every((write) => !('technicallyEvaluable' in write))).toBe(true);
      // WI-CORE-025 (1): el discriminador interno es la columna, no el texto.
      expect(writes.every((write) => write.sandboxTimedOut === true)).toBe(true);
    });

    it('persists sandboxTimedOut only for TIMED_OUT, leaving it unset for other Sandbox outcomes', async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce(timedOutResult())
        .mockResolvedValue(successfulSandboxResult());
      const { deps } = makeDeps({
        configService: sequentialConfig(),
        sandboxExecutionService: { execute },
      });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );

      await makeHandler(deps).handle(payload, 'job-1');

      const writes = writesOf(deps);
      expect(writes[0]).toMatchObject({ sandboxTimedOut: true, failureType: 'INFRASTRUCTURE' });
      expect(writes.slice(1).every((write) => !('sandboxTimedOut' in write))).toBe(true);
    });

    it('treats a generic Sandbox client error as infrastructure: one external retry with the :2 identity (WI-CORE-025 (2))', async () => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValue(successfulSandboxResult());
      const { deps } = makeDeps({
        configService: sequentialConfig(),
        sandboxExecutionService: { execute },
      });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );

      await makeHandler(deps).handle(payload, 'job-1');

      const [first, second] = pairOrder(SEED, 1);
      const executions = executionsOf(deps);
      expect(executions.slice(0, 3).map((execution) => execution.requestId)).toEqual([
        sandboxExperimentRequestId('job-1', first, 1),
        sandboxExperimentRequestId('job-1', first, 1, 2),
        sandboxExperimentRequestId('job-1', second, 1),
      ]);
      const writes = writesOf(deps);
      expect(writes[0]).toMatchObject({ failureType: 'INFRASTRUCTURE', valid: false });
      expect(writes[0]).not.toHaveProperty('sandboxTimedOut');
      expect(writes[0]).not.toHaveProperty('technicallyEvaluable');
    });

    it('does not retry a generic Sandbox client error on the second attempt and marks it technically non-evaluable', async () => {
      const execute = vi.fn().mockRejectedValue(new Error('socket hang up'));
      const { deps } = makeDeps({
        configService: sequentialConfig(),
        sandboxExecutionService: { execute },
      });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );

      await makeHandler(deps).handle(payload, 'job-1');

      expect(execute).toHaveBeenCalledTimes(12);
      const writes = writesOf(deps);
      expect(writes.filter((write) => write.technicallyEvaluable === false)).toHaveLength(6);
    });

    it('retries an external LLM failure once and does not retry other LLM failures', async () => {
      const externalGenerate = vi
        .fn()
        .mockRejectedValue(new LLMProviderUnavailableError('upstream 503', true));
      const external = makeDeps({
        llmProvider: {
          generate: externalGenerate,
          resolveEffectiveConfig: vi.fn().mockResolvedValue(effectiveConfig),
        },
      });
      // El reintento externo solo aplica a runs con semilla (WI-CORE-025 (4)).
      (external.deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );
      await makeHandler(external.deps).handle(payload, 'job-1');

      expect(externalGenerate).toHaveBeenCalledTimes(6);
      const externalWrites = writesOf(external.deps).filter(
        (write) => write.failureType === 'INFRASTRUCTURE',
      );
      expect(externalWrites).toHaveLength(6);
      expect(externalWrites.filter((write) => write.technicallyEvaluable === false)).toHaveLength(3);

      const notExternalGenerate = vi
        .fn()
        .mockRejectedValue(new LLMProviderUnavailableError('bad request', false));
      const notExternal = makeDeps({
        llmProvider: {
          generate: notExternalGenerate,
          resolveEffectiveConfig: vi.fn().mockResolvedValue(effectiveConfig),
        },
      });
      (notExternal.deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun(),
      );
      await makeHandler(notExternal.deps).handle(payload, 'job-2');

      expect(notExternalGenerate).toHaveBeenCalledTimes(3);
      expect(writesOf(notExternal.deps).filter((write) => write.failureType === 'UNKNOWN')).toHaveLength(3);
    });

    it('does not treat the generation timeout (maxDurationMs persisted on the run) as an external failure', async () => {
      const { deps } = makeDeps({
        generalistAgentService: {
          generate: vi.fn(() => new Promise(() => undefined)),
        },
      });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun({ budget: { toolCallCap: 5, contextTokenBudget: 1234, maxDurationMs: 50 } }),
      );
      const handler = makeHandler(deps);

      await handler.handle(payload, 'job-1');

      expect(deps.generalistAgentService.generate).toHaveBeenCalledTimes(3);
      expect(beginsOf(deps)).toHaveLength(6);
      const writes = writesOf(deps);
      expect(writes.filter((write) => write.failureType === 'UNKNOWN')).toHaveLength(3);
      expect(writes.some((write) => 'technicallyEvaluable' in write)).toBe(false);
    });

    it('on redelivery skips terminal slots and reruns only attempt 2 of an external failure', async () => {
      const { deps } = makeDeps({
        experimentRunsRepository: {
          findById: vi.fn().mockResolvedValue(seededRun()),
          markStarted: vi.fn(),
          complete: vi.fn(),
          markFailed: vi.fn(),
          updateRepetitionById: vi.fn(),
          refreshCompletedRepetitions: vi.fn(),
          findRepetitions: vi.fn().mockResolvedValue([
            attemptRow('RAG', 1, 1, 'FAILED', 'INFRASTRUCTURE', 'Sandbox no disponible.'),
            attemptRow('RAG', 2, 1, 'COMPLETED'),
            attemptRow('RAG', 3, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 1, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 2, 1, 'FAILED', 'COMPILATION', 'Fallo de compilación.'),
            attemptRow('GENERALIST_AGENT', 3, 2, 'FAILED', 'INFRASTRUCTURE', 'Sandbox no disponible.'),
          ]),
        },
      });
      const handler = makeHandler(deps);

      await handler.handle(payload, 'job-2');

      expect(
        beginsOf(deps).map((begin) => `${begin.strategy}:${begin.repetition}`),
      ).toEqual(['RAG:1']);
      const executions = executionsOf(deps);
      expect(executions).toHaveLength(1);
      expect(executions[0].requestId).toBe(sandboxExperimentRequestId('job-2', 'RAG', 1, 2));
      expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
    });

    it('on redelivery does not retry a persisted sandbox timeout', async () => {
      const { deps } = makeDeps({
        experimentRunsRepository: {
          findById: vi.fn().mockResolvedValue(seededRun()),
          markStarted: vi.fn(),
          complete: vi.fn(),
          markFailed: vi.fn(),
          updateRepetitionById: vi.fn(),
          refreshCompletedRepetitions: vi.fn(),
          findRepetitions: vi.fn().mockResolvedValue([
            attemptRow('RAG', 1, 1, 'FAILED', 'INFRASTRUCTURE', SANDBOX_TIMED_OUT_ERROR_SUMMARY, true),
            attemptRow('RAG', 2, 1, 'COMPLETED'),
            attemptRow('RAG', 3, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 1, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 2, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 3, 1, 'COMPLETED'),
          ]),
        },
      });

      await makeHandler(deps).handle(payload, 'job-2');

      expect(beginsOf(deps)).toHaveLength(0);
      expect(executionsOf(deps)).toHaveLength(0);
      expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
    });

    it('sends the persisted runner and execution profile to the Sandbox and uses the persisted budget in both arms', async () => {
      const configGet = vi.fn((_key: string, fallback?: unknown) => fallback);
      const { deps } = makeDeps({ configService: { get: configGet } });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        seededRun({ runnerHint: 'JEST', executionProfile: 'NODE_TYPESCRIPT' }),
      );
      const handler = makeHandler(deps);

      await handler.handle(payload, 'job-1');

      const executions = executionsOf(deps);
      expect(executions).toHaveLength(6);
      for (const execution of executions) {
        expect(execution.runnerHint).toBe('JEST');
        expect(execution.executionProfile).toBe('NODE_TYPESCRIPT');
      }
      for (const call of (deps.generalistAgentService.generate as ReturnType<typeof vi.fn>).mock.calls) {
        expect(call[2]).toEqual({ toolCallCap: 5, contextTokenBudget: 1234 });
      }
      for (const call of (deps.contextBuilder.build as ReturnType<typeof vi.fn>).mock.calls) {
        expect(call[3]).toEqual({ maxContextTokens: 1234 });
      }
      const readKeys = configGet.mock.calls.map((call: unknown[]) => call[0]);
      expect(readKeys).not.toContain('AGENT_MAX_TOOL_CALLS');
      expect(readKeys).not.toContain('RETRIEVAL_MAX_CONTEXT_TOKENS');
      expect(readKeys).not.toContain('GENERATION_TIMEOUT_MS');
    });

    it('keeps legacy runs without seed, budget or profile on the environment defaults and without pair identity', async () => {
      const { deps } = makeDeps();
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'exp-1',
        status: 'PENDING',
        modelConfig: effectiveConfig,
        randomizationSeed: null,
        budget: null,
        executionProfile: null,
        runnerHint: null,
      });
      const handler = makeHandler(deps);

      await handler.handle(payload, 'job-1');

      expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
      expect(executionsOf(deps)).toHaveLength(6);
      for (const execution of executionsOf(deps)) {
        expect(execution.runnerHint).toBe('VITEST');
        expect(execution.executionProfile).toBeUndefined();
      }
      for (const begin of beginsOf(deps)) {
        expect(begin.pairId).toBeNull();
        expect(begin.pairPosition).toBeNull();
      }
      for (const call of (deps.generalistAgentService.generate as ReturnType<typeof vi.fn>).mock.calls) {
        expect(call[2]).toEqual({ toolCallCap: 20, contextTokenBudget: 8000 });
      }
    });

    it('on redelivery retries an external failure whose row has sandboxTimedOut NULL, even if its summary is the timeout text (WI-CORE-025 (1))', async () => {
      const { deps } = makeDeps({
        experimentRunsRepository: {
          findById: vi.fn().mockResolvedValue(seededRun()),
          markStarted: vi.fn(),
          complete: vi.fn(),
          markFailed: vi.fn(),
          updateRepetitionById: vi.fn(),
          refreshCompletedRepetitions: vi.fn(),
          findRepetitions: vi.fn().mockResolvedValue([
            attemptRow('RAG', 1, 1, 'FAILED', 'INFRASTRUCTURE', SANDBOX_TIMED_OUT_ERROR_SUMMARY, null),
            attemptRow('RAG', 2, 1, 'COMPLETED'),
            attemptRow('RAG', 3, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 1, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 2, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 3, 1, 'COMPLETED'),
          ]),
        },
      });

      await makeHandler(deps).handle(payload, 'job-2');

      expect(
        beginsOf(deps).map((begin) => `${begin.strategy}:${begin.repetition}`),
      ).toEqual(['RAG:1']);
      expect(executionsOf(deps)[0].requestId).toBe(sandboxExperimentRequestId('job-2', 'RAG', 1, 2));
    });

    it('on redelivery with a live-heartbeat second-attempt RUNNING row, touches nothing and reschedules the job (WI-CORE-025 (3c), iii)', async () => {
      const { deps } = makeDeps({
        experimentRunsRepository: {
          findById: vi.fn().mockResolvedValue(seededRun()),
          markStarted: vi.fn(),
          complete: vi.fn(),
          markFailed: vi.fn(),
          updateRepetitionById: vi.fn(),
          closeInterruptedRepetition: vi.fn(),
          refreshCompletedRepetitions: vi.fn(),
          findRepetitions: vi.fn().mockResolvedValue([
            { ...attemptRow('RAG', 1, 2, 'RUNNING'), lastHeartbeatAt: new Date(), createdAt: new Date() },
            attemptRow('RAG', 2, 1, 'COMPLETED'),
            attemptRow('RAG', 3, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 1, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 2, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 3, 1, 'COMPLETED'),
          ]),
        },
      });

      await expect(makeHandler(deps).handle(payload, 'job-2')).rejects.toBeInstanceOf(RescheduleJobError);

      expect(beginsOf(deps)).toHaveLength(0);
      expect(executionsOf(deps)).toHaveLength(0);
      expect(writesOf(deps)).toHaveLength(0);
      expect(repoOf(deps).closeInterruptedRepetition).not.toHaveBeenCalled();
      expect(deps.experimentRunsRepository.markStarted).not.toHaveBeenCalled();
      expect(deps.experimentRunsRepository.markFailed).not.toHaveBeenCalled();
      expect(deps.experimentRunsRepository.complete).not.toHaveBeenCalled();
    });

    it('legacy runs without seed execute one attempt per slot and never retry an external failure', async () => {
      const execute = vi.fn().mockRejectedValue(new SandboxUnavailableError('down'));
      const { deps } = makeDeps({ sandboxExecutionService: { execute } });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'exp-1',
        status: 'PENDING',
        modelConfig: effectiveConfig,
        randomizationSeed: null,
        budget: null,
        executionProfile: null,
        runnerHint: null,
      });

      await makeHandler(deps).handle(payload, 'job-1');

      expect(beginsOf(deps)).toHaveLength(6);
      expect(execute).toHaveBeenCalledTimes(6);
      // Identidad sin sufijo ':2' para los seis slots: el único intento de cada uno.
      const expectedRequestIds = (['RAG', 'GENERALIST_AGENT'] as const).flatMap((strategy) =>
        [1, 2, 3].map((repetition) => sandboxExperimentRequestId('job-1', strategy, repetition)),
      );
      expect(executionsOf(deps).map((execution) => execution.requestId).sort()).toEqual(
        [...expectedRequestIds].sort(),
      );
      expect(writesOf(deps).every((write) => !('technicallyEvaluable' in write))).toBe(true);
      expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
    });

    it('legacy redelivery skips every slot that already has an attempt, without creating a retry', async () => {
      const { deps } = makeDeps({
        experimentRunsRepository: {
          findById: vi.fn().mockResolvedValue({
            id: 'exp-1',
            status: 'PENDING',
            modelConfig: effectiveConfig,
            randomizationSeed: null,
            budget: null,
            executionProfile: null,
            runnerHint: null,
          }),
          markStarted: vi.fn(),
          complete: vi.fn(),
          markFailed: vi.fn(),
          updateRepetitionById: vi.fn(),
          refreshCompletedRepetitions: vi.fn(),
          findRepetitions: vi.fn().mockResolvedValue([
            attemptRow('RAG', 1, 1, 'FAILED', 'INFRASTRUCTURE', 'Sandbox no disponible.'),
            attemptRow('RAG', 2, 1, 'COMPLETED'),
            attemptRow('RAG', 3, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 1, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 2, 1, 'COMPLETED'),
            attemptRow('GENERALIST_AGENT', 3, 1, 'COMPLETED'),
          ]),
        },
      });

      await makeHandler(deps).handle(payload, 'job-2');

      expect(beginsOf(deps)).toHaveLength(0);
      expect(executionsOf(deps)).toHaveLength(0);
      expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
    });
  });
});

/** Cede el control a las promesas pendientes sin usar timers reales. */
async function flushMicrotasks(rounds = 200): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

/** Acceso tipado al repositorio simulado (los métodos nuevos no están en el tipo inferido de makeDeps). */
function repoOf(deps: ReturnType<typeof makeDeps>['deps']): Record<string, ReturnType<typeof vi.fn>> {
  return deps.experimentRunsRepository as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

function configWith(values: Record<string, unknown>) {
  return {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  };
}

/** Fila de último intento con latido vencido (1 h) o vigente, según `expired`. */
function rowWithHeartbeat(
  base: ReturnType<typeof attemptRow>,
  id: string,
  expired: boolean,
) {
  const stamp = expired ? new Date(Date.now() - 3_600_000) : new Date();
  return { ...base, id, lastHeartbeatAt: stamp, createdAt: stamp };
}

const COMPLETED_OTHERS = [
  attemptRow('RAG', 2, 1, 'COMPLETED'),
  attemptRow('RAG', 3, 1, 'COMPLETED'),
  attemptRow('GENERALIST_AGENT', 1, 1, 'COMPLETED'),
  attemptRow('GENERALIST_AGENT', 2, 1, 'COMPLETED'),
  attemptRow('GENERALIST_AGENT', 3, 1, 'COMPLETED'),
];

function withRunRepository(
  rows: unknown[],
  extra: Record<string, unknown> = {},
) {
  return {
    findById: vi.fn().mockResolvedValue(seededRun()),
    markStarted: vi.fn(),
    complete: vi.fn(),
    markFailed: vi.fn(),
    updateRepetitionById: vi.fn().mockResolvedValue(true),
    closeInterruptedRepetition: vi.fn(),
    refreshCompletedRepetitions: vi.fn(),
    findRepetitions: vi.fn().mockResolvedValue(rows),
    ...extra,
  };
}

describe('ExperimentJobHandler recovery (WI-CORE-025 (3c))', () => {
  it('waits for every in-flight slot before rejecting, then rethrows the first error (A)', async () => {
    let releaseInFlight!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    let inFlightReached!: () => void;
    const reached = new Promise<void>((resolve) => {
      inFlightReached = resolve;
    });
    let inFlightFinished = false;
    const { deps } = makeDeps({
      configService: configWith({ EXPERIMENT_REPETITION_CONCURRENCY: 2 }),
      sandboxExecutionService: {
        execute: vi.fn(async () => {
          inFlightReached();
          await gate;
          inFlightFinished = true;
          return successfulSandboxResult();
        }),
      },
    });
    (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(seededRun());
    // El primer slot del par 1 falla al abrir el intento; el par 2 queda en vuelo.
    const beginAttempt = deps.contextTracesRepository.beginAttempt as ReturnType<typeof vi.fn>;
    beginAttempt.mockImplementation(async (input: Record<string, unknown>) => {
      if (input.repetition === 1) {
        throw new Error('boom-begin');
      }
      return {
        repetition: { id: `rep-${String(input.strategy)}-${String(input.repetition)}`, ...input },
        trace: { id: `trace-${String(input.repetition)}` },
      };
    });

    let settled = false;
    const handling = makeHandler(deps).handle(payload, 'job-race').then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );

    await reached;
    await flushMicrotasks();
    expect(settled).toBe(false);

    releaseInFlight();
    const outcome = await handling;

    expect(inFlightFinished).toBe(true);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe('boom-begin');
    expect(deps.experimentRunsRepository.complete).not.toHaveBeenCalled();
  });

  it('renews the heartbeat while an attempt runs and clears its timer afterwards (3c)', async () => {
    vi.useFakeTimers();
    try {
      let releaseSandbox!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseSandbox = resolve;
      });
      let sandboxEntered!: () => void;
      const entered = new Promise<void>((resolve) => {
        sandboxEntered = resolve;
      });
      const touch = vi.fn().mockResolvedValue({ count: 1 });
      const { deps } = makeDeps({
        configService: configWith({ EXPERIMENT_REPETITION_CONCURRENCY: 1, EXPERIMENT_HEARTBEAT_INTERVAL_MS: 15_000 }),
        sandboxExecutionService: {
          execute: vi.fn(async () => {
            sandboxEntered();
            await gate;
            return successfulSandboxResult();
          }),
        },
      });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(seededRun());
      repoOf(deps).touchRepetitionHeartbeat = touch;

      const handling = makeHandler(deps).handle(payload, 'job-hb');
      await entered;
      await flushMicrotasks();
      vi.advanceTimersByTime(15_000);
      await flushMicrotasks();
      vi.advanceTimersByTime(15_000);
      await flushMicrotasks();

      expect(touch).toHaveBeenCalledTimes(2);
      expect(touch.mock.calls[0][0]).toBe('repetition-1');
      expect(touch.mock.calls[0][1]).toBeInstanceOf(Date);

      releaseSandbox();
      await handling;

      const callsAfterRun = touch.mock.calls.length;
      vi.advanceTimersByTime(120_000);
      await flushMicrotasks();
      expect(touch.mock.calls.length).toBe(callsAfterRun);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failing heartbeat write is absorbed and does not stop the attempt (3c)', async () => {
    vi.useFakeTimers();
    try {
      let releaseSandbox!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseSandbox = resolve;
      });
      let sandboxEntered!: () => void;
      const entered = new Promise<void>((resolve) => {
        sandboxEntered = resolve;
      });
      const touch = vi.fn().mockRejectedValue(new Error('db down'));
      const { deps } = makeDeps({
        configService: configWith({ EXPERIMENT_REPETITION_CONCURRENCY: 1, EXPERIMENT_HEARTBEAT_INTERVAL_MS: 15_000 }),
        sandboxExecutionService: {
          execute: vi.fn(async () => {
            sandboxEntered();
            await gate;
            return successfulSandboxResult();
          }),
        },
      });
      (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(seededRun());
      repoOf(deps).touchRepetitionHeartbeat = touch;

      const handling = makeHandler(deps).handle(payload, 'job-hb-fail');
      await entered;
      vi.advanceTimersByTime(15_000);
      await flushMicrotasks();
      expect(touch).toHaveBeenCalled();

      releaseSandbox();
      await expect(handling).resolves.toBeUndefined();
      expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('an expired RUNNING attempt 1 is closed and rerun as attempt 2 with the same pair identity (3c, i)', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: withRunRepository([
        rowWithHeartbeat(attemptRow('RAG', 1, 1, 'RUNNING'), 'row-rag-1-a1', true),
        ...COMPLETED_OTHERS,
      ]),
    });

    await makeHandler(deps).handle(payload, 'job-3c-1');

    const close = repoOf(deps).closeInterruptedRepetition as ReturnType<typeof vi.fn>;
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith('row-rag-1-a1', { errorSummary: expect.any(String) });
    expect(deps.experimentRunsRepository.refreshCompletedRepetitions).toHaveBeenCalledWith('exp-1');

    const begins = beginsOf(deps).filter((begin) => begin.strategy === 'RAG' && begin.repetition === 1);
    expect(begins).toHaveLength(1);
    expect(begins[0].pairId).toBe(experimentPairId('exp-1', 1));

    const requestIds = executionsOf(deps).map((execution) => execution.requestId);
    expect(requestIds).toContain(sandboxExperimentRequestId('job-3c-1', 'RAG', 1, 2));
    expect(requestIds).not.toContain(sandboxExperimentRequestId('job-3c-1', 'RAG', 1, 1));
    expect(requestIds.filter((id) => id === sandboxExperimentRequestId('job-3c-1', 'RAG', 1, 2))).toHaveLength(1);
    expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
  });

  it('an expired RUNNING attempt 2 is closed as INFRASTRUCTURE, not technically evaluable, with no third attempt (3c, ii)', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: withRunRepository([
        rowWithHeartbeat(attemptRow('RAG', 1, 2, 'RUNNING'), 'row-rag-1-a2', true),
        ...COMPLETED_OTHERS,
      ]),
    });

    await makeHandler(deps).handle(payload, 'job-3c-2');

    const close = repoOf(deps).closeInterruptedRepetition as ReturnType<typeof vi.fn>;
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith('row-rag-1-a2', {
      errorSummary: expect.any(String),
      technicallyEvaluable: false,
    });
    expect(beginsOf(deps).filter((begin) => begin.strategy === 'RAG' && begin.repetition === 1)).toHaveLength(0);
    const requestIds = executionsOf(deps).map((execution) => execution.requestId);
    for (const attempt of [1, 2, 3]) {
      expect(requestIds).not.toContain(sandboxExperimentRequestId('job-3c-2', 'RAG', 1, attempt));
    }
    expect(writesOf(deps)).toHaveLength(0);
    expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
  });

  it('a rerun of an expired attempt 1 that also fails externally stops at attempt 2 (3c, i and ii)', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: withRunRepository([
        rowWithHeartbeat(attemptRow('RAG', 1, 1, 'RUNNING'), 'row-rag-1-a1', true),
        ...COMPLETED_OTHERS,
      ]),
      sandboxExecutionService: {
        execute: vi.fn().mockRejectedValue(new SandboxUnavailableError('down')),
      },
    });

    await makeHandler(deps).handle(payload, 'job-3c-3');

    const begins = beginsOf(deps).filter((begin) => begin.strategy === 'RAG' && begin.repetition === 1);
    expect(begins).toHaveLength(1);
    const requestIds = executionsOf(deps).map((execution) => execution.requestId);
    expect(requestIds.filter((id) => id === sandboxExperimentRequestId('job-3c-3', 'RAG', 1, 2))).toHaveLength(1);
    expect(requestIds).not.toContain(sandboxExperimentRequestId('job-3c-3', 'RAG', 1, 3));

    const ragOne = writesOf(deps).filter((write) => write.strategy === 'RAG' && write.repetition === 1);
    expect(ragOne).toHaveLength(1);
    expect(ragOne[0].technicallyEvaluable).toBe(false);
  });

  it('a live RUNNING attempt 1 reschedules the whole job without closing or duplicating anything (3c, iii)', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: withRunRepository([
        rowWithHeartbeat(attemptRow('RAG', 1, 1, 'RUNNING'), 'row-rag-1-a1', false),
        ...COMPLETED_OTHERS,
      ]),
    });

    const error = await makeHandler(deps).handle(payload, 'job-3c-4').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RescheduleJobError);
    expect((error as RescheduleJobError).delayMs).toBeGreaterThan(0);
    expect(repoOf(deps).closeInterruptedRepetition).not.toHaveBeenCalled();
    expect(beginsOf(deps)).toHaveLength(0);
    expect(executionsOf(deps)).toHaveLength(0);
    expect(deps.experimentRunsRepository.markStarted).not.toHaveBeenCalled();
    expect(deps.experimentRunsRepository.markFailed).not.toHaveBeenCalled();
  });

  it('a live RUNNING row in any slot blocks the closing of an expired slot elsewhere (3c, iii)', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: withRunRepository([
        rowWithHeartbeat(attemptRow('RAG', 1, 1, 'RUNNING'), 'row-rag-1-a1', true),
        rowWithHeartbeat(attemptRow('GENERALIST_AGENT', 2, 1, 'RUNNING'), 'row-agent-2-a1', false),
        attemptRow('RAG', 2, 1, 'COMPLETED'),
        attemptRow('RAG', 3, 1, 'COMPLETED'),
        attemptRow('GENERALIST_AGENT', 1, 1, 'COMPLETED'),
        attemptRow('GENERALIST_AGENT', 3, 1, 'COMPLETED'),
      ]),
    });

    await expect(makeHandler(deps).handle(payload, 'job-3c-5')).rejects.toBeInstanceOf(RescheduleJobError);
    expect(repoOf(deps).closeInterruptedRepetition).not.toHaveBeenCalled();
    expect(beginsOf(deps)).toHaveLength(0);
  });

  it('a legacy run without seed never reschedules and keeps its single attempt per slot', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: withRunRepository([
        rowWithHeartbeat(attemptRow('RAG', 1, 1, 'COMPLETED'), 'row-rag-1', false),
      ], {
        findById: vi.fn().mockResolvedValue({
          id: 'exp-1',
          status: 'PENDING',
          modelConfig: effectiveConfig,
          randomizationSeed: null,
          budget: null,
          executionProfile: null,
          runnerHint: null,
        }),
      }),
    });

    await makeHandler(deps).handle(payload, 'job-legacy');

    expect(repoOf(deps).closeInterruptedRepetition).not.toHaveBeenCalled();
    expect(beginsOf(deps)).toHaveLength(5);
    expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
  });
});

describe('ExperimentJobHandler H3 (WI-CORE-030): a closed repetition is not overwritten', () => {
  it('when another worker already closed the attempt, its result is not written and neither its trace nor the counters are touched', async () => {
    const { deps } = makeDeps();
    (deps.experimentRunsRepository.updateRepetitionById as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await makeHandler(deps).handle(payload, 'job-h3');

    expect(deps.experimentRunsRepository.updateRepetitionById).toHaveBeenCalled();
    expect(deps.contextTracesRepository.finishTrace).not.toHaveBeenCalled();
    expect(deps.contextTracesRepository.failTrace).not.toHaveBeenCalled();
    expect(deps.contextTracesRepository.finishRepetition).not.toHaveBeenCalled();
    expect(deps.experimentRunsRepository.refreshCompletedRepetitions).not.toHaveBeenCalled();
  });
});

describe('ExperimentJobHandler onExhausted (WI-CORE-030, DEC-JOBS-001)', () => {
  const LOST = 'Lock obsoleto: el worker que lo reclamó dejó de responder.';

  it('closes the orphaned RUNNING repetitions and marks the run FAILED with EXPERIMENT_WORKER_LOST, without executing anything', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: withRunRepository(
        [rowWithHeartbeat(attemptRow('RAG', 1, 1, 'RUNNING'), 'row-rag-1', true), ...COMPLETED_OTHERS],
        { findById: vi.fn().mockResolvedValue(seededRun({ status: 'RUNNING' })) },
      ),
    });

    await makeHandler(deps).onExhausted(payload, LOST);

    expect(repoOf(deps).closeInterruptedRepetition).toHaveBeenCalledTimes(1);
    expect(repoOf(deps).closeInterruptedRepetition).toHaveBeenCalledWith('row-rag-1', {
      errorSummary: expect.any(String),
      technicallyEvaluable: false,
    });
    expect(repoOf(deps).refreshCompletedRepetitions).toHaveBeenCalledWith('exp-1');
    expect(repoOf(deps).markFailed).toHaveBeenCalledWith('exp-1', 'EXPERIMENT_WORKER_LOST', LOST);
    expect(beginsOf(deps)).toHaveLength(0);
    expect(executionsOf(deps)).toHaveLength(0);
  });

  it('marks a PENDING run whose worker died before starting it FAILED with EXPERIMENT_WORKER_LOST', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: withRunRepository([], {
        findById: vi.fn().mockResolvedValue(seededRun({ status: 'PENDING' })),
      }),
    });

    await makeHandler(deps).onExhausted(payload, LOST);

    expect(repoOf(deps).markFailed).toHaveBeenCalledWith('exp-1', 'EXPERIMENT_WORKER_LOST', LOST);
    expect(repoOf(deps).closeInterruptedRepetition).not.toHaveBeenCalled();
  });

  it('keeps the real failure code of a run already FAILED by handle() (it does not overwrite EXPERIMENT_FAILED)', async () => {
    const { deps } = makeDeps({
      experimentRunsRepository: withRunRepository([...COMPLETED_OTHERS], {
        findById: vi.fn().mockResolvedValue(seededRun({ status: 'FAILED' })),
      }),
    });

    await makeHandler(deps).onExhausted(payload, LOST);

    expect(repoOf(deps).markFailed).not.toHaveBeenCalled();
    expect(repoOf(deps).closeInterruptedRepetition).not.toHaveBeenCalled();
    expect(repoOf(deps).refreshCompletedRepetitions).not.toHaveBeenCalled();
  });

  it('never touches a COMPLETED run and does nothing when the run no longer exists', async () => {
    const completed = makeDeps({
      experimentRunsRepository: withRunRepository([...COMPLETED_OTHERS], {
        findById: vi.fn().mockResolvedValue(seededRun({ status: 'COMPLETED' })),
      }),
    });
    await makeHandler(completed.deps).onExhausted(payload, LOST);
    expect(repoOf(completed.deps).markFailed).not.toHaveBeenCalled();

    const missing = makeDeps({
      experimentRunsRepository: withRunRepository([], { findById: vi.fn().mockResolvedValue(null) }),
    });
    await expect(makeHandler(missing.deps).onExhausted(payload, LOST)).resolves.toBeUndefined();
    expect(repoOf(missing.deps).markFailed).not.toHaveBeenCalled();
  });
});

describe('ExperimentJobHandler failure fact (WI-CORE-007)', () => {
  const COMPILE_FACT = {
    stage: 'COMPILING',
    category: 'COMPILATION',
    code: 'TS2304',
    message: "Cannot find name 'foo'",
  };

  function failedWith(failure: unknown, status: 'FAILED' | 'TIMED_OUT' = 'FAILED') {
    return { status, facts: null, failure, stageDurations: [] };
  }

  function updateCallsOf(deps: ReturnType<typeof makeDeps>['deps']) {
    return (
      deps.experimentRunsRepository.updateRepetitionById as ReturnType<typeof vi.fn>
    ).mock.calls as unknown[][];
  }

  it('persists the Sandbox fact in the terminal write of every repetition that reports it', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: { execute: vi.fn().mockResolvedValue(failedWith(COMPILE_FACT)) },
    });

    await makeHandler(deps).handle(payload, 'job-wf-1');

    const writes = writesOf(deps);
    expect(writes).toHaveLength(6);
    expect(writes.every((write) => write.failure !== undefined)).toBe(true);
    expect(writes[0].failure).toEqual(COMPILE_FACT);
    expect(updateCallsOf(deps).every((call) => call[2] === 'FAILED')).toBe(true);
  });

  it('keeps the fact of attempt 1 and of attempt 2 on their own rows, without merging them', async () => {
    const FIRST = {
      stage: 'RUNNING_TESTS',
      category: 'INFRASTRUCTURE',
      code: 'SANDBOX_CONTAINER_LOST',
      message: 'El contenedor se detuvo.',
    };
    const SECOND = {
      stage: 'PREPARING',
      category: 'INFRASTRUCTURE',
      code: 'SANDBOX_DOWN',
      message: 'Sandbox no responde.',
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce(failedWith(FIRST))
      .mockResolvedValueOnce(failedWith(SECOND))
      .mockResolvedValue(successfulSandboxResult());
    const { deps } = makeDeps({ configService: sequentialConfig(), sandboxExecutionService: { execute } });
    (deps.experimentRunsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(seededRun());

    await makeHandler(deps).handle(payload, 'job-wf-2');

    const [first] = pairOrder(SEED, 1);
    const [firstWrite, secondWrite] = writesOf(deps);
    expect(firstWrite).toMatchObject({ repetition: 1, strategy: first, failure: FIRST });
    expect(firstWrite).not.toHaveProperty('technicallyEvaluable');
    expect(secondWrite).toMatchObject({
      repetition: 1,
      strategy: first,
      failure: SECOND,
      technicallyEvaluable: false,
    });
  });

  it('persists the fact of a TIMED_OUT result that carries one, together with sandboxTimedOut', async () => {
    const TIMEOUT_FACT = {
      stage: 'RUNNING_TESTS',
      category: 'TEST_RUNTIME',
      code: 'TEST_TIMEOUT',
      message: 'La prueba excedió el tiempo.',
    };
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue(failedWith(TIMEOUT_FACT, 'TIMED_OUT')),
      },
    });

    await makeHandler(deps).handle(payload, 'job-wf-3');

    const writes = writesOf(deps);
    expect(writes).toHaveLength(6);
    expect(writes.every((write) => write.sandboxTimedOut === true)).toBe(true);
    expect(writes.every((write) => JSON.stringify(write.failure) === JSON.stringify(TIMEOUT_FACT))).toBe(true);
  });

  it('leaves failure absent for a TIMED_OUT result without a fact', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: { execute: vi.fn().mockResolvedValue(timedOutResult()) },
    });

    await makeHandler(deps).handle(payload, 'job-wf-4');

    const writes = writesOf(deps);
    expect(writes).toHaveLength(6);
    expect(writes.every((write) => write.sandboxTimedOut === true)).toBe(true);
    expect(writes.every((write) => !('failure' in write))).toBe(true);
  });

  it('leaves failure absent when the Sandbox client throws', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockRejectedValue(new SandboxUnavailableError('no sandbox configured')),
      },
    });

    await makeHandler(deps).handle(payload, 'job-wf-5');

    const writes = writesOf(deps);
    expect(writes).toHaveLength(6);
    expect(writes.every((write) => !('failure' in write))).toBe(true);
  });

  it('leaves failure absent for a COMPLETED result even if it carried a fact', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue({ ...successfulSandboxResult(), failure: COMPILE_FACT }),
      },
    });

    await makeHandler(deps).handle(payload, 'job-wf-6');

    const writes = writesOf(deps);
    expect(writes).toHaveLength(6);
    expect(writes.every((write) => !('failure' in write))).toBe(true);
  });

  it('persists the message redacted before truncation, never the raw secret', async () => {
    const raw = `Falló: ghp_0123456789abcdefABCDEF y password=hunter2 ${'q'.repeat(700)}`;
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue(failedWith({ ...COMPILE_FACT, message: raw })),
      },
    });

    await makeHandler(deps).handle(payload, 'job-wf-7');

    const persisted = (writesOf(deps)[0].failure as { message: string }).message;
    expect(persisted.startsWith('Falló: [REDACTED] y password=[REDACTED] ')).toBe(true);
    expect(persisted).toHaveLength(500);
    expect(persisted).not.toContain('ghp_');
    expect(persisted).not.toContain('hunter2');
  });

  it('leaves failure absent when the stage is outside the closed set', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue(failedWith({ ...COMPILE_FACT, stage: 'BOGUS' })),
      },
    });

    await makeHandler(deps).handle(payload, 'job-wf-8');

    expect(writesOf(deps).every((write) => !('failure' in write))).toBe(true);
  });

  it('leaves failure absent when the code is empty or outside the allowed shape (WI-CORE-027, DEC-EVID-004)', async () => {
    const empty = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue(failedWith({ ...COMPILE_FACT, code: '' })),
      },
    });
    await makeHandler(empty.deps).handle(payload, 'job-wf-9');
    expect(writesOf(empty.deps).every((write) => !('failure' in write))).toBe(true);

    // Antes se truncaba a 64; ahora un código de más de 64 caracteres invalida el hecho completo.
    const long = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue(failedWith({ ...COMPILE_FACT, code: 'C'.repeat(100) })),
      },
    });
    await makeHandler(long.deps).handle(payload, 'job-wf-10');
    expect(writesOf(long.deps).every((write) => !('failure' in write))).toBe(true);

    const withSpaces = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue(failedWith({ ...COMPILE_FACT, code: 'TS 2304' })),
      },
    });
    await makeHandler(withSpaces.deps).handle(payload, 'job-wf-11');
    expect(writesOf(withSpaces.deps).every((write) => !('failure' in write))).toBe(true);
  });

  it('sends the fact to the RUNNING-guarded write only, so a closed attempt is not rewritten (H3)', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: { execute: vi.fn().mockResolvedValue(failedWith(COMPILE_FACT)) },
    });
    (deps.experimentRunsRepository.updateRepetitionById as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await makeHandler(deps).handle(payload, 'job-wf-11');

    expect(writesOf(deps)[0].failure).toEqual(COMPILE_FACT);
    expect(deps.contextTracesRepository.finishTrace).not.toHaveBeenCalled();
    expect(deps.contextTracesRepository.failTrace).not.toHaveBeenCalled();
  });

  it('leaves failure absent when generation fails before the Sandbox (outer catch, regla (a))', async () => {
    const generationError = new Error('generation exploded');
    const { deps } = makeDeps({
      sandboxExecutionService: { execute: vi.fn().mockResolvedValue(failedWith(COMPILE_FACT)) },
      generalistAgentService: { generate: vi.fn().mockRejectedValue(generationError) },
      llmProvider: {
        generate: vi.fn().mockRejectedValue(generationError),
        resolveEffectiveConfig: vi.fn().mockResolvedValue(effectiveConfig),
      },
    });

    await makeHandler(deps).handle(payload, 'job-wf-12');

    const writes = writesOf(deps);
    expect(writes).toHaveLength(6);
    expect(writes.every((write) => write.failureType === 'UNKNOWN')).toBe(true);
    expect(writes.every((write) => !('failure' in write))).toBe(true);
    expect(deps.sandboxExecutionService.execute).not.toHaveBeenCalled();
  });
});

describe('ExperimentJobHandler evidence capture (WI-CORE-027, corte B)', () => {
  const COMPILE_FACT = {
    stage: 'COMPILING',
    category: 'COMPILATION',
    code: 'TS2304',
    message: "Cannot find name 'foo'",
  };
  /** Hash del contenido que mockea `applyCreate` (la prueba enviada al Sandbox). */
  const ARTIFACT_HASH = createHash('sha256').update('export function test() {}', 'utf8').digest('hex');
  const FACT_KEYS = [
    'executionProfile',
    'runner',
    'compiled',
    'executed',
    'passed',
    'totalTests',
    'passedTests',
    'failedTests',
    'skippedTests',
    'testCasesTruncated',
    'failureStage',
    'failureCategory',
    'failureCode',
    'failureMessage',
  ];

  function identified(overrides: Record<string, unknown> = {}) {
    return {
      ...successfulSandboxResult(),
      executionId: 'exec-1',
      executionProfile: 'NODE_TYPESCRIPT',
      requestId: 'req-1',
      correlationId: 'corr-1',
      durationMs: 9,
      ...overrides,
    };
  }

  it('records the sandbox identity, the 14 closed facts and the artifact hash of an executed repetition', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: { execute: vi.fn().mockResolvedValue(identified()) },
    });

    await makeHandler(deps).handle(payload, 'job-ev-1');

    const writes = writesOf(deps);
    expect(writes).toHaveLength(6);
    for (const write of writes) {
      expect(write).toMatchObject({
        sandboxExecutionId: 'exec-1',
        sandboxRequestId: 'req-1',
        sandboxCorrelationId: 'corr-1',
        artifactHash: ARTIFACT_HASH,
        sandboxFacts: {
          executionProfile: 'NODE_TYPESCRIPT',
          runner: 'VITEST',
          compiled: true,
          executed: true,
          passed: true,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0,
          testCasesTruncated: false,
          failureStage: null,
          failureCategory: null,
          failureCode: null,
          failureMessage: null,
        },
      });
      expect(Object.keys(write.sandboxFacts as object).sort()).toEqual([...FACT_KEYS].sort());
    }
  });

  it('records COMPLETED with failing tests as TEST_ASSERTION without stage, code or message, and never the test messages (DEC-EVID-006)', async () => {
    const failing = identified({
      facts: {
        runner: 'VITEST',
        compiled: true,
        executed: true,
        passed: false,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          { suitePath: null, name: 'falla', status: 'FAILED', durationMs: 1, errorMessage: 'expected 1 got 2 token=abc123' },
        ],
        testCasesTruncated: false,
      },
    });
    const { deps } = makeDeps({ sandboxExecutionService: { execute: vi.fn().mockResolvedValue(failing) } });

    await makeHandler(deps).handle(payload, 'job-ev-2');

    const writes = writesOf(deps);
    expect(writes.every((write) => write.failure === undefined)).toBe(true);
    expect(writes[0].sandboxFacts).toMatchObject({
      passed: false,
      totalTests: 2,
      failedTests: 1,
      failureCategory: 'TEST_ASSERTION',
      failureStage: null,
      failureCode: null,
      failureMessage: null,
    });
    expect(JSON.stringify(writes[0].sandboxFacts)).not.toContain('expected 1 got 2');
    expect(JSON.stringify(writes[0].sandboxFacts)).not.toContain('abc123');
    expect(Object.keys(writes[0].sandboxFacts as object)).not.toContain('testCases');
  });

  it('records the validated fact of a FAILED result in the sandbox facts, with the failure column unchanged', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue({
          ...identified(),
          status: 'FAILED',
          facts: null,
          failure: COMPILE_FACT,
        }),
      },
    });

    await makeHandler(deps).handle(payload, 'job-ev-3');

    const writes = writesOf(deps);
    expect(writes[0].failure).toEqual(COMPILE_FACT);
    expect(writes[0].sandboxFacts).toEqual({
      executionProfile: 'NODE_TYPESCRIPT',
      runner: null,
      compiled: null,
      executed: null,
      passed: null,
      totalTests: null,
      passedTests: null,
      failedTests: null,
      skippedTests: null,
      testCasesTruncated: null,
      failureStage: 'COMPILING',
      failureCategory: 'COMPILATION',
      failureCode: 'TS2304',
      failureMessage: "Cannot find name 'foo'",
    });
  });

  it('records a TIMED_OUT result without a fact as the observed identity only, with no invented category', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue({ ...identified(), status: 'TIMED_OUT', facts: null, failure: null }),
      },
    });

    await makeHandler(deps).handle(payload, 'job-ev-4');

    const writes = writesOf(deps);
    expect(writes.every((write) => write.sandboxExecutionId === 'exec-1')).toBe(true);
    expect(writes.every((write) => write.sandboxTimedOut === true)).toBe(true);
    expect(writes[0].sandboxFacts).toMatchObject({
      executionProfile: 'NODE_TYPESCRIPT',
      passed: null,
      failureCategory: null,
      failureStage: null,
      failureCode: null,
      failureMessage: null,
    });
  });

  it('records every evidence column as null when the Sandbox was never invoked', async () => {
    const generationError = new Error('generation exploded');
    const { deps } = makeDeps({
      generalistAgentService: { generate: vi.fn().mockRejectedValue(generationError) },
      llmProvider: {
        generate: vi.fn().mockRejectedValue(generationError),
        resolveEffectiveConfig: vi.fn().mockResolvedValue(effectiveConfig),
      },
    });

    await makeHandler(deps).handle(payload, 'job-ev-5');

    const writes = writesOf(deps);
    expect(writes).toHaveLength(6);
    expect(deps.sandboxExecutionService.execute).not.toHaveBeenCalled();
    for (const write of writes) {
      expect(write).toMatchObject({
        sandboxExecutionId: null,
        sandboxRequestId: null,
        sandboxCorrelationId: null,
        sandboxFacts: null,
        artifactHash: null,
      });
    }
  });

  it('keeps the identity of an accepted execution that failed afterwards and leaves the unobserved identifiers null', async () => {
    const accepted = new SandboxAcceptedExecutionError('La ejecución exec-9 no terminó.', 'exec-9', 'NODE_TYPESCRIPT');
    const { deps } = makeDeps({
      sandboxExecutionService: { execute: vi.fn().mockRejectedValue(accepted) },
    });

    await makeHandler(deps).handle(payload, 'job-ev-6');

    const writes = writesOf(deps);
    expect(writes[0]).toMatchObject({
      sandboxExecutionId: 'exec-9',
      sandboxRequestId: null,
      sandboxCorrelationId: null,
      artifactHash: ARTIFACT_HASH,
    });
    expect(writes[0].sandboxFacts).toMatchObject({ executionProfile: 'NODE_TYPESCRIPT', passed: null, failureCategory: null });
  });

  it('stores no artifact hash when the generated content is empty', async () => {
    const { deps } = makeDeps({
      llmProvider: {
        generate: vi.fn().mockResolvedValue({ content: '   ', inputTokens: 1, outputTokens: 1 }),
        resolveEffectiveConfig: vi.fn().mockResolvedValue(effectiveConfig),
      },
    });

    await makeHandler(deps).handle(payload, 'job-ev-7');

    const rag = writesOf(deps).filter((write) => write.strategy === 'RAG');
    expect(rag.length).toBeGreaterThan(0);
    expect(rag.every((write) => write.artifactHash === null)).toBe(true);
  });

  it('redacts a secret inside the failure message before it reaches the sandbox facts', async () => {
    const raw = 'Falló con token xoxb-123456789012-abcdefghijk en el paso';
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue({
          ...identified(),
          status: 'FAILED',
          facts: null,
          failure: { ...COMPILE_FACT, message: raw },
        }),
      },
    });

    await makeHandler(deps).handle(payload, 'job-ev-8');

    const facts = writesOf(deps)[0].sandboxFacts as { failureMessage: string };
    expect(facts.failureMessage).not.toContain('xoxb-');
    expect(facts.failureMessage).toContain('[REDACTED]');
    expect(JSON.stringify(writesOf(deps))).not.toContain('xoxb-123456789012');
  });

  it('keeps the repetition result when the write with evidence fails, retries without it and logs only the error name', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: { execute: vi.fn().mockResolvedValue(identified()) },
    });
    const withEvidence = new Error('connection string postgresql://user:secret@host');
    withEvidence.name = 'PrismaClientKnownRequestError';
    (deps.experimentRunsRepository.updateRepetitionById as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id: string, input: Record<string, unknown>) => {
        if ('sandboxFacts' in input) {
          throw withEvidence;
        }
        return true;
      },
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await makeHandler(deps).handle(payload, 'job-ev-9');

    const calls = (deps.experimentRunsRepository.updateRepetitionById as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(12);
    const retries = calls.filter((call) => !('sandboxFacts' in (call[1] as Record<string, unknown>)));
    expect(retries).toHaveLength(6);
    expect(retries.every((call) => call[2] === 'COMPLETED')).toBe(true);
    expect(deps.contextTracesRepository.finishTrace).toHaveBeenCalledTimes(6);
    const logged = warn.mock.calls.map((call) => String(call[0])).join(' ');
    expect(logged).toContain('PrismaClientKnownRequestError');
    expect(logged).not.toContain('secret');
    warn.mockRestore();
  });
});
