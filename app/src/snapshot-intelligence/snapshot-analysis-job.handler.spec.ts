import { describe, expect, it, vi } from 'vitest';
import { SnapshotAnalysisJobHandler } from './snapshot-analysis-job.handler.js';
import type { ParsedChunk } from '../project-versions/parsing/typescript-parser.service.js';
import type { AnalysisRun, RepositoryBinding, ProjectVersion } from '../generated/prisma/client.js';

function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryId: '123',
    repositoryName: 'org/repo',
    prNumber: 42,
    prTitle: 'Add feature',
    baseRef: 'develop',
    headRef: 'feature/x',
    baseSha: 'base-sha',
    headSha: 'head-sha',
    draft: false,
    prState: 'OPEN',
    actorLogin: 'octocat',
    status: 'QUEUED',
    current: true,
    attemptCount: 0,
    indexMode: 'BOOTSTRAP',
    changesetBaseSha: 'base-sha',
    changesetHeadSha: 'head-sha',
    indexDeltaBaseSha: null,
    projectVersionId: null,
    functionalBehaviorValidated: false,
    actionRequiredCount: 0,
    generatedTestsCount: 0,
    resultSummary: null,
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
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

function buildChunk(overrides: Partial<ParsedChunk> = {}): ParsedChunk {
  return {
    filePath: 'src/a.ts',
    symbolKind: 'FUNCTION',
    symbolName: 'doThing',
    parentSymbolName: null,
    startLine: 1,
    endLine: 3,
    content: 'export function doThing() {}',
    importsUsed: [],
    tokenCount: 10,
    partIndex: 1,
    partsTotal: 1,
    ...overrides,
  };
}

