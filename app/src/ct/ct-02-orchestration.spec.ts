import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import type { CreateAnalysisRunInput } from '../analysis-runs/analysis-runs.repository.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type {
  AnalysisRun,
  AnalysisSymbol,
  CodeChunk,
  ProjectVersion,
  RepositoryBinding,
} from '../generated/prisma/client.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { SnapshotAnalysisJobHandler } from '../snapshot-intelligence/snapshot-analysis-job.handler.js';
import { AnalysisRunValidationJobHandler } from '../validation/analysis-run-validation-job.handler.js';

/**
 * CT-02 (C-02, orquestación del AnalysisRun): HEAD obsoleto y target no resoluble.
 *
 * Cubierto aparte (no se duplica): CT-02-A1/A2/A5 en `analysis-runs.service.spec.ts`,
 * `snapshot-analysis-job.handler.spec.ts` y `analysis-run-validation-job.handler.spec.ts`.
 */

/** Doble que falla ante cualquier llamada: representa un colaborador que NO debe tocarse. */
function untouched(name: string, calls: string[]) {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'then') return undefined;
        return () => {
          calls.push(`${name}.${String(property)}`);
          throw new Error(`Llamada inesperada: ${name}.${String(property)}`);
        };
      },
    },
  );
}

function runInStore(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    checkId: null,
    checkPublishedAt: null,
    projectId: 'project-1',
    repositoryId: '123',
    repositoryName: 'org/repo',
    prNumber: 42,
    prTitle: 'Add feature',
    baseRef: 'develop',
    headRef: 'feature/x',
    baseSha: 'base-sha',
    headSha: 'head-a',
    draft: false,
    prState: 'OPEN',
    actorLogin: 'octocat',
    status: 'QUEUED',
    current: true,
    attemptCount: 0,
    indexMode: 'BOOTSTRAP',
    changesetBaseSha: 'base-sha',
    changesetHeadSha: 'head-a',
    indexDeltaBaseSha: null,
    projectVersionId: null,
    pullRequestCreatedAt: null,
    repositoryBindingEligible: true,
    functionalBehaviorValidated: false,
    actionRequiredCount: 0,
    generatedTestsCount: 0,
    resultSummary: null,
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as AnalysisRun;
}

