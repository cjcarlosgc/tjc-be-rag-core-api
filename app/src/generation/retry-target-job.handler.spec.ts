import { describe, expect, it, vi } from 'vitest';
import { RetryTargetJobHandler } from './retry-target-job.handler.js';
import { SandboxUnavailableError } from '../sandbox/sandbox-execution.service.js';
import { sandboxManualRetryRequestId } from '../sandbox/sandbox-request-id.util.js';

function makeTargetResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'result-1',
    testRunId: 'run-1',
    targetId: 'target-1',
    filePath: 'src/foo.ts',
    symbolName: 'foo',
    methodName: null,
    targetType: 'FUNCTION',
    testFilePath: 'src/foo.spec.ts',
    status: 'INVALID',
    compiled: true,
    executed: true,
    passed: false,
    valid: false,
    failureType: 'TEST_ASSERTION',
    errorSummary: 'expected 1 to be 2',
    createdAt: new Date(),
    ...overrides,
  };
}

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
  status: 'PARTIAL',
  totalTargets: 2,
  processedTargets: 2,
  validTargets: 1,
  invalidTargets: 1,
  failedTargets: 0,
  reason: null,
  failureCode: null,
  failureMessage: null,
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  completedAt: new Date('2026-01-01T00:05:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:05:00.000Z'),
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const cleanup = vi.fn().mockResolvedValue(undefined);

  const deps = {
    jobsService: { registerHandler: vi.fn() },
    testGenerationRunsRepository: {
      findTargetResult: vi.fn().mockResolvedValue(makeTargetResult()),
      findById: vi.fn().mockResolvedValue(baseRun),
      updateTargetResult: vi.fn(),
      applyRetryOutcome: vi.fn().mockResolvedValue({ ...baseRun, validTargets: 2, invalidTargets: 0, status: 'COMPLETED' }),
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
    artifactService: { persistRetriedArtifact: vi.fn() },
    objectStorageService: { get: vi.fn().mockResolvedValue(Buffer.from('zip')) },
    zipExtractionService: {
      extract: vi.fn().mockResolvedValue({ dir: '/tmp/workspace', cleanup }),
    },
    realtimeGateway: { emitTestRunUpdate: vi.fn() },
    llmProvider: { generate: vi.fn().mockResolvedValue({ content: 'fixed test code', inputTokens: 10, outputTokens: 5 }) },
    ...overrides,
  };

  return { deps, cleanup };
}

function makeHandler(deps: ReturnType<typeof makeDeps>['deps']): RetryTargetJobHandler {
  return new RetryTargetJobHandler(
    deps.jobsService as never,
    deps.testGenerationRunsRepository as never,
    deps.projectVersionsRepository as never,
    deps.testTargetsRepository as never,
    deps.retrievalService as never,
    deps.contextBuilder as never,
    deps.promptBuilder as never,
    deps.testFileMergeService as never,
    deps.sandboxExecutionService as never,
    deps.artifactService as never,
    deps.objectStorageService as never,
    deps.zipExtractionService as never,
    deps.realtimeGateway as never,
    deps.llmProvider as never,
  );
}

const payload = { testRunId: 'run-1', targetId: 'target-1' };

describe('RetryTargetJobHandler', () => {
  it('registers itself with the jobs service', () => {
    const { deps } = makeDeps();
    const handler = makeHandler(deps);

    handler.onModuleInit();

    expect(deps.jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('is a no-op when the target result no longer exists', async () => {
    const { deps } = makeDeps({
      testGenerationRunsRepository: { findTargetResult: vi.fn().mockResolvedValue(null) },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect((deps.projectVersionsRepository as { findById: ReturnType<typeof vi.fn> }).findById).not.toHaveBeenCalled();
  });

  it('is a no-op when the target result is not INVALID/FAILED (already retried or VALID)', async () => {
    const { deps } = makeDeps({
      testGenerationRunsRepository: {
        findTargetResult: vi.fn().mockResolvedValue(makeTargetResult({ status: 'VALID' })),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.llmProvider.generate).not.toHaveBeenCalled();
  });

  it('retries an INVALID target end-to-end and records VALID, adjusting the run counters', async () => {
    const { deps, cleanup } = makeDeps();
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.retrievalService.retrieve).toHaveBeenCalledWith('version-1', expect.objectContaining({ filePath: 'src/foo.ts' }));
    expect(deps.llmProvider.generate).toHaveBeenCalledWith('prompt');
    expect(deps.sandboxExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: sandboxManualRetryRequestId('job-1', 'target-1'),
        testRunId: 'run-1',
        scope: 'TARGET',
        targetIds: ['target-1'],
        runnerHint: 'VITEST',
      }),
    );
    expect(deps.testGenerationRunsRepository.updateTargetResult).toHaveBeenCalledWith(
      'result-1',
      expect.objectContaining({ status: 'VALID', valid: true, testFilePath: 'src/foo.spec.ts' }),
    );
    expect(deps.testGenerationRunsRepository.applyRetryOutcome).toHaveBeenCalledWith('run-1', 'INVALID', 'VALID');
    expect(deps.artifactService.persistRetriedArtifact).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ relativePath: 'src/foo.spec.ts' }),
    );
    expect(deps.realtimeGateway.emitTestRunUpdate).toHaveBeenCalledWith('run-1', expect.objectContaining({ id: 'run-1' }));
    expect(cleanup).toHaveBeenCalled();
  });

  it('records FAILED/INFRASTRUCTURE and still adjusts counters when the Sandbox is unavailable', async () => {
    const { deps, cleanup } = makeDeps({
      sandboxExecutionService: {
        execute: vi.fn().mockRejectedValue(new SandboxUnavailableError('no sandbox configured')),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.testGenerationRunsRepository.updateTargetResult).toHaveBeenCalledWith(
      'result-1',
      expect.objectContaining({ status: 'FAILED', failureType: 'INFRASTRUCTURE', errorSummary: 'no sandbox configured' }),
    );
    expect(deps.testGenerationRunsRepository.applyRetryOutcome).toHaveBeenCalledWith('run-1', 'INVALID', 'FAILED');
    expect(cleanup).toHaveBeenCalled();
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
    expect(deps.testGenerationRunsRepository.updateTargetResult).toHaveBeenCalledWith(
      'result-1',
      expect.objectContaining({ status: 'FAILED', failureType: 'CONFIGURATION' }),
    );
    expect(deps.testGenerationRunsRepository.applyRetryOutcome).toHaveBeenCalledWith('run-1', 'INVALID', 'FAILED');
  });

  it('retries a previously FAILED target and keeps it FAILED, passing the correct previousStatus', async () => {
    const { deps } = makeDeps({
      testGenerationRunsRepository: {
        findTargetResult: vi.fn().mockResolvedValue(makeTargetResult({ status: 'FAILED', failureType: 'INFRASTRUCTURE' })),
        findById: vi.fn().mockResolvedValue(baseRun),
        updateTargetResult: vi.fn(),
        applyRetryOutcome: vi.fn().mockResolvedValue(baseRun),
      },
      sandboxExecutionService: {
        execute: vi.fn().mockRejectedValue(new SandboxUnavailableError('still down')),
      },
    });
    const handler = makeHandler(deps);

    await handler.handle(payload, 'job-1');

    expect(deps.testGenerationRunsRepository.applyRetryOutcome).toHaveBeenCalledWith('run-1', 'FAILED', 'FAILED');
  });
});
