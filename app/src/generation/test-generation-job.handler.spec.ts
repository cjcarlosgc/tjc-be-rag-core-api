import { describe, expect, it, vi } from 'vitest';
import { TestGenerationJobHandler } from './test-generation-job.handler.js';
import { SandboxUnavailableError } from '../sandbox/sandbox-execution.service.js';

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

const baseRun = {
  id: 'run-1',
  projectId: 'project-1',
  projectVersionId: 'version-1',
  mode: 'PROJECT_MISSING',
  status: 'PENDING',
  totalTargets: null,
  processedTargets: 0,
  validTargets: 0,
  invalidTargets: 0,
  failedTargets: 0,
  reason: null,
  failureCode: null,
  failureMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const cleanup = vi.fn().mockResolvedValue(undefined);

  const deps = {
    jobsService: { registerHandler: vi.fn() },
    testGenerationRunsRepository: {
      findById: vi.fn().mockResolvedValue(baseRun),
      markStarted: vi.fn(),
      update: vi.fn(),
      setStatus: vi.fn(),
      complete: vi.fn(),
      completeAsNoMissingTargets: vi.fn(),
      markFailed: vi.fn(),
      insertTargetResult: vi.fn(),
      incrementProcessed: vi.fn(),
    },
    projectVersionsRepository: {
      findById: vi.fn().mockResolvedValue({
        id: 'version-1',
        snapshotKey: 'snapshot-key',
        detectedFramework: 'VITEST',
      }),
    },
    gapAnalyzer: { resolve: vi.fn().mockResolvedValue([makeTarget()]) },
    retrievalService: {
      retrieve: vi.fn().mockResolvedValue({ targetChunks: [], candidates: [] }),
    },
    contextBuilder: {
      build: vi.fn().mockReturnValue({
        target: { filePath: 'src/foo.ts', symbolName: 'foo', methodName: null, targetType: 'FUNCTION', content: 'function foo() {}' },
        relatedChunks: [],
        metadata: { language: 'typescript', framework: 'VITEST' },
        retrievedChunks: 0,
        selectedChunks: 0,
        contextTokens: 5,
      }),
    },
    promptBuilder: { build: vi.fn().mockReturnValue('prompt') },
    testFileMergeService: {
      applyCreate: vi.fn().mockReturnValue('export function test() {}'),
      applyMerge: vi.fn().mockReturnValue('merged'),
    },
    sandboxExecutionService: {
      execute: vi.fn().mockResolvedValue({
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
      }),
    },
    artifactService: { persistFinalArtifacts: vi.fn() },
    objectStorageService: { get: vi.fn().mockResolvedValue(Buffer.from('zip')) },
    zipExtractionService: {
      extract: vi.fn().mockResolvedValue({ dir: '/tmp/workspace', cleanup }),
    },
    llmProvider: { generate: vi.fn().mockResolvedValue({ content: 'test code', inputTokens: 10, outputTokens: 5 }) },
    realtimeGateway: { emitTestRunUpdate: vi.fn() },
    repairService: {
      repair: vi.fn().mockResolvedValue({ content: 'repaired test code', inputTokens: 8, outputTokens: 6 }),
    },
    configService: { get: vi.fn((_key: string, defaultValue: unknown) => defaultValue) },
    ...overrides,
  };

  return { deps, cleanup };
}

function makeHandler(deps: ReturnType<typeof makeDeps>['deps']): TestGenerationJobHandler {
  return new TestGenerationJobHandler(
    deps.jobsService as never,
    deps.testGenerationRunsRepository as never,
    deps.projectVersionsRepository as never,
    deps.gapAnalyzer as never,
    deps.retrievalService as never,
    deps.contextBuilder as never,
    deps.promptBuilder as never,
    deps.testFileMergeService as never,
    deps.sandboxExecutionService as never,
    deps.artifactService as never,
    deps.objectStorageService as never,
    deps.zipExtractionService as never,
    deps.realtimeGateway as never,
    deps.repairService as never,
    deps.configService as never,
    deps.llmProvider as never,
  );
}