describe('CT-02-A3: HEAD obsoleto', () => {
  /** Repositorio de Runs en memoria alrededor del `AnalysisRunsService` real. */
  function fixture() {
    const store: AnalysisRun[] = [];
    const repository = {
      findCurrentByPullRequest: vi.fn(async (projectId: string, repositoryId: string, prNumber: number) =>
        store.find((r) => r.current && r.projectId === projectId && r.repositoryId === repositoryId && r.prNumber === prNumber) ?? null),
      create: vi.fn(async (input: CreateAnalysisRunInput) => {
        const run = runInStore({ id: `run-${store.length + 1}`, headSha: input.headSha, changesetHeadSha: input.headSha });
        store.push(run);
        return run;
      }),
      transitionCurrent: vi.fn(async (id: string, from: string, to: string, patch: Record<string, unknown>) => {
        const run = store.find((r) => r.id === id);
        if (!run || !run.current || run.status !== from) return null;
        Object.assign(run, patch, { status: to });
        return run;
      }),
      findById: vi.fn(async (id: string) => store.find((r) => r.id === id) ?? null),
      update: vi.fn(),
    };
    const service = new AnalysisRunsService(
      repository as never,
      { findById: vi.fn() } as never,
      { require: vi.fn() } as never,
      { runChanged: vi.fn().mockResolvedValue(undefined) } as never,
    );
    return { store, repository, service };
  }

  const startInput = (headSha: string): CreateAnalysisRunInput => ({
    projectId: 'project-1',
    repositoryId: '123',
    repositoryName: 'org/repo',
    prNumber: 42,
    prTitle: 'Add feature',
    baseRef: 'develop',
    headRef: 'feature/x',
    baseSha: 'base-sha',
    headSha,
    draft: false,
    actorLogin: 'octocat',
  });

  it('CT-02-A3: un HEAD nuevo deja el Run del HEAD anterior en OBSOLETE y fuera de vigencia, sin tocar el índice', async () => {
    const { store, service } = fixture();
    const { run: first } = await service.startRunFromWebhook(startInput('head-a'));

    const { run: second, isNew } = await service.startRunFromWebhook(startInput('head-b'));

    expect(isNew).toBe(true);
    expect(store.find((r) => r.id === first.id)).toMatchObject({ status: 'OBSOLETE', current: false, headSha: 'head-a' });
    expect(second).toMatchObject({ status: 'QUEUED', current: true, headSha: 'head-b' });
    expect(store.filter((r) => r.current)).toEqual([second]);
  });

  it('CT-02-A3: el job de snapshot de un Run obsoleto no materializa, no indexa ni crea targets, símbolos o validación', async () => {
    const { store, service, repository } = fixture();
    const { run: stale } = await service.startRunFromWebhook(startInput('head-a'));
    await service.startRunFromWebhook(startInput('head-b'));
    expect(store.find((r) => r.id === stale.id)?.status).toBe('OBSOLETE');

    const calls: string[] = [];
    const handler = new SnapshotAnalysisJobHandler(
      untouched('jobsService', calls) as never,
      repository as never,
      untouched('analysisRunsService', calls) as never,
      untouched('repositoryBindingsRepository', calls) as never,
      untouched('projectVersionsRepository', calls) as never,
      untouched('codeChunksRepository', calls) as never,
      untouched('testTargetsRepository', calls) as never,
      untouched('fileDiscoveryService', calls) as never,
      untouched('typeScriptParserService', calls) as never,
      untouched('phpParserService', calls) as never,
      untouched('testTargetExtractorService', calls) as never,
      untouched('existingTestResolverService', calls) as never,
      untouched('phpExistingTestResolverService', calls) as never,
      untouched('githubRepositoryContentService', calls) as never,
      untouched('githubSnapshotMaterializerService', calls) as never,
      untouched('analysisSymbolsRepository', calls) as never,
      untouched('symbolBehaviorConstructsService', calls) as never,
      untouched('functionalContextEvaluatorService', calls) as never,
      untouched('analysisRunChecksService', calls) as never,
      untouched('embeddingProvider', calls) as never,
      untouched('objectStorageService', calls) as never,
    );

    await expect(handler.handle({ analysisRunId: stale.id })).resolves.toBeUndefined();

    expect(calls).toEqual([]);
    expect(store.find((r) => r.id === stale.id)).toMatchObject({ status: 'OBSOLETE', projectVersionId: null });
  });

  it('CT-02-A3: el job de Validation de un Run obsoleto no genera pruebas ni llama a LLM, Sandbox ni a la persistencia de propuestas', async () => {
    const { store, service, repository } = fixture();
    const { run: stale } = await service.startRunFromWebhook(startInput('head-a'));
    await service.startRunFromWebhook(startInput('head-b'));
    // Aun con un projectVersionId asignado antes de quedar obsoleto, no hay generación.
    store.find((r) => r.id === stale.id)!.projectVersionId = 'version-1';

    const calls: string[] = [];
    const handler = new AnalysisRunValidationJobHandler(
      untouched('jobsService', calls) as never,
      repository as never,
      untouched('analysisRunsService', calls) as never,
      untouched('analysisSymbolsRepository', calls) as never,
      untouched('repositoryBindingsRepository', calls) as never,
      untouched('projectVersionsRepository', calls) as never,
      untouched('testTargetsRepository', calls) as never,
      untouched('githubSnapshotMaterializerService', calls) as never,
      untouched('retrievalService', calls) as never,
      untouched('contextBuilder', calls) as never,
      untouched('functionalRulesRetriever', calls) as never,
      untouched('phpDependencyContextService', calls) as never,
      untouched('promptBuilder', calls) as never,
      untouched('testFileMergeService', calls) as never,
      untouched('sandboxExecutionService', calls) as never,
      untouched('objectStorageService', calls) as never,
      untouched('generatedTestProposalsRepository', calls) as never,
      untouched('analysisRunChecksService', calls) as never,
      untouched('llmProvider', calls) as never,
      untouched('analysisTraceRepository', calls) as never,
    );

    await expect(handler.handle({ analysisRunId: stale.id }, 'job-1')).resolves.toBeUndefined();

    expect(calls).toEqual([]);
  });

  it('CT-02-A3: un resultado tardío de un Run obsoleto no lo reabre ni lo completa', async () => {
    const { store, service, repository } = fixture();
    const { run: stale } = await service.startRunFromWebhook(startInput('head-a'));
    await service.startProcessing(stale);
    await service.startRunFromWebhook(startInput('head-b'));
    const obsolete = store.find((r) => r.id === stale.id)!;
    expect(obsolete.status).toBe('OBSOLETE');
    repository.transitionCurrent.mockClear();

    const late = await service.completeRunFromSystem(obsolete, 'SUCCESS', { resultSummary: 'tarde' });

    expect(late).toBeNull();
    expect(repository.transitionCurrent).not.toHaveBeenCalled();
    expect(obsolete).toMatchObject({ status: 'OBSOLETE', current: false, resultSummary: null });
  });
});