describe('SnapshotAnalysisJobHandler', () => {
  function setup() {
    const jobsService = { registerHandler: vi.fn(), enqueue: vi.fn() };
    const analysisRunsRepository = { findById: vi.fn() };
    const analysisRunsService = {
      startProcessing: vi.fn(),
      recordSnapshot: vi.fn(),
      completeRunFromSystem: vi.fn(),
      markActionRequiredFromSystem: vi.fn(),
    };
    const repositoryBindingsRepository = { findByRepositoryId: vi.fn().mockResolvedValue(binding) };
    const projectVersionsRepository = {
      findLatestCompletedByProject: vi.fn().mockResolvedValue(null),
      createPending: vi.fn().mockResolvedValue({ id: 'version-1' } as ProjectVersion),
      markStarted: vi.fn().mockResolvedValue(undefined),
      completeAndPromote: vi.fn().mockResolvedValue(undefined),
    };
    const codeChunksRepository = {
      insertMany: vi.fn().mockResolvedValue(undefined),
      findByProjectVersion: vi.fn().mockResolvedValue([]),
    };
    const testTargetsRepository = { insertMany: vi.fn().mockResolvedValue(undefined) };
    const fileDiscoveryService = { discover: vi.fn().mockResolvedValue(['src/a.ts', 'package.json']) };
    const typeScriptParserService = { parse: vi.fn().mockReturnValue([buildChunk()]) };
    const testTargetExtractorService = { extract: vi.fn().mockReturnValue([]) };
    const existingTestResolverService = { resolve: vi.fn().mockReturnValue([]) };
    const githubAppAuthService = { getInstallationToken: vi.fn().mockResolvedValue('installation-token') };
    const githubRepositoryContentService = {
      compare: vi.fn().mockResolvedValue([{ filename: 'src/a.ts', status: 'modified' }]),
    };
    const workspaceCleanup = vi.fn().mockResolvedValue(undefined);
    const githubSnapshotMaterializerService = {
      materialize: vi.fn().mockResolvedValue({ dir: '/tmp/fake-workspace', cleanup: workspaceCleanup }),
    };
    const analysisSymbolsRepository = { insertMany: vi.fn().mockResolvedValue(undefined) };
    const functionalContextEvaluatorService = { evaluate: vi.fn().mockResolvedValue({ actionRequired: false }) };
    const embeddingProvider = { embedMany: vi.fn().mockResolvedValue([[0.1, 0.2]]) };

    const initialRun = buildRun();
    const processingRun = buildRun({ status: 'PROCESSING' });
    analysisRunsRepository.findById.mockResolvedValue(initialRun);
    analysisRunsService.startProcessing.mockResolvedValue(processingRun);
    analysisRunsService.recordSnapshot.mockImplementation(async (run: AnalysisRun, patch: object) => ({
      ...run,
      ...patch,
    }));
    analysisRunsService.completeRunFromSystem.mockImplementation(async (run: AnalysisRun, status: string) => ({
      ...run,
      status,
    }));

    const handler = new SnapshotAnalysisJobHandler(
      jobsService as never,
      analysisRunsRepository as never,
      analysisRunsService as never,
      repositoryBindingsRepository as never,
      projectVersionsRepository as never,
      codeChunksRepository as never,
      testTargetsRepository as never,
      fileDiscoveryService as never,
      typeScriptParserService as never,
      testTargetExtractorService as never,
      existingTestResolverService as never,
      githubAppAuthService as never,
      githubRepositoryContentService as never,
      githubSnapshotMaterializerService as never,
      analysisSymbolsRepository as never,
      functionalContextEvaluatorService as never,
      embeddingProvider as never,
    );

    return {
      handler,
      jobsService,
      analysisRunsRepository,
      analysisRunsService,
      repositoryBindingsRepository,
      projectVersionsRepository,
      codeChunksRepository,
      testTargetsRepository,
      fileDiscoveryService,
      typeScriptParserService,
      testTargetExtractorService,
      existingTestResolverService,
      githubAppAuthService,
      githubRepositoryContentService,
      githubSnapshotMaterializerService,
      analysisSymbolsRepository,
      functionalContextEvaluatorService,
      embeddingProvider,
      workspaceCleanup,
      initialRun,
      processingRun,
    };
  }

  it('registers itself as a job handler on module init', () => {
    const { handler, jobsService } = setup();
    handler.onModuleInit();
    expect(jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('is a no-op when the run does not exist', async () => {
    const { handler, analysisRunsRepository, analysisRunsService } = setup();
    analysisRunsRepository.findById.mockResolvedValue(null);

    await handler.handle({ analysisRunId: 'missing' });

    expect(analysisRunsService.startProcessing).not.toHaveBeenCalled();
  });

  it('is a no-op when the run is not QUEUED (already processed or reprocessed)', async () => {
    const { handler, analysisRunsRepository, analysisRunsService } = setup();
    analysisRunsRepository.findById.mockResolvedValue(buildRun({ status: 'PROCESSING' }));

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisRunsService.startProcessing).not.toHaveBeenCalled();
  });

  it('fails as INFRASTRUCTURE_FAILURE when the repository binding no longer exists', async () => {
    const { handler, repositoryBindingsRepository, analysisRunsService, initialRun } = setup();
    repositoryBindingsRepository.findByRepositoryId.mockResolvedValue(null);

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisRunsService.startProcessing).not.toHaveBeenCalled();
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      initialRun,
      'INFRASTRUCTURE_FAILURE',
      expect.objectContaining({ resultSummary: expect.any(String) }),
    );
  });

  it('bootstraps when there is no previous ProjectVersion for the project', async () => {
    const { handler, analysisRunsService, projectVersionsRepository, workspaceCleanup } = setup();

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisRunsService.startProcessing).toHaveBeenCalled();
    expect(projectVersionsRepository.createPending).toHaveBeenCalledWith({
      projectId: 'project-1',
      commitSha: 'head-sha',
    });
    expect(analysisRunsService.recordSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PROCESSING' }),
      { indexMode: 'BOOTSTRAP', indexDeltaBaseSha: null, projectVersionId: 'version-1' },
    );
    expect(workspaceCleanup).toHaveBeenCalled();
  });

  it('marks INCREMENTAL with the previous commit as indexDeltaBaseSha when a previous version exists', async () => {
    const { handler, analysisRunsService, projectVersionsRepository } = setup();
    projectVersionsRepository.findLatestCompletedByProject.mockResolvedValue({
      id: 'version-0',
      commitSha: 'prev-sha',
    } as ProjectVersion);

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisRunsService.recordSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ indexMode: 'INCREMENTAL', indexDeltaBaseSha: 'prev-sha' }),
    );
  });

  it('reports every symbol in a changed file as DIRECTLY_CHANGED during BOOTSTRAP', async () => {
    const { handler, analysisSymbolsRepository, typeScriptParserService } = setup();
    typeScriptParserService.parse.mockReturnValue([
      buildChunk({ symbolName: 'doThing' }),
      buildChunk({ symbolKind: 'CLASS', symbolName: 'Thing', filePath: 'src/other.ts' }),
    ]);

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisSymbolsRepository.insertMany).toHaveBeenCalledWith('run-1', [
      expect.objectContaining({ qualifiedName: 'doThing', changeKind: 'DIRECTLY_CHANGED' }),
    ]);
  });

  it('only reports a symbol as DIRECTLY_CHANGED (INCREMENTAL) when its content actually differs from the previous version', async () => {
    const { handler, analysisSymbolsRepository, typeScriptParserService, codeChunksRepository, projectVersionsRepository } =
      setup();
    projectVersionsRepository.findLatestCompletedByProject.mockResolvedValue({
      id: 'version-0',
      commitSha: 'prev-sha',
    } as ProjectVersion);
    typeScriptParserService.parse.mockReturnValue([
      buildChunk({ symbolName: 'unchanged', content: 'same content' }),
      buildChunk({ symbolName: 'changed', content: 'new content' }),
    ]);
    codeChunksRepository.findByProjectVersion.mockResolvedValue([
      { filePath: 'src/a.ts', symbolKind: 'FUNCTION', symbolName: 'unchanged', parentSymbolName: null, content: 'same content' },
      { filePath: 'src/a.ts', symbolKind: 'FUNCTION', symbolName: 'changed', parentSymbolName: null, content: 'old content' },
    ]);

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisSymbolsRepository.insertMany).toHaveBeenCalledWith('run-1', [
      expect.objectContaining({ qualifiedName: 'changed', changeKind: 'DIRECTLY_CHANGED' }),
    ]);
  });

  it('reports a symbol outside the CHANGESET as POTENTIALLY_IMPACTED when it relatively imports a changed file', async () => {
    const { handler, analysisSymbolsRepository, typeScriptParserService } = setup();
    typeScriptParserService.parse.mockReturnValue([
      buildChunk({ symbolName: 'doThing' }), // src/a.ts, in the changeset -> DIRECTLY_CHANGED
      buildChunk({
        filePath: 'src/consumer.ts',
        symbolName: 'useThing',
        importsUsed: ['./a'],
      }),
      buildChunk({
        filePath: 'src/unrelated.ts',
        symbolName: 'useLodash',
        importsUsed: ['lodash'],
      }),
    ]);

    await handler.handle({ analysisRunId: 'run-1' });

    const [, symbols] = analysisSymbolsRepository.insertMany.mock.calls[0];
    expect(symbols).toEqual([
      expect.objectContaining({ qualifiedName: 'doThing', changeKind: 'DIRECTLY_CHANGED' }),
      expect.objectContaining({ qualifiedName: 'useThing', changeKind: 'POTENTIALLY_IMPACTED' }),
    ]);
  });

  it('closes as NO_TEST_RELEVANT_CHANGES when the CHANGESET touches no source file', async () => {
    const { handler, analysisRunsService, githubRepositoryContentService, typeScriptParserService } = setup();
    githubRepositoryContentService.compare.mockResolvedValue([{ filename: 'README.md', status: 'modified' }]);
    typeScriptParserService.parse.mockReturnValue([]);

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PROCESSING' }),
      'NO_TEST_RELEVANT_CHANGES',
      expect.objectContaining({ resultSummary: expect.any(String) }),
    );
  });

  it('leaves the run PROCESSING when the CHANGESET touches source but has enough functional context', async () => {
    const { handler, analysisRunsService, functionalContextEvaluatorService } = setup();

    await handler.handle({ analysisRunId: 'run-1' });

    expect(functionalContextEvaluatorService.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PROCESSING' }),
    );
    expect(analysisRunsService.completeRunFromSystem).not.toHaveBeenCalled();
    expect(analysisRunsService.markActionRequiredFromSystem).not.toHaveBeenCalled();
  });

  it('marks ACTION_REQUIRED when the functional context evaluator says a question is needed', async () => {
    const { handler, analysisRunsService, functionalContextEvaluatorService } = setup();
    functionalContextEvaluatorService.evaluate.mockResolvedValue({ actionRequired: true });

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisRunsService.markActionRequiredFromSystem).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PROCESSING' }),
    );
    expect(analysisRunsService.completeRunFromSystem).not.toHaveBeenCalled();
  });

  it('does not evaluate functional context when the CHANGESET does not touch source', async () => {
    const { handler, functionalContextEvaluatorService, githubRepositoryContentService, typeScriptParserService } =
      setup();
    githubRepositoryContentService.compare.mockResolvedValue([{ filename: 'README.md', status: 'modified' }]);
    typeScriptParserService.parse.mockReturnValue([]);

    await handler.handle({ analysisRunId: 'run-1' });

    expect(functionalContextEvaluatorService.evaluate).not.toHaveBeenCalled();
  });

  it('transitions to INFRASTRUCTURE_FAILURE and rethrows when the GitHub API fails', async () => {
    const { handler, githubRepositoryContentService, analysisRunsService, workspaceCleanup, processingRun } = setup();
    githubRepositoryContentService.compare.mockRejectedValue(new Error('GitHub API 503'));

    await expect(handler.handle({ analysisRunId: 'run-1' })).rejects.toThrow('GitHub API 503');

    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      processingRun,
      'INFRASTRUCTURE_FAILURE',
      expect.objectContaining({ resultSummary: 'GitHub API 503' }),
    );
    expect(workspaceCleanup).not.toHaveBeenCalled();
  });

  it('cleans up the materialized workspace even when a later step fails', async () => {
    const { handler, testTargetsRepository, workspaceCleanup } = setup();
    testTargetsRepository.insertMany.mockRejectedValue(new Error('db unavailable'));

    await expect(handler.handle({ analysisRunId: 'run-1' })).rejects.toThrow('db unavailable');

    expect(workspaceCleanup).toHaveBeenCalled();
  });
});
