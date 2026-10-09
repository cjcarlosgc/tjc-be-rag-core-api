import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { PromptBuilder } from '../generation/prompt-builder.service.js';
import { describe, expect, it, vi } from 'vitest';
import { ExperimentJobHandler } from './experiment-job.handler.js';
import { SandboxUnavailableError } from '../sandbox/sandbox-execution.service.js';
import { sandboxExperimentRequestId } from '../sandbox/sandbox-request-id.util.js';

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
      updateRepetitionById: vi.fn(),
      refreshCompletedRepetitions: vi.fn(),
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
                metadata: { language: 'typescript', framework: 'VITEST' },
                retrievedChunks: 0,
                selectedChunks: 0,
                contextTokens: 0,
                audit: {
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
              metadata: { language: 'typescript', framework: 'VITEST' },
              retrievedChunks: 4,
              selectedChunks: 2,
              contextTokens: 123,
              audit: {
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
    const handler = makeHandler(deps);

    await expect(handler.handle(payload, 'job-1')).rejects.toThrow(
      'complete failed',
    );
    expect(completedRepetitions).toBe(6);

    await handler.handle(payload, 'job-2');

    expect(deps.contextTracesRepository.beginAttempt).toHaveBeenCalledTimes(12);
    expect(
      deps.experimentRunsRepository.refreshCompletedRepetitions,
    ).toHaveBeenCalledTimes(12);
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
      metadata: { language: 'typescript', framework: 'VITEST' },
      retrievedChunks: 4,
      selectedChunks: 1,
      contextTokens: 30,
      audit: {
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
    };

    expect(agentDetails.length).toBeGreaterThan(1);
    expect(finalDetail).toMatchObject({ toolCalls: 2, filesInspected: 1 });
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

    expect(
      deps.experimentRunsRepository.updateRepetitionById,
    ).toHaveBeenCalledTimes(6);
    const anyCall =
      deps.experimentRunsRepository.updateRepetitionById.mock.calls[0];
    expect(anyCall[1]).toMatchObject({
      valid: false,
      failureType: 'INFRASTRUCTURE',
    });
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

  it('keeps functional rules out of the persisted RAG trace and includes them only in the prompt', async () => {
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
    for (const call of deps.contextTracesRepository.updateDetail.mock.calls) {
      const serialized = JSON.stringify(call[1]);
      expect(serialized).not.toContain(ruleText);
      expect(serialized).not.toContain('functionalRules');
    }
  });
});