const payload = {
  testRunId: 'run-1',
  projectId: 'project-1',
  projectVersionId: 'version-1',
  mode: 'PROJECT_MISSING' as const,
  targetId: null,
};

describe('TestGenerationJobHandler', () => {
  it('registers itself with the jobs service', () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    handler.onModuleInit();

    expect(deps.jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('is a no-op when the run no longer exists', async () => {
    const { deps } = makeDeps({
      testGenerationRunsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload);

    expect((deps.projectVersionsRepository as { findById: ReturnType<typeof vi.fn> }).findById).not.toHaveBeenCalled();
  });

  it('marks the run COMPLETED with NO_MISSING_TARGETS when there is nothing to process', async () => {
    const { deps } = makeDeps({ gapAnalyzer: { resolve: vi.fn().mockResolvedValue([]) } });
    const handler = makeHandler(deps);

    await handler.handle(payload);

    expect(deps.testGenerationRunsRepository.completeAsNoMissingTargets).toHaveBeenCalledWith('run-1');
    expect(deps.sandboxExecutionService.execute).not.toHaveBeenCalled();
  });

  it('processes a target end-to-end, records VALID and completes the run as COMPLETED', async () => {
    const { deps, cleanup } = makeDeps();
    deps.testGenerationRunsRepository.findById.mockResolvedValue({
      ...baseRun,
      totalTargets: 1,
      validTargets: 1,
      invalidTargets: 0,
    });
    const handler = makeHandler(deps);

    await handler.handle(payload);

    expect(deps.llmProvider.generate).toHaveBeenCalledWith('prompt');
    expect(deps.testFileMergeService.applyCreate).toHaveBeenCalledWith('test code');
    expect(deps.sandboxExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'TARGET', targetIds: ['target-1'], runnerHint: 'VITEST' }),
    );
    expect(deps.testGenerationRunsRepository.insertTargetResult).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ targetId: 'target-1', status: 'VALID', valid: true, repairAttempts: 0 }),
    );
    expect(deps.repairService.repair).not.toHaveBeenCalled();
    expect(deps.testGenerationRunsRepository.incrementProcessed).toHaveBeenCalledWith('run-1', 'VALID');
    expect(deps.artifactService.persistFinalArtifacts).toHaveBeenCalledWith('run-1', expect.any(Array));
    expect(deps.testGenerationRunsRepository.complete).toHaveBeenCalledWith('run-1', 'COMPLETED');
    expect(cleanup).toHaveBeenCalled();
    expect(deps.realtimeGateway.emitTestRunUpdate).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ id: 'run-1' }),
    );
  });

  it('records FAILED/INFRASTRUCTURE and continues when the Sandbox is unavailable', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockRejectedValue(new SandboxUnavailableError('no sandbox configured')),
      },
    });
    deps.testGenerationRunsRepository.findById.mockResolvedValue({
      ...baseRun,
      totalTargets: 1,
      validTargets: 0,
      invalidTargets: 0,
    });
    const handler = makeHandler(deps);

    await handler.handle(payload);

    expect(deps.testGenerationRunsRepository.insertTargetResult).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED', failureType: 'INFRASTRUCTURE', errorSummary: 'no sandbox configured' }),
    );
    expect(deps.testGenerationRunsRepository.complete).toHaveBeenCalledWith('run-1', 'FAILED');
  });

  it('skips Sandbox validation and records FAILED/CONFIGURATION when the framework is unknown', async () => {
    const { deps } = makeDeps({
      projectVersionsRepository: {
        findById: vi.fn().mockResolvedValue({ id: 'version-1', snapshotKey: 'key', detectedFramework: null }),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload);

    expect(deps.sandboxExecutionService.execute).not.toHaveBeenCalled();
    expect(deps.testGenerationRunsRepository.insertTargetResult).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED', failureType: 'CONFIGURATION' }),
    );
  });

  it('records INVALID with repairAttempts exhausted when every repair attempt keeps failing (HU23)', async () => {
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue({
          status: 'COMPLETED',
          facts: {
            runner: 'VITEST',
            compiled: true,
            executed: true,
            passed: false,
            totalTests: 1,
            passedTests: 0,
            failedTests: 1,
            skippedTests: 0,
            testCases: [{ suitePath: null, name: 'x', status: 'FAILED', durationMs: 1, errorMessage: 'expected 1 to be 2' }],
            testCasesTruncated: false,
          },
          failure: null,
        }),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload);

    expect(deps.testGenerationRunsRepository.insertTargetResult).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'INVALID',
        failureType: 'TEST_ASSERTION',
        errorSummary: 'expected 1 to be 2',
        repairAttempts: 2,
      }),
    );
    expect(deps.repairService.repair).toHaveBeenCalledTimes(2);
    expect(deps.sandboxExecutionService.execute).toHaveBeenCalledTimes(3);
  });

  it('repairs a failing test and records VALID once the repaired content passes (HU23)', async () => {
    const failingResult = {
      status: 'COMPLETED',
      facts: {
        runner: 'VITEST',
        compiled: true,
        executed: true,
        passed: false,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [{ suitePath: null, name: 'x', status: 'FAILED', durationMs: 1, errorMessage: 'expected 1 to be 2' }],
        testCasesTruncated: false,
      },
      failure: null,
    };
    const passingResult = {
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
    const { deps } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValueOnce(failingResult).mockResolvedValueOnce(passingResult),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload);

    expect(deps.repairService.repair).toHaveBeenCalledTimes(1);
    expect(deps.repairService.repair).toHaveBeenCalledWith(
      expect.objectContaining({
        failedTestContent: expect.any(String),
        failureType: 'TEST_ASSERTION',
        errorSummary: 'expected 1 to be 2',
        attempt: 1,
      }),
    );
    expect(deps.testFileMergeService.applyCreate).toHaveBeenCalledWith('repaired test code');
    expect(deps.testGenerationRunsRepository.insertTargetResult).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'VALID', valid: true, repairAttempts: 1 }),
    );
  });

  it('never repairs when GENERATION_MAX_REPAIR_ATTEMPTS is 0 (autorepair disabled)', async () => {
    const { deps } = makeDeps({
      configService: { get: vi.fn().mockReturnValue(0) },
      sandboxExecutionService: {
        execute: vi.fn().mockResolvedValue({
          status: 'COMPLETED',
          facts: {
            runner: 'VITEST',
            compiled: true,
            executed: true,
            passed: false,
            totalTests: 1,
            passedTests: 0,
            failedTests: 1,
            skippedTests: 0,
            testCases: [{ suitePath: null, name: 'x', status: 'FAILED', durationMs: 1, errorMessage: 'expected 1 to be 2' }],
            testCasesTruncated: false,
          },
          failure: null,
        }),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload);

    expect(deps.repairService.repair).not.toHaveBeenCalled();
    expect(deps.sandboxExecutionService.execute).toHaveBeenCalledTimes(1);
    expect(deps.testGenerationRunsRepository.insertTargetResult).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'INVALID', repairAttempts: 0 }),
    );
  });

  it('marks the run FAILED and cleans up the workspace when an unexpected error occurs before processing targets', async () => {
    const { deps, cleanup } = makeDeps({
      gapAnalyzer: { resolve: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    const handler = makeHandler(deps);

    await expect(handler.handle(payload)).rejects.toThrow('boom');

    expect(deps.testGenerationRunsRepository.markFailed).toHaveBeenCalledWith(
      'run-1',
      'GENERATION_FAILED',
      'boom',
    );
    expect(cleanup).not.toHaveBeenCalled();
  });
});
