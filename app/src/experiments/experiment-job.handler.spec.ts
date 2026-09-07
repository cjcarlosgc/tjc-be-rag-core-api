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

function makeDeps(overrides: Record<string, unknown> = {}) {
  const cleanup = vi.fn().mockResolvedValue(undefined);

  const deps = {
    jobsService: { registerHandler: vi.fn() },
    experimentRunsRepository: {
      findById: vi.fn().mockResolvedValue({ id: 'exp-1', status: 'PENDING' }),
      markStarted: vi.fn(),
      complete: vi.fn(),
      markFailed: vi.fn(),
      insertRepetition: vi.fn(),
      incrementCompletedRepetitions: vi.fn(),
    },
    projectVersionsRepository: {
      findById: vi.fn().mockResolvedValue({
        id: 'version-1',
        snapshotKey: 'snapshot-key',
        detectedFramework: 'VITEST',
      }),
    },
    testTargetsRepository: { findById: vi.fn().mockResolvedValue(makeTarget()) },
    retrievalService: { retrieve: vi.fn().mockResolvedValue({ targetChunks: [], candidates: [] }) },
    contextBuilder: {
      build: vi.fn().mockReturnValue({
        target: { filePath: 'src/foo.ts', symbolName: 'foo', methodName: null, targetType: 'FUNCTION', content: 'x' },
        relatedChunks: [],
        metadata: { language: 'typescript', framework: 'VITEST' },
        retrievedChunks: 4,
        selectedChunks: 2,
        contextTokens: 123,
      }),
    },
    promptBuilder: { build: vi.fn().mockReturnValue('prompt') },
    generalistAgentService: {
      generate: vi.fn().mockResolvedValue({
        content: 'agent generated test',
        trajectory: [{ toolName: 'list_files', arguments: {}, result: 'src/foo.ts' }],
        toolCallCount: 1,
        filesInspected: 1,
        inputTokens: 40,
        outputTokens: 15,
      }),
    },
    fileDiscoveryService: { discover: vi.fn().mockResolvedValue(['src/foo.ts']) },
    testFileMergeService: {
      applyCreate: vi.fn().mockReturnValue('export function test() {}'),
      applyMerge: vi.fn().mockReturnValue('merged'),
    },
    sandboxExecutionService: { execute: vi.fn().mockResolvedValue(successfulSandboxResult()) },
    objectStorageService: { get: vi.fn().mockResolvedValue(Buffer.from('zip')) },
    zipExtractionService: {
      extract: vi.fn().mockResolvedValue({ dir: '/tmp/workspace-does-not-exist', cleanup }),
    },
    configService: {
      get: (key: string, fallback?: unknown) => fallback,
    },
    llmProvider: {
      generate: vi.fn().mockResolvedValue({ content: 'rag generated test', inputTokens: 100, outputTokens: 30 }),
    },
    ...overrides,
  };

  return { deps, cleanup };
}

function makeHandler(deps: ReturnType<typeof makeDeps>['deps']): ExperimentJobHandler {
  return new ExperimentJobHandler(
    deps.jobsService as never,
    deps.experimentRunsRepository as never,
    deps.projectVersionsRepository as never,
    deps.testTargetsRepository as never,
    deps.retrievalService as never,
    deps.contextBuilder as never,
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

    expect((deps.projectVersionsRepository as { findById: ReturnType<typeof vi.fn> }).findById).not.toHaveBeenCalled();
  });

  it('runs 3 repetitions per strategy (6 total), using RAG and the agent for their respective arms', async () => {
    const { deps, cleanup } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.llmProvider.generate).toHaveBeenCalledTimes(3);
    expect(deps.generalistAgentService.generate).toHaveBeenCalledTimes(3);
    expect(deps.sandboxExecutionService.execute).toHaveBeenCalledTimes(6);
    expect(deps.experimentRunsRepository.insertRepetition).toHaveBeenCalledTimes(6);
    expect(deps.experimentRunsRepository.incrementCompletedRepetitions).toHaveBeenCalledTimes(6);
    expect(cleanup).toHaveBeenCalledTimes(6);
    expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
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
    expect(requestIds).toContain(sandboxExperimentRequestId('job-1', 'GENERALIST_AGENT', 1));
    expect(new Set(requestIds).size).toBe(6);
  });

  it('records RAG-specific metrics (retrievedChunks/selectedChunks/contextTokens) and null agent metrics for the RAG arm', async () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const ragCall = deps.experimentRunsRepository.insertRepetition.mock.calls.find(
      (call: unknown[]) => (call[1] as { strategy: string }).strategy === 'RAG',
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

  it('records agent-specific metrics (toolCalls/filesInspected/trajectory) and null RAG metrics for the GENERALIST_AGENT arm', async () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    const agentCall = deps.experimentRunsRepository.insertRepetition.mock.calls.find(
      (call: unknown[]) => (call[1] as { strategy: string }).strategy === 'GENERALIST_AGENT',
    );

    expect(agentCall?.[1]).toMatchObject({
      retrievedChunks: null,
      selectedChunks: null,
      contextTokens: null,
      toolCalls: 1,
      filesInspected: 1,
      trajectory: [{ toolName: 'list_files', arguments: {}, result: 'src/foo.ts' }],
    });
  });

  it('records FAILED/INFRASTRUCTURE for a repetition when the Sandbox is unavailable, without stopping the other repetitions', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockRejectedValue(new SandboxUnavailableError('no sandbox configured')),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.experimentRunsRepository.insertRepetition).toHaveBeenCalledTimes(6);
    const anyCall = deps.experimentRunsRepository.insertRepetition.mock.calls[0];
    expect(anyCall[1]).toMatchObject({ valid: false, failureType: 'INFRASTRUCTURE' });
    expect(deps.experimentRunsRepository.complete).toHaveBeenCalledWith('exp-1');
  });

  it('records FAILED/CONFIGURATION without calling the Sandbox when the framework is unknown', async () => {
    const { deps } = makeDeps({
      projectVersionsRepository: {
        findById: vi.fn().mockResolvedValue({ id: 'version-1', snapshotKey: 'key', detectedFramework: null }),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.sandboxExecutionService.execute).not.toHaveBeenCalled();
    expect(deps.experimentRunsRepository.insertRepetition).toHaveBeenCalledTimes(6);
    expect(deps.experimentRunsRepository.insertRepetition.mock.calls[0][1]).toMatchObject({
      failureType: 'CONFIGURATION',
    });
  });

  it('marks the experiment FAILED when the target cannot be resolved before any repetition runs', async () => {
    const { deps } = makeDeps({
      testTargetsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });
    const handler = makeHandler(deps);

    await expect(handler.handle(payload, 'job-1')).rejects.toThrow('No existe el target');

    expect(deps.experimentRunsRepository.markFailed).toHaveBeenCalledWith(
      'exp-1',
      'EXPERIMENT_FAILED',
      expect.stringContaining('No existe el target'),
    );
    expect(deps.sandboxExecutionService.execute).not.toHaveBeenCalled();
  });
});