describe('CT-02-A4: target no resoluble dentro de Validation', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ct-02-validation-'));
  afterAll(() => rmSync(workspaceDir, { recursive: true, force: true }));

  function symbol(id: string, name: string): AnalysisSymbol {
    return {
      id,
      analysisRunId: 'run-1',
      language: 'TYPESCRIPT',
      kind: 'METHOD',
      qualifiedName: `Thing.${name}`,
      filePath: 'src/thing.ts',
      changeKind: 'DIRECTLY_CHANGED',
      behaviorConstructs: null,
      createdAt: new Date(),
    } as AnalysisSymbol;
  }

  function chunk(name: string): CodeChunk {
    return {
      id: `chunk-${name}`,
      projectVersionId: 'version-1',
      filePath: 'src/thing.ts',
      symbolKind: 'METHOD',
      symbolName: name,
      parentSymbolName: 'Thing',
      startLine: 1,
      endLine: 3,
      content: `${name}() {}`,
      importsUsed: [],
      tokenCount: 5,
      partIndex: 1,
      partsTotal: 1,
      createdAt: new Date(),
    } as CodeChunk;
  }

  const generationContext = {
    target: { filePath: 'src/thing.ts', symbolName: 'Thing', methodName: 'x', targetType: 'METHOD', content: 'x() {}' },
    relatedChunks: [],
    functionalRules: [],
    metadata: { language: 'typescript', framework: 'JEST' },
    retrievedChunks: 1,
    selectedChunks: 1,
    contextTokens: 0,
    audit: {
      functionalRules: { retrieved: 0, selected: 0, tokenCount: 0, omitted: [] },
      target: { chunkIds: [], chunks: [], tokenCount: 0 },
      candidates: [],
      configuration: { minimumScore: 0, topK: 10, maxContextTokens: 1000, semanticWeight: 0.7, structuralWeight: 0.3 },
    },
  };

  const passed = {
    status: 'COMPLETED',
    facts: {
      runner: 'JEST', compiled: true, executed: true, passed: true, totalTests: 1, passedTests: 1,
      failedTests: 0, skippedTests: 0, testCases: [], testCasesTruncated: false,
    },
    failure: null,
    stageDurations: [],
    executionId: 'exec-1',
    executionProfile: 'NODE_TYPESCRIPT',
    requestId: 'request-1',
    correlationId: 'correlation-1',
    durationMs: 7,
  };

  function setup() {
    // Solo `ok` y `ok2` existen en el índice; `missing` no tiene chunk (target no resoluble).
    const indexed = new Map([['ok', chunk('ok')], ['ok2', chunk('ok2')]]);
    const codeChunksRepository = {
      findBySymbol: vi.fn(async (_v: string, _f: string, _k: unknown, name: string) => {
        const found = indexed.get(name);
        return found ? [found] : [];
      }),
      findSimilarByEmbedding: vi.fn().mockResolvedValue([]),
      findByProjectVersion: vi.fn().mockResolvedValue([...indexed.values()]),
    };
    const retrievalService = new RetrievalService(codeChunksRepository as never);
    const analysisRunsService = {
      completeRunFromSystem: vi.fn(async (run: AnalysisRun, status: string, patch: object) => ({ ...run, status, ...patch })),
    };
    const proposals = { upsertForSymbol: vi.fn().mockResolvedValue({ id: 'proposal-1' }) };
    const trace = {
      upsertRetrieval: vi.fn().mockResolvedValue({ id: 'retrieval-1' }),
      upsertContext: vi.fn().mockResolvedValue({ id: 'context-1' }),
      upsertExecution: vi.fn().mockResolvedValue({ id: 'execution-1' }),
    };
    const llmProvider = { generate: vi.fn().mockResolvedValue({ content: 'test content', inputTokens: 1, outputTokens: 1 }) };
    const sandbox = { execute: vi.fn().mockResolvedValue(passed) };
    const checks = { publishForRun: vi.fn().mockResolvedValue(undefined) };
    const symbols = [symbol('s-ok', 'ok'), symbol('s-missing', 'missing'), symbol('s-ok2', 'ok2')];

    const handler = new AnalysisRunValidationJobHandler(
      { registerHandler: vi.fn() } as never,
      {
        findById: vi.fn().mockResolvedValue({
          id: 'run-1', projectId: 'project-1', repositoryId: '123', repositoryName: 'org/repo', prNumber: 42,
          headSha: 'head-sha', status: 'PROCESSING', projectVersionId: 'version-1', attemptCount: 0,
        } as AnalysisRun),
      } as never,
      analysisRunsService as never,
      { findByAnalysisRun: vi.fn().mockResolvedValue(symbols) } as never,
      { findForRun: vi.fn().mockResolvedValue({ id: 'binding-1', installationId: '999', repositoryName: 'org/repo' } as RepositoryBinding) } as never,
      { findById: vi.fn().mockResolvedValue({ id: 'version-1', detectedFramework: 'JEST', effectiveProjectRoot: '.' } as ProjectVersion) } as never,
      { findByProjectVersion: vi.fn().mockResolvedValue([]) } as never,
      {
        materialize: vi.fn().mockResolvedValue({ dir: workspaceDir, cleanup: vi.fn().mockResolvedValue(undefined) }),
        addSandboxFixtures: vi.fn().mockResolvedValue({ requested: 0, included: 0, bytes: 0, omitted: {} }),
      } as never,
      retrievalService as never,
      { build: vi.fn().mockReturnValue(generationContext) } as never,
      { retrieve: vi.fn().mockResolvedValue([]) } as never,
      { resolve: vi.fn().mockResolvedValue(null) } as never,
      { build: vi.fn().mockReturnValue('prompt') } as never,
      { applyCreate: vi.fn((content: string) => `created:${content}`), applyMerge: vi.fn() } as never,
      sandbox as never,
      { put: vi.fn().mockResolvedValue(undefined) } as never,
      proposals as never,
      checks as never,
      llmProvider as never,
      trace as never,
    );
    return { handler, proposals, trace, llmProvider, sandbox, analysisRunsService, checks, codeChunksRepository };
  }

  it('CT-02-A4: un símbolo cuyo target no se resuelve queda HELD con estado explícito, sin excepción, y los demás símbolos siguen', async () => {
    const { handler, proposals, trace, llmProvider, sandbox, analysisRunsService, checks } = setup();

    // No lanza: el fallo del target no aborta el job.
    await expect(handler.handle({ analysisRunId: 'run-1' }, 'job-1')).resolves.toBeUndefined();

    // Una propuesta por símbolo, en orden: el no resoluble no impidió procesar el siguiente.
    const saved = proposals.upsertForSymbol.mock.calls.map(([input]) => input);
    expect(saved).toHaveLength(3);
    expect(saved.map((p) => p.status)).toEqual(['AVAILABLE', 'HELD', 'AVAILABLE']);
    const held = saved[1];
    expect(held).toMatchObject({ status: 'HELD', contextId: null });
    expect(held.failureSummary).toContain('No se encontró un chunk indexado');
    expect(held.failureSummary).toContain('missing');

    // El símbolo no resoluble no llegó al LLM, al Sandbox ni a la evidencia de recuperación.
    expect(llmProvider.generate).toHaveBeenCalledTimes(2);
    expect(sandbox.execute).toHaveBeenCalledTimes(2);
    expect(trace.upsertRetrieval).toHaveBeenCalledTimes(2);

    // Estado explícito del Run: fallo técnico de generación (no INFRASTRUCTURE_FAILURE), con los 2 válidos contados.
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledTimes(1);
    expect(analysisRunsService.completeRunFromSystem).toHaveBeenCalledWith(
      expect.anything(),
      'TECHNICAL_GENERATION_FAILURE',
      expect.objectContaining({ generatedTestsCount: 2, functionalBehaviorValidated: false }),
    );
    expect(checks.publishForRun).toHaveBeenCalledTimes(1);
  });

  it('CT-02-A4: la causa del símbolo no resoluble es el código UNRESOLVABLE_TARGET del RetrievalService real', async () => {
    const { codeChunksRepository } = setup();
    const retrieval = new RetrievalService(codeChunksRepository as never);

    await expect(
      retrieval.retrieve('version-1', { filePath: 'src/thing.ts', symbolName: 'Thing', methodName: 'missing', targetType: 'METHOD' }),
    ).rejects.toMatchObject({ code: ErrorCode.UNRESOLVABLE_TARGET });
  });
});
