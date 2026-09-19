import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunValidationJobHandler } from './analysis-run-validation-job.handler.js';
import { SandboxUnavailableError } from '../sandbox/sandbox-execution.service.js';
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
    createdAt: new Date(),
    ...overrides,
  };
}

function buildVersion(overrides: Partial<ProjectVersion> = {}): ProjectVersion {
  return { id: 'version-1', detectedFramework: 'JEST', ...overrides } as ProjectVersion;
}

function sandboxResult(overrides: Partial<{ status: string; facts: unknown; failure: unknown }> = {}) {
  return {
    status: 'COMPLETED',
    facts: { runner: 'JEST', compiled: true, executed: true, passed: true, totalTests: 1, passedTests: 1, failedTests: 0, skippedTests: 0, testCases: [], testCasesTruncated: false },
    failure: null,
    stageDurations: [],
    ...overrides,
  };
}

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
    const analysisRunsService = { completeRunFromSystem: vi.fn() };
    const analysisSymbolsRepository = { findByAnalysisRun: vi.fn().mockResolvedValue([buildSymbol()]) };
    const repositoryBindingsRepository = { findByRepositoryId: vi.fn().mockResolvedValue(binding) };
    const projectVersionsRepository = { findById: vi.fn().mockResolvedValue(buildVersion()) };
    const testTargetsRepository = { findByProjectVersion: vi.fn().mockResolvedValue([] as TestTarget[]) };
    const workspaceCleanup = vi.fn().mockResolvedValue(undefined);
    const githubSnapshotMaterializerService = {
      materialize: vi.fn().mockResolvedValue({ dir: workspaceDir, cleanup: workspaceCleanup }),
    };
    const retrievalService = { retrieve: vi.fn().mockResolvedValue({ targetChunks: [], candidates: [] }) };
    const contextBuilder = { build: vi.fn().mockReturnValue({ retrievedChunks: 0, selectedChunks: 0, contextTokens: 0 }) };
    const promptBuilder = { build: vi.fn().mockReturnValue('prompt') };
    const testFileMergeService = {
      applyCreate: vi.fn((content: string) => `created:${content}`),
      applyMerge: vi.fn((existing: string, content: string) => `merged:${existing}:${content}`),
    };
    const sandboxExecutionService = { execute: vi.fn().mockResolvedValue(sandboxResult()) };
    const objectStorageService = { put: vi.fn().mockResolvedValue(undefined) };
    const generatedTestProposalsRepository = { create: vi.fn().mockResolvedValue({ id: 'proposal-1' }) };
    const llmProvider = { generate: vi.fn().mockResolvedValue({ content: 'test content', inputTokens: 10, outputTokens: 20 }) };

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
      promptBuilder as never,
      testFileMergeService as never,
      sandboxExecutionService as never,
      objectStorageService as never,
      generatedTestProposalsRepository as never,
      llmProvider as never,
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
      promptBuilder,
      testFileMergeService,
      sandboxExecutionService,
      objectStorageService,
      generatedTestProposalsRepository,
      llmProvider,
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

    expect(repositoryBindingsRepository.findByRepositoryId).not.toHaveBeenCalled();
  });

  it('is a no-op when the run is not PROCESSING', async () => {
    const { handler, analysisRunsRepository, repositoryBindingsRepository } = await setup();
    analysisRunsRepository.findById.mockResolvedValue(buildRun({ status: 'SUCCESS' }));

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(repositoryBindingsRepository.findByRepositoryId).not.toHaveBeenCalled();
  });

  it('completes as INFRASTRUCTURE_FAILURE when the repository binding no longer exists', async () => {
    const { handler, repositoryBindingsRepository, analysisRunsService } = await setup();
    repositoryBindingsRepository.findByRepositoryId.mockResolvedValue(null);

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

  it('completes NO_ADDITIONAL_TESTS_REQUIRED when there are no DIRECTLY_CHANGED METHOD/FUNCTION candidates', async () => {
    const { handler, analysisSymbolsRepository, analysisRunsService } = await setup();
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([buildSymbol({ kind: 'CLASS' })]);

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'NO_ADDITIONAL_TESTS_REQUIRED',
      expect.anything(),
    );
  });

  it('holds a proposal with a CONFIGURATION failure when the framework could not be detected', async () => {
    const { handler, projectVersionsRepository, llmProvider, generatedTestProposalsRepository, analysisRunsService } =
      await setup();
    projectVersionsRepository.findById.mockResolvedValue(buildVersion({ detectedFramework: null }));

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(llmProvider.generate).not.toHaveBeenCalled();
    expect(generatedTestProposalsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'HELD', failureSummary: expect.stringContaining('framework') }),
    );
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'TECHNICAL_GENERATION_FAILURE',
      expect.anything(),
    );
  });

  it('completes SUCCESS and persists an AVAILABLE proposal when the sandbox run passes', async () => {
    const { handler, generatedTestProposalsRepository, analysisRunsService, sandboxExecutionService } = await setup();

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(sandboxExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'TARGET', targetIds: ['symbol-1'], runnerHint: 'JEST' }),
    );
    expect(generatedTestProposalsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'AVAILABLE', qualifiedName: 'Thing.doIt' }),
    );
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'SUCCESS',
      expect.objectContaining({ generatedTestsCount: 1, functionalBehaviorValidated: true }),
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

    expect(generatedTestProposalsRepository.create).toHaveBeenCalledWith(
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

  it('treats a Sandbox-unavailable symbol as a per-symbol failure without aborting the whole run', async () => {
    const { handler, sandboxExecutionService, analysisRunsService, generatedTestProposalsRepository } = await setup();
    sandboxExecutionService.execute.mockRejectedValue(new SandboxUnavailableError('Sandbox no disponible.'));

    await handler.handle({ analysisRunId: 'run-1' }, 'job-1');

    expect(generatedTestProposalsRepository.create).toHaveBeenCalledWith(
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
});
