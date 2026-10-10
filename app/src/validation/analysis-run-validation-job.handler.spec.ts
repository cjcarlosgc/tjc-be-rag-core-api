import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunValidationJobHandler } from './analysis-run-validation-job.handler.js';
import { SandboxAcceptedExecutionError, SandboxUnavailableError } from '../sandbox/sandbox-execution.service.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { PromptBuilder } from '../generation/prompt-builder.service.js';
import { countFunctionalRuleTokens } from '../retrieval/functional-rule-format.js';
import type {
  AnalysisRun,
  AnalysisSymbol,
  ProjectVersion,
  RepositoryBinding,
  TestTarget,
} from '../generated/prisma/client.js';

function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryId: '123',
    repositoryName: 'org/repo',
    prNumber: 42,
    headSha: 'head-sha',
    status: 'PROCESSING',
    projectVersionId: 'version-1',
    attemptCount: 0,
    ...overrides,
  } as AnalysisRun;
}

const binding: RepositoryBinding = {
  id: 'binding-1',
  projectId: 'project-1',
  installationId: '999',
  repositoryId: '123',
  repositoryName: 'org/repo',
  integrationBranch: 'develop',
  status: 'ENABLED',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildSymbol(overrides: Partial<AnalysisSymbol> = {}): AnalysisSymbol {
  return {
    id: 'symbol-1',
    analysisRunId: 'run-1',
    language: 'TYPESCRIPT',
    kind: 'METHOD',
    qualifiedName: 'Thing.doIt',
    filePath: 'src/thing.ts',
    changeKind: 'DIRECTLY_CHANGED',
    behaviorConstructs: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function buildVersion(overrides: Partial<ProjectVersion> = {}): ProjectVersion {
  return { id: 'version-1', detectedFramework: 'JEST', ...overrides } as ProjectVersion;
}

/** `GenerationContext` mínimo con la auditoría que `ContextBuilder` produce (WI-CORE-026). */
function buildGenerationContext(overrides: Record<string, unknown> = {}) {
  return {
    target: { filePath: 'src/thing.ts', symbolName: 'Thing', methodName: 'doIt', targetType: 'METHOD', content: 'doIt() {}' },
    relatedChunks: [],
    functionalRules: [],
    metadata: { language: 'typescript', framework: 'JEST' },
    retrievedChunks: 0,
    selectedChunks: 0,
    contextTokens: 0,
    audit: {
      functionalRules: { retrieved: 0, selected: 0, tokenCount: 0, omitted: [] },
      target: { chunkIds: [], chunks: [], tokenCount: 0 },
      candidates: [],
      configuration: { minimumScore: 0, topK: 10, maxContextTokens: 1000, semanticWeight: 0.7, structuralWeight: 0.3 },
    },
    ...overrides,
  };
}

function sandboxResult(
  overrides: Partial<{ status: string; facts: unknown; failure: unknown; executionId: string; executionProfile: string; durationMs: number }> = {},
) {
  return {
    status: 'COMPLETED',
    facts: { runner: 'JEST', compiled: true, executed: true, passed: true, totalTests: 1, passedTests: 1, failedTests: 0, skippedTests: 0, testCases: [], testCasesTruncated: false },
    failure: null,
    stageDurations: [],
    executionId: 'exec-1',
    executionProfile: 'NODE_TYPESCRIPT',
    requestId: 'request-1',
    correlationId: 'correlation-1',
    durationMs: 7,
    ...overrides,
  };
}

/** `sandboxFacts` de una ejecución COMPLETED y aprobada: solo conteos y banderas, sin testCases. */
const PASSED_FACTS = {
  executionProfile: 'NODE_TYPESCRIPT',
  runner: 'JEST',
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
};

/** `sandboxFacts` de una ejecución aceptada sin resultado: solo el perfil es observado. */
const NOT_OBSERVED_FACTS = {
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
  failureStage: null,
  failureCategory: null,
  failureCode: null,
  failureMessage: null,
};

describe('AnalysisRunValidationJobHandler', () => {
  let createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs = [];
  });

  async function setup() {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'rag-core-validation-test-'));
    createdDirs.push(workspaceDir);

    const jobsService = { registerHandler: vi.fn() };
    const analysisRunsRepository = { findById: vi.fn() };
    const analysisRunsService = {
      completeRunFromSystem: vi.fn().mockImplementation(async (run: AnalysisRun, status: string, patch: object) => ({
        ...run,
        status,
        ...patch,
      })),
    };
    const analysisSymbolsRepository = { findByAnalysisRun: vi.fn().mockResolvedValue([buildSymbol()]) };
    const repositoryBindingsRepository = { findForRun: vi.fn().mockResolvedValue(binding) };
    const projectVersionsRepository = { findById: vi.fn().mockResolvedValue(buildVersion()) };
    const testTargetsRepository = { findByProjectVersion: vi.fn().mockResolvedValue([] as TestTarget[]) };
    const workspaceCleanup = vi.fn().mockResolvedValue(undefined);
    const githubSnapshotMaterializerService = {
      materialize: vi.fn().mockResolvedValue({ dir: workspaceDir, cleanup: workspaceCleanup }),
    };
    const retrievalService = { retrieve: vi.fn().mockResolvedValue({ targetChunks: [], candidates: [] }) };
    const contextBuilder = { build: vi.fn().mockReturnValue(buildGenerationContext()) };
    const functionalRulesRetriever = { retrieve: vi.fn().mockResolvedValue([]) };
    const promptBuilder = { build: vi.fn().mockReturnValue('prompt') };
    const testFileMergeService = {
      applyCreate: vi.fn((content: string) => `created:${content}`),
      applyMerge: vi.fn((existing: string, content: string) => `merged:${existing}:${content}`),
    };
    const sandboxExecutionService = { execute: vi.fn().mockResolvedValue(sandboxResult()) };
    const objectStorageService = { put: vi.fn().mockResolvedValue(undefined) };
    const generatedTestProposalsRepository = { upsertForSymbol: vi.fn().mockResolvedValue({ id: 'proposal-1' }) };
    const analysisTraceRepository = {
      upsertRetrieval: vi.fn().mockResolvedValue({ id: 'retrieval-1' }),
      upsertContext: vi.fn().mockResolvedValue({ id: 'context-1' }),
      upsertExecution: vi.fn().mockResolvedValue({ id: 'execution-1' }),
    };
    const llmProvider = { generate: vi.fn().mockResolvedValue({ content: 'test content', inputTokens: 10, outputTokens: 20 }) };
    const analysisRunChecksService = { publishForRun: vi.fn().mockResolvedValue(undefined) };

    const handler = new AnalysisRunValidationJobHandler(
      jobsService as never,
      analysisRunsRepository as never,
      analysisRunsService as never,
      analysisSymbolsRepository as never,
      repositoryBindingsRepository as never,
      projectVersionsRepository as never,
      testTargetsRepository as never,
      githubSnapshotMaterializerService as never,
      retrievalService as never,
      contextBuilder as never,
      functionalRulesRetriever as never,
      promptBuilder as never,
      testFileMergeService as never,
      sandboxExecutionService as never,
      objectStorageService as never,
      generatedTestProposalsRepository as never,
      analysisRunChecksService as never,
      llmProvider as never,
      analysisTraceRepository as never,
    );

    analysisRunsRepository.findById.mockResolvedValue(buildRun());

    return {
      handler,
      jobsService,
      analysisRunsRepository,
      analysisRunsService,
      analysisSymbolsRepository,
      repositoryBindingsRepository,
      projectVersionsRepository,
      testTargetsRepository,
      githubSnapshotMaterializerService,
      retrievalService,
      contextBuilder,
      functionalRulesRetriever,
      promptBuilder,
      testFileMergeService,
      sandboxExecutionService,
      objectStorageService,
      generatedTestProposalsRepository,
      llmProvider,
      analysisRunChecksService,
      analysisTraceRepository,
      workspaceCleanup,
    };
  }

  it('registers itself as a job handler on module init', async () => {
    const { handler, jobsService } = await setup();
    handler.onModuleInit();
    expect(jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('is a no-op when the run does not exist', async () => {
    const { handler, analysisRunsRepository, repositoryBindingsRepository } = await setup();
    analysisRunsRepository.findById.mockResolvedValue(null);

    await handler.handle({ analysisRunId: 'missing' }, 'job-1');

    expect(repositoryBindingsRepository.findForRun).not.toHaveBeenCalled();
  });

  it('does not send PHP snapshots to the TypeScript generation/Sandbox flow before WI-CORE-013', async () => {
    const context = await setup();
    context.projectVersionsRepository.findById.mockResolvedValue(
      buildVersion({ language: 'PHP', detectedFramework: 'PHPUNIT' }),
    );

    await context.handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(context.analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1' }),
      'TECHNICAL_GENERATION_FAILURE',
      expect.objectContaining({ resultSummary: expect.stringContaining('WI-CORE-013') }),
    );
    expect(context.githubSnapshotMaterializerService.materialize).not.toHaveBeenCalled();
    expect(context.sandboxExecutionService.execute).not.toHaveBeenCalled();
  });

  it('is a no-op when the run is not PROCESSING', async () => {
    const { handler, analysisRunsRepository, repositoryBindingsRepository } = await setup();
    analysisRunsRepository.findById.mockResolvedValue(buildRun({ status: 'SUCCESS' }));

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(repositoryBindingsRepository.findForRun).not.toHaveBeenCalled();
  });

  it('completes as INFRASTRUCTURE_FAILURE when the repository binding no longer exists', async () => {
    const { handler, repositoryBindingsRepository, analysisRunsService } = await setup();
    repositoryBindingsRepository.findForRun.mockResolvedValue(null);

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1' }),
      'INFRASTRUCTURE_FAILURE',
      expect.objectContaining({ resultSummary: expect.any(String) }),
    );
  });

  it('uploads the zipped snapshot under analysis-runs/{id}/snapshot.zip', async () => {
    const { handler, objectStorageService } = await setup();

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(objectStorageService.put).toHaveBeenCalledWith(
      'analysis-runs/run-1/snapshot.zip',
      expect.any(Buffer),
      'application/zip',
    );
  });

  it('skips a symbol that already has an existing test and completes NO_ADDITIONAL_TESTS_REQUIRED', async () => {
    const { handler, testTargetsRepository, retrievalService, analysisRunsService } = await setup();
    testTargetsRepository.findByProjectVersion.mockResolvedValue([
      {
        id: 'target-1',
        projectVersionId: 'version-1',
        filePath: 'src/thing.ts',
        symbolName: 'Thing',
        methodName: 'doIt',
        targetType: 'METHOD',
        hasTest: true,
        testFilePaths: ['src/thing.spec.ts'],
      } as TestTarget,
    ]);

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(retrievalService.retrieve).not.toHaveBeenCalled();
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1' }),
      'NO_ADDITIONAL_TESTS_REQUIRED',
      expect.objectContaining({ generatedTestsCount: 0, functionalBehaviorValidated: true }),
    );
  });

  it('completes NO_TEST_RELEVANT_CHANGES without claiming coverage when there are no DIRECTLY_CHANGED METHOD/FUNCTION candidates', async () => {
    const { handler, analysisSymbolsRepository, analysisRunsService } = await setup();
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([buildSymbol({ kind: 'CLASS' })]);

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'NO_TEST_RELEVANT_CHANGES',
      expect.objectContaining({
        generatedTestsCount: 0,
        functionalBehaviorValidated: false,
        resultSummary: expect.stringContaining('cobertura existente no evaluada'),
      }),
    );
  });

  it('holds a proposal with a CONFIGURATION failure when the framework could not be detected', async () => {
    const { handler, projectVersionsRepository, llmProvider, generatedTestProposalsRepository, analysisRunsService } =
      await setup();
    projectVersionsRepository.findById.mockResolvedValue(buildVersion({ detectedFramework: null }));

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(llmProvider.generate).not.toHaveBeenCalled();
    expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'HELD', failureSummary: expect.stringContaining('framework') }),
    );
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'TECHNICAL_GENERATION_FAILURE',
      expect.anything(),
    );
  });

  it('completes SUCCESS and persists an AVAILABLE proposal when the sandbox run passes', async () => {
    const { handler, generatedTestProposalsRepository, analysisRunsService, sandboxExecutionService, analysisRunChecksService } =
      await setup();

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(sandboxExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'TARGET', targetIds: ['symbol-1'], runnerHint: 'JEST' }),
    );
    expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'AVAILABLE', qualifiedName: 'Thing.doIt' }),
    );
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'SUCCESS',
      expect.objectContaining({ generatedTestsCount: 1, functionalBehaviorValidated: true }),
    );
    expect(analysisRunChecksService.publishForRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCESS' }),
    );
  });

  it('classifies a TEST_ASSERTION failure as BEHAVIORAL_MISMATCH', async () => {
    const { handler, sandboxExecutionService, analysisRunsService, generatedTestProposalsRepository } = await setup();
    sandboxExecutionService.execute.mockResolvedValue(
      sandboxResult({
        facts: { runner: 'JEST', compiled: true, executed: true, passed: false, totalTests: 1, passedTests: 0, failedTests: 1, skippedTests: 0, testCases: [{ suitePath: null, name: 'it works', status: 'FAILED', durationMs: 1, errorMessage: 'expected true, got false' }], testCasesTruncated: false },
      }),
    );

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'HELD', failureSummary: 'expected true, got false' }),
    );
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'BEHAVIORAL_MISMATCH',
      expect.anything(),
    );
  });

  it('classifies a COMPILATION failure as TECHNICAL_GENERATION_FAILURE', async () => {
    const { handler, sandboxExecutionService, analysisRunsService } = await setup();
    sandboxExecutionService.execute.mockResolvedValue(
      sandboxResult({
        facts: { runner: 'JEST', compiled: false, executed: false, passed: false, totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0, testCases: [], testCasesTruncated: false },
      }),
    );

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'TECHNICAL_GENERATION_FAILURE',
      expect.anything(),
    );
  });

  it('persists the failure summary sanitized when the exception message carries a secret (WI-CORE-027, IDEA-015)', async () => {
    const { handler, sandboxExecutionService, generatedTestProposalsRepository } = await setup();
    sandboxExecutionService.execute.mockRejectedValue(
      new SandboxUnavailableError('Descarga fallida https://u:hunter@storage.example/o.zip?X-Amz-Signature=abc password hunter2'),
    );

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    const persisted = generatedTestProposalsRepository.upsertForSymbol.mock.calls
      .map((call) => call[0].failureSummary)
      .join('\n');
    expect(persisted).toContain('Descarga fallida https://[REDACTED]@storage.example/o.zip password [REDACTED]');
    expect(persisted).not.toMatch(/hunter|X-Amz-Signature|abc/);
  });

  it('treats a Sandbox-unavailable symbol as a per-symbol failure without aborting the whole run', async () => {
    const { handler, sandboxExecutionService, analysisRunsService, generatedTestProposalsRepository } = await setup();
    sandboxExecutionService.execute.mockRejectedValue(new SandboxUnavailableError('Sandbox no disponible.'));

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'HELD', failureSummary: 'Sandbox no disponible.' }),
    );
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'TECHNICAL_GENERATION_FAILURE',
      expect.anything(),
    );
  });

  it('BEHAVIORAL_MISMATCH takes priority over an AVAILABLE proposal on another symbol', async () => {
    const { handler, analysisSymbolsRepository, sandboxExecutionService, analysisRunsService } = await setup();
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ id: 'symbol-1', qualifiedName: 'Thing.ok' }),
      buildSymbol({ id: 'symbol-2', qualifiedName: 'Thing.mismatch' }),
    ]);
    sandboxExecutionService.execute
      .mockResolvedValueOnce(sandboxResult())
      .mockResolvedValueOnce(
        sandboxResult({
          facts: { runner: 'JEST', compiled: true, executed: true, passed: false, totalTests: 1, passedTests: 0, failedTests: 1, skippedTests: 0, testCases: [], testCasesTruncated: false },
        }),
      );

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'BEHAVIORAL_MISMATCH',
      expect.anything(),
    );
  });

  it('completes INFRASTRUCTURE_FAILURE and rethrows when materializing the snapshot fails', async () => {
    const { handler, githubSnapshotMaterializerService, analysisRunsService } = await setup();
    githubSnapshotMaterializerService.materialize.mockRejectedValue(new Error('GitHub API 503'));

    await expect(handler.handle({ analysisRunId: 'run-1' }, 'job-1')).rejects.toThrow('GitHub API 503');

    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'INFRASTRUCTURE_FAILURE',
      expect.objectContaining({ resultSummary: 'GitHub API 503' }),
    );
  });

  it('cleans up the materialized workspace even when a later step fails', async () => {
    const { handler, objectStorageService, workspaceCleanup } = await setup();
    objectStorageService.put.mockRejectedValue(new Error('storage down'));

    await expect(handler.handle({ analysisRunId: 'run-1' }, 'job-1')).rejects.toThrow('storage down');

    expect(workspaceCleanup).toHaveBeenCalled();
  });

  it('retrieves the functional rules of the run project per symbol and passes them to the context builder', async () => {
    const { handler, functionalRulesRetriever, contextBuilder } = await setup();
    const rule = {
      knowledgeId: 'rule-1',
      scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
      normalizedRule: 'Devuelve true.',
      scope: 'METHOD',
      targetRef: 'src/thing.ts::Thing.doIt',
      source: 'HUMAN_ANSWER',
      provenance: { confirmedByUserId: null, confirmedRole: 'ADMIN', originHeadSha: null, sourceRef: null },
    };
    functionalRulesRetriever.retrieve.mockResolvedValue([rule]);

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(functionalRulesRetriever.retrieve).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ filePath: 'src/thing.ts', symbolName: 'Thing', methodName: 'doIt', targetType: 'METHOD' }),
    );
    expect(contextBuilder.build).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      {},
      [rule],
    );
  });

  describe('ejecuciones del Sandbox y propuestas por símbolo (WI-CORE-026, corte B)', () => {
    it('upserts the proposal by symbol and records the accepted execution with the attempt of the run', async () => {
      const { handler, generatedTestProposalsRepository, analysisTraceRepository } = await setup();

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ analysisRunId: 'run-1', analysisSymbolId: 'symbol-1', status: 'AVAILABLE', failureSummary: null }),
      );
      expect(analysisTraceRepository.upsertExecution).toHaveBeenCalledWith({
        analysisRunId: 'run-1',
        proposalId: 'proposal-1',
        executionId: 'exec-1',
        attempt: 1,
        executionProfile: 'NODE_TYPESCRIPT',
        outcome: 'SUCCESS',
        requestId: 'request-1',
        correlationId: 'correlation-1',
        durationMs: 7,
        facts: PASSED_FACTS,
        failure: null,
      });
    });

    it('keeps a valid proposal AVAILABLE and logs without failing when recording the execution fails', async () => {
      const { handler, analysisTraceRepository, generatedTestProposalsRepository, analysisRunsService, analysisRunChecksService } = await setup();
      analysisTraceRepository.upsertExecution.mockRejectedValueOnce(new Error('connection string postgresql://user:secret@host'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(handler.handle({ analysisRunId: 'run-1' }, 'job-1')).resolves.toBeUndefined();

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'AVAILABLE', failureSummary: null }),
      );
      expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
        expect.anything(),
        'SUCCESS',
        expect.objectContaining({ generatedTestsCount: 1 }),
      );
      expect(analysisRunChecksService.publishForRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('exec-1'));
      expect(warn.mock.calls.map((call) => String(call[0])).join(' ')).not.toContain('secret');
      warn.mockRestore();
    });

    it('keeps a BEHAVIORAL_MISMATCH proposal with its classification when recording the execution fails', async () => {
      const { handler, sandboxExecutionService, analysisTraceRepository, generatedTestProposalsRepository, analysisRunsService } = await setup();
      sandboxExecutionService.execute.mockResolvedValue(
        sandboxResult({
          facts: { runner: 'JEST', compiled: true, executed: true, passed: false, totalTests: 1, passedTests: 0, failedTests: 1, skippedTests: 0, testCases: [{ suitePath: null, name: 'it works', status: 'FAILED', durationMs: 1, errorMessage: 'expected true, got false' }], testCasesTruncated: false },
        }),
      );
      analysisTraceRepository.upsertExecution.mockRejectedValueOnce(new Error('connection string postgresql://user:secret@host'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(handler.handle({ analysisRunId: 'run-1' }, 'job-1')).resolves.toBeUndefined();

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledTimes(1);
      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'HELD', failureSummary: 'expected true, got false', contextId: 'context-1' }),
      );
      const stored = generatedTestProposalsRepository.upsertForSymbol.mock.calls[0]![0] as { contentSha256: string };
      expect(stored.contentSha256).not.toBe(createHash('sha256').update('').digest('hex'));
      expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
        expect.anything(),
        'BEHAVIORAL_MISMATCH',
        expect.anything(),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('exec-1'));
      expect(warn.mock.calls.map((call) => String(call[0])).join(' ')).not.toContain('secret');
      warn.mockRestore();
    });

    it('does not leave the handler when recording an accepted execution fails inside the catch, and keeps the held classification', async () => {
      const { handler, sandboxExecutionService, analysisTraceRepository, generatedTestProposalsRepository, analysisRunsService } = await setup();
      sandboxExecutionService.execute.mockRejectedValue(
        new SandboxAcceptedExecutionError('La ejecución exec-9 no terminó.', 'exec-9', 'NODE_TYPESCRIPT'),
      );
      analysisTraceRepository.upsertExecution.mockRejectedValueOnce(new Error('connection string postgresql://user:secret@host'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(handler.handle({ analysisRunId: 'run-1' }, 'job-1')).resolves.toBeUndefined();

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'HELD', failureSummary: 'La ejecución exec-9 no terminó.' }),
      );
      expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
        expect.anything(),
        'TECHNICAL_GENERATION_FAILURE',
        expect.anything(),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('exec-9'));
      expect(warn.mock.calls.map((call) => String(call[0])).join(' ')).not.toContain('secret');
      warn.mockRestore();
    });

    it('numbers the attempt after the continuations of the run (attemptCount + 1)', async () => {
      const context = await setup();
      context.analysisRunsRepository.findById.mockResolvedValue(buildRun({ attemptCount: 1 }));

      await context.handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(context.analysisTraceRepository.upsertExecution).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 2, executionId: 'exec-1' }),
      );
    });

    it('records a BEHAVIORAL_MISMATCH execution with the Run vocabulary for a failing assertion', async () => {
      const { handler, sandboxExecutionService, analysisTraceRepository } = await setup();
      sandboxExecutionService.execute.mockResolvedValue(
        sandboxResult({
          facts: { runner: 'JEST', compiled: true, executed: true, passed: false, totalTests: 1, passedTests: 0, failedTests: 1, skippedTests: 0, testCases: [], testCasesTruncated: false },
          executionId: 'exec-assert',
        }),
      );

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(analysisTraceRepository.upsertExecution).toHaveBeenCalledWith(
        expect.objectContaining({ proposalId: 'proposal-1', executionId: 'exec-assert', outcome: 'BEHAVIORAL_MISMATCH' }),
      );
    });

    it('keeps the executionId of an accepted execution that failed afterwards and holds its proposal', async () => {
      const { handler, sandboxExecutionService, analysisTraceRepository, generatedTestProposalsRepository } = await setup();
      sandboxExecutionService.execute.mockRejectedValue(
        new SandboxAcceptedExecutionError('La ejecución exec-9 no terminó.', 'exec-9', 'NODE_TYPESCRIPT'),
      );

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'HELD', failureSummary: 'La ejecución exec-9 no terminó.' }),
      );
      expect(analysisTraceRepository.upsertExecution).toHaveBeenCalledWith({
        analysisRunId: 'run-1',
        proposalId: 'proposal-1',
        executionId: 'exec-9',
        attempt: 1,
        executionProfile: 'NODE_TYPESCRIPT',
        outcome: 'TECHNICAL_GENERATION_FAILURE',
        requestId: null,
        correlationId: null,
        durationMs: null,
        facts: NOT_OBSERVED_FACTS,
        failure: null,
      });
    });

    it('records no execution when the Sandbox never accepted the request', async () => {
      const { handler, sandboxExecutionService, analysisTraceRepository } = await setup();
      sandboxExecutionService.execute.mockRejectedValue(new SandboxUnavailableError('Sandbox no disponible.'));

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(analysisTraceRepository.upsertExecution).not.toHaveBeenCalled();
    });

    it('records no execution for a symbol that already has a test, so its executions are NOT_APPLICABLE', async () => {
      const { handler, testTargetsRepository, analysisTraceRepository } = await setup();
      testTargetsRepository.findByProjectVersion.mockResolvedValue([
        { id: 'target-1', projectVersionId: 'version-1', filePath: 'src/thing.ts', symbolName: 'Thing', methodName: 'doIt', targetType: 'METHOD', hasTest: true, testFilePaths: [] } as unknown as TestTarget,
      ]);

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(analysisTraceRepository.upsertExecution).not.toHaveBeenCalled();
    });
  });

  describe('trazas de retrieval y contexto (WI-CORE-026)', () => {
    const chunk = {
      id: 'chunk-target',
      filePath: 'src/thing.ts',
      symbolKind: 'METHOD',
      symbolName: 'Thing',
      parentSymbolName: 'Thing',
      startLine: 1,
      endLine: 3,
      content: 'SECRETO_DE_CODIGO target',
      tokenCount: 5,
    };
    const rule = {
      knowledgeId: 'rule-1',
      scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
      normalizedRule: 'TEXTO_REGLA_NO_PERSISTIDO',
      scope: 'METHOD',
      targetRef: 'src/thing.ts::Thing.doIt',
      source: 'HUMAN_ANSWER',
      provenance: { confirmedByUserId: 'user-1', confirmedRole: 'ADMIN', originHeadSha: 'head-1', sourceRef: 'ref-1' },
    };

    it('persists the retrieval and the context per target and links the context_id into the proposal', async () => {
      const { handler, analysisTraceRepository, generatedTestProposalsRepository, retrievalService } = await setup();
      retrievalService.retrieve.mockResolvedValue({
        targetChunks: [chunk],
        candidates: [{ chunk: { ...chunk, id: 'chunk-near', content: 'SECRETO_DE_CODIGO near' }, semanticScore: 0.9, structuralMatch: null }],
      });

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(analysisTraceRepository.upsertRetrieval).toHaveBeenCalledWith({
        analysisRunId: 'run-1',
        analysisSymbolId: 'symbol-1',
        mode: 'SE',
        config: { mode: 'SE', vectorTopK: 20, targetChunkIds: ['chunk-target'] },
        candidates: [
          expect.objectContaining({ chunkId: 'chunk-near', semanticScore: 0.9, structuralMatch: null }),
        ],
      });
      expect(JSON.stringify(analysisTraceRepository.upsertRetrieval.mock.calls[0][0])).not.toContain('SECRETO_DE_CODIGO');
      expect(analysisTraceRepository.upsertContext).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisRunId: 'run-1',
          analysisSymbolId: 'symbol-1',
          retrievalId: 'retrieval-1',
          tokenBudget: 1000,
          functionalRuleIds: [],
          functionalRulesOmitted: 0,
          omittedFunctionalRules: [],
        }),
      );
      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'AVAILABLE', contextId: 'context-1' }),
      );
    });

    it('keeps the GenerationContext and the prompt unchanged by the trace persistence', async () => {
      const context = await setup();
      const generationContext = buildGenerationContext({ functionalRules: [rule] });
      context.contextBuilder.build.mockReturnValue(generationContext);
      const realPromptBuilder = new PromptBuilder();
      context.promptBuilder.build.mockImplementation((ctx: never) => realPromptBuilder.build(ctx));
      const before = structuredClone(generationContext);

      await context.handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(context.promptBuilder.build).toHaveBeenCalledWith(generationContext);
      expect(generationContext).toEqual(before);
      expect(context.llmProvider.generate).toHaveBeenCalledWith(realPromptBuilder.build(before as never));
    });

    it('persists the functional rule omitted by TOKEN_BUDGET with its knowledgeId and reason, without rule text or provenance', async () => {
      const context = await setup();
      const kept = { ...rule, knowledgeId: 'rule-kept' };
      // El presupuesto admite exactamente una regla: la segunda (mismo texto renderizado) queda omitida.
      const budget = countFunctionalRuleTokens(kept as never);
      const realBuilder = new ContextBuilder({
        get: (key: string, fallback: unknown) => (key === 'RETRIEVAL_MAX_CONTEXT_TOKENS' ? budget : fallback),
      } as never);
      context.contextBuilder.build.mockImplementation((...args: unknown[]) =>
        (realBuilder.build as (...a: unknown[]) => unknown).apply(realBuilder, args),
      );
      context.retrievalService.retrieve.mockResolvedValue({ targetChunks: [{ ...chunk, tokenCount: 0 }], candidates: [] });
      context.functionalRulesRetriever.retrieve.mockResolvedValue([kept, { ...rule, knowledgeId: 'rule-omitted' }] as never);

      await context.handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      const [contextArgs] = context.analysisTraceRepository.upsertContext.mock.calls[0];
      expect(contextArgs).toMatchObject({
        functionalRuleIds: ['rule-kept'],
        functionalRulesRetrieved: 2,
        functionalRulesSelected: 1,
        functionalRulesOmitted: 1,
        omittedFunctionalRules: [{ knowledgeId: 'rule-omitted', reason: 'TOKEN_BUDGET' }],
      });
      const serialized = JSON.stringify(contextArgs);
      expect(serialized).not.toContain('TEXTO_REGLA_NO_PERSISTIDO');
      expect(serialized).not.toContain('confirmedRole');
      expect(serialized).not.toContain('user-1');
    });

    it('records no retrieval or context for a symbol that already has a test', async () => {
      const { handler, testTargetsRepository, analysisTraceRepository, retrievalService } = await setup();
      testTargetsRepository.findByProjectVersion.mockResolvedValue([
        { id: 'target-1', projectVersionId: 'version-1', filePath: 'src/thing.ts', symbolName: 'Thing', methodName: 'doIt', targetType: 'METHOD', hasTest: true, testFilePaths: [] } as unknown as TestTarget,
      ]);

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(retrievalService.retrieve).not.toHaveBeenCalled();
      expect(analysisTraceRepository.upsertRetrieval).not.toHaveBeenCalled();
      expect(analysisTraceRepository.upsertContext).not.toHaveBeenCalled();
    });

    it('holds the proposal with a null context_id and persists no retrieval or context when retrieval fails', async () => {
      const { handler, retrievalService, analysisTraceRepository, generatedTestProposalsRepository } = await setup();
      retrievalService.retrieve.mockRejectedValue(new Error('No se encontró un chunk indexado'));

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(analysisTraceRepository.upsertRetrieval).not.toHaveBeenCalled();
      expect(analysisTraceRepository.upsertContext).not.toHaveBeenCalled();
      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'HELD', contextId: null }),
      );
    });

    it('keeps the context_id of a generation failure after the context was persisted', async () => {
      const { handler, llmProvider, generatedTestProposalsRepository } = await setup();
      llmProvider.generate.mockRejectedValue(new Error('LLM caído'));

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'HELD', contextId: 'context-1' }),
      );
    });
  });

  describe('evidencia de ejecución y de generación (WI-CORE-027, corte B)', () => {
    const COMPILE_FAILURE = { stage: 'COMPILING', category: 'COMPILATION', code: 'TS2304', message: "Cannot find name 'foo'" };

    function evidenceOf(analysisTraceRepository: { upsertExecution: ReturnType<typeof vi.fn> }) {
      return analysisTraceRepository.upsertExecution.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>);
    }

    it('records the generation of the proposal with the effective provider, model, tokens and a non-negative duration', async () => {
      const { handler, llmProvider, generatedTestProposalsRepository } = await setup();
      llmProvider.generate.mockResolvedValueOnce({
        content: 'test content',
        inputTokens: 10,
        outputTokens: 20,
        effective: { provider: 'openai', model: 'gpt-x', reasoningEffort: 'high' },
      });

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({
          generation: {
            provider: 'openai',
            model: 'gpt-x',
            modelVersion: null,
            reasoningEffort: 'high',
            inputTokens: 10,
            outputTokens: 20,
            durationMs: expect.any(Number),
          },
        }),
      );
      const generation = generatedTestProposalsRepository.upsertForSymbol.mock.calls[0]![0].generation as { durationMs: number };
      expect(generation.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('stores null for each generation field the adapter did not report, keeping the reported tokens', async () => {
      const { handler, generatedTestProposalsRepository } = await setup();

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({
          generation: expect.objectContaining({ provider: null, model: null, modelVersion: null, reasoningEffort: null, inputTokens: 10, outputTokens: 20 }),
        }),
      );
    });

    it('records COMPLETED with failing tests as TEST_ASSERTION without stage, code or message (DEC-EVID-006)', async () => {
      const { handler, sandboxExecutionService, analysisTraceRepository } = await setup();
      sandboxExecutionService.execute.mockResolvedValue(
        sandboxResult({
          facts: { runner: 'JEST', compiled: true, executed: true, passed: false, totalTests: 2, passedTests: 1, failedTests: 1, skippedTests: 0, testCases: [{ suitePath: null, name: 'falla', status: 'FAILED', durationMs: 1, errorMessage: 'expected 1 got 2 token=abc123' }], testCasesTruncated: false },
        }),
      );

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      const [execution] = evidenceOf(analysisTraceRepository);
      expect(execution).toMatchObject({
        outcome: 'BEHAVIORAL_MISMATCH',
        failure: null,
        facts: {
          runner: 'JEST',
          passed: false,
          totalTests: 2,
          failedTests: 1,
          failureCategory: 'TEST_ASSERTION',
          failureStage: null,
          failureCode: null,
          failureMessage: null,
        },
      });
      expect(JSON.stringify(execution)).not.toContain('expected 1 got 2');
      expect(JSON.stringify(execution)).not.toContain('abc123');
      expect(Object.keys((execution.facts as object))).not.toContain('testCases');
    });

    it('records the validated fact of a FAILED result with its secrets redacted and no raw field', async () => {
      const { handler, sandboxExecutionService, analysisTraceRepository } = await setup();
      sandboxExecutionService.execute.mockResolvedValue(
        sandboxResult({
          status: 'FAILED',
          facts: null,
          failure: { ...COMPILE_FAILURE, message: "Cannot find name 'foo' token xoxb-123456789012-abcdefghijk" },
        }),
      );

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      const [execution] = evidenceOf(analysisTraceRepository);
      expect(execution.failure).toEqual({
        stage: 'COMPILING',
        category: 'COMPILATION',
        code: 'TS2304',
        message: "Cannot find name 'foo' token [REDACTED]",
      });
      expect(execution.facts).toMatchObject({
        executionProfile: 'NODE_TYPESCRIPT',
        failureStage: 'COMPILING',
        failureCategory: 'COMPILATION',
        failureCode: 'TS2304',
        failureMessage: "Cannot find name 'foo' token [REDACTED]",
      });
      expect(JSON.stringify(execution)).not.toContain('xoxb-');
    });

    it('records a TIMED_OUT execution without a fact as the observed identity only, with no invented category', async () => {
      const { handler, sandboxExecutionService, analysisTraceRepository } = await setup();
      sandboxExecutionService.execute.mockResolvedValue(sandboxResult({ status: 'TIMED_OUT', facts: null, failure: null }));

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      const [execution] = evidenceOf(analysisTraceRepository);
      expect(execution).toMatchObject({
        executionId: 'exec-1',
        requestId: 'request-1',
        correlationId: 'correlation-1',
        durationMs: 7,
        failure: null,
        facts: { executionProfile: 'NODE_TYPESCRIPT', passed: null, failureCategory: null, failureStage: null },
      });
    });

    it('keeps the identity and duration of an accepted execution that failed afterwards when the error carries them', async () => {
      const { handler, sandboxExecutionService, analysisTraceRepository } = await setup();
      sandboxExecutionService.execute.mockRejectedValue(
        new SandboxAcceptedExecutionError('La ejecución exec-8 no terminó.', 'exec-8', 'NODE_TYPESCRIPT', 'req-8', 'corr-8', 12),
      );

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(evidenceOf(analysisTraceRepository)[0]).toMatchObject({ executionId: 'exec-8', requestId: 'req-8', correlationId: 'corr-8', durationMs: 12 });
    });

    it('records a null generation and no execution when the provider fails before a result', async () => {
      const { handler, llmProvider, generatedTestProposalsRepository, sandboxExecutionService, analysisTraceRepository } = await setup();
      llmProvider.generate.mockRejectedValue(new Error('LLM caído'));

      await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'HELD', generation: null }),
      );
      expect(sandboxExecutionService.execute).not.toHaveBeenCalled();
      expect(analysisTraceRepository.upsertExecution).not.toHaveBeenCalled();
    });

    it('keeps the proposal and its contents when writing the generation fails, retries without it and logs only the error name', async () => {
      const { handler, generatedTestProposalsRepository, analysisTraceRepository } = await setup();
      const failing = new Error('connection string postgresql://user:secret@host');
      failing.name = 'PrismaClientKnownRequestError';
      generatedTestProposalsRepository.upsertForSymbol.mockImplementation(async (input: { generation: unknown }) => {
        if (input.generation !== null) {
          throw failing;
        }
        return { id: 'proposal-1' };
      });
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(handler.handle({ analysisRunId: 'run-1' }, 'job-1')).resolves.toBeUndefined();

      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenCalledTimes(2);
      expect(generatedTestProposalsRepository.upsertForSymbol).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'AVAILABLE', generation: null, failureSummary: null }),
      );
      expect(analysisTraceRepository.upsertExecution).toHaveBeenCalledWith(expect.objectContaining({ proposalId: 'proposal-1', outcome: 'SUCCESS' }));
      const logged = warn.mock.calls.map((call) => String(call[0])).join(' ');
      expect(logged).toContain('PrismaClientKnownRequestError');
      expect(logged).not.toContain('secret');
      warn.mockRestore();
    });
  });
});
