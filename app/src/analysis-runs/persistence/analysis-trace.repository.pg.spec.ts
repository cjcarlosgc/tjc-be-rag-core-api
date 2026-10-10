import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { CodeChunk } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AnalysisTraceRepository } from './analysis-trace.repository.js';
import { AnalysisRunTraceService } from '../analysis-run-trace.service.js';
import { GeneratedTestProposalsRepository } from '../../validation/generated-test-proposals.repository.js';
import { ContextBuilder } from '../../retrieval/context-builder.service.js';
import { countFunctionalRuleTokens } from '../../retrieval/functional-rule-format.js';
import type { FunctionalRule, RetrievalTarget } from '../../retrieval/generation-context.js';
import type { RetrievalResult } from '../../retrieval/retrieval.service.js';
import { DEFAULT_VECTOR_TOP_K } from '../../retrieval/retrieval.service.js';
import { toAnalysisContextEvidence, toRetrievalEvidence } from '../analysis-trace-evidence.util.js';

/**
 * WI-CORE-026 (cortes A, B y C): SQL real de `analysis_retrievals`, `analysis_contexts`, la FK
 * `generated_test_proposals.contextId`, el upsert de propuestas por símbolo y `analysis_run_executions`
 * (idempotencia por `(proposalId, attempt)`), con el `ContextBuilder` real y la omisión por `TOKEN_BUDGET`.
 * Necesita un PostgreSQL LOCAL descartable con las migraciones aplicadas (incluida
 * `20261009140000_analysis_trace_retrieval_context`). Sin `ANALYSIS_TRACE_TEST_DATABASE_URL` se omite;
 * la suite nunca toca Supabase ni una base real. No borra filas: cada caso usa un Run nuevo.
 *
 *   ANALYSIS_TRACE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/rag_trace_test npx vitest run src/analysis-runs/persistence/analysis-trace.repository.pg.spec.ts
 */
const url = process.env.ANALYSIS_TRACE_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

const TARGET: RetrievalTarget = {
  filePath: 'src/thing.ts',
  symbolName: 'Thing',
  methodName: 'doIt',
  targetType: 'METHOD',
};

function chunk(overrides: Partial<CodeChunk>): CodeChunk {
  return {
    id: 'chunk-target',
    filePath: 'src/thing.ts',
    symbolKind: 'METHOD',
    symbolName: 'Thing',
    parentSymbolName: 'Thing',
    startLine: 1,
    endLine: 3,
    content: 'SECRETO_DE_CODIGO',
    tokenCount: 0,
    ...overrides,
  } as CodeChunk;
}

function rule(knowledgeId: string): FunctionalRule {
  return {
    knowledgeId,
    scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    normalizedRule: 'TEXTO_REGLA_NO_PERSISTIDO',
    scope: 'METHOD',
    targetRef: 'src/thing.ts::Thing.doIt',
    source: 'HUMAN_ANSWER',
    provenance: { confirmedByUserId: 'user-1', confirmedRole: 'ADMIN', originHeadSha: 'head-1', sourceRef: 'ref-1' },
  };
}

describe.skipIf(!url)('AnalysisTraceRepository against a local PostgreSQL (WI-CORE-026, corte A)', () => {
  let prisma: PrismaClient;
  let repository: AnalysisTraceRepository;
  let proposals: GeneratedTestProposalsRepository;

  beforeAll(() => {
    if (!isLocal) {
      throw new Error('ANALYSIS_TRACE_TEST_DATABASE_URL debe apuntar a localhost.');
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    repository = new AnalysisTraceRepository(prisma as unknown as PrismaService);
    proposals = new GeneratedTestProposalsRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createRunWithSymbol() {
    const project = await prisma.project.create({ data: { name: `pg-trace-${crypto.randomUUID()}` } });
    const version = await prisma.projectVersion.create({ data: { projectId: project.id } });
    const run = await prisma.analysisRun.create({
      data: {
        projectId: project.id,
        repositoryId: 'repo-1',
        repositoryName: 'owner/repo',
        prNumber: 1,
        prTitle: 'pg trace',
        baseRef: 'main',
        headRef: 'feature',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        changesetBaseSha: 'a'.repeat(40),
        changesetHeadSha: 'b'.repeat(40),
        projectVersionId: version.id,
      },
    });
    const symbol = await prisma.analysisSymbol.create({
      data: {
        analysisRunId: run.id,
        language: 'TYPESCRIPT',
        kind: 'METHOD',
        qualifiedName: 'Thing.doIt',
        filePath: 'src/thing.ts',
        changeKind: 'DIRECTLY_CHANGED',
      },
    });

    return { projectId: project.id, runId: run.id, symbolId: symbol.id };
  }

  /** Construye retrieval y contexto con el `ContextBuilder` real: una regla entra y otra queda por presupuesto. */
  function buildRealContext(rules: FunctionalRule[], budgetRules: number) {
    const target = chunk({ id: 'chunk-target', tokenCount: 0 });
    const near = chunk({ id: 'chunk-near', filePath: 'src/near.ts', symbolName: 'near', parentSymbolName: null, tokenCount: 4 });
    const retrieval: RetrievalResult = {
      targetChunks: [target],
      candidates: [{ chunk: near, semanticScore: 0.9, structuralMatch: null }],
    };
    const budget = rules.slice(0, budgetRules).reduce((sum, item) => sum + countFunctionalRuleTokens(item), 0) + 4;
    const builder = new ContextBuilder({
      get: (key: string, fallback: unknown) => (key === 'RETRIEVAL_MAX_CONTEXT_TOKENS' ? budget : fallback),
    } as never);

    return { retrieval, context: builder.build(retrieval, TARGET, { framework: 'JEST' }, {}, rules), budget };
  }

  it('persists the context with rule ids in retriever order, counts and the TOKEN_BUDGET omission, without rule text or provenance', async () => {
    const { runId, symbolId } = await createRunWithSymbol();
    const rules = [rule('rule-first'), rule('rule-second')];
    const { retrieval, context, budget } = buildRealContext(rules, 1);
    const retrievalEvidence = toRetrievalEvidence(retrieval, DEFAULT_VECTOR_TOP_K);
    const contextEvidence = toAnalysisContextEvidence(context);

    const storedRetrieval = await repository.upsertRetrieval({
      analysisRunId: runId,
      analysisSymbolId: symbolId,
      mode: retrievalEvidence.config.mode,
      config: retrievalEvidence.config,
      candidates: retrievalEvidence.candidates,
    });
    const storedContext = await repository.upsertContext({
      analysisRunId: runId,
      analysisSymbolId: symbolId,
      retrievalId: storedRetrieval.id,
      selectedChunkIds: contextEvidence.selectedChunkIds,
      discardedChunkIds: contextEvidence.discardedChunkIds,
      selectedTokens: contextEvidence.selectedTokens,
      tokenBudget: contextEvidence.tokenBudget,
      functionalRuleIds: contextEvidence.functionalRules.functionalRuleIds,
      functionalRulesRetrieved: contextEvidence.functionalRules.retrieved,
      functionalRulesSelected: contextEvidence.functionalRules.selected,
      functionalRulesOmitted: contextEvidence.functionalRules.omitted.length,
      omittedFunctionalRules: contextEvidence.functionalRules.omitted,
    });

    const row = await prisma.analysisContext.findUniqueOrThrow({
      where: { id: storedContext.id },
    });
    expect(row).toMatchObject({
      analysisRunId: runId,
      analysisSymbolId: symbolId,
      retrievalId: storedRetrieval.id,
      selectedChunkIds: ['chunk-near'],
      discardedChunkIds: [],
      tokenBudget: budget,
      functionalRuleIds: ['rule-first'],
      functionalRulesRetrieved: 2,
      functionalRulesSelected: 1,
      functionalRulesOmitted: 1,
      omittedFunctionalRules: [{ knowledgeId: 'rule-second', reason: 'TOKEN_BUDGET' }],
    });
    expect(row.selectedTokens).toBe(context.contextTokens);

    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('TEXTO_REGLA_NO_PERSISTIDO');
    expect(serialized).not.toContain('confirmedRole');
    expect(serialized).not.toContain('user-1');
    expect(serialized).not.toContain('SECRETO_DE_CODIGO');

    const storedRetrievalRow = await prisma.analysisRetrieval.findUniqueOrThrow({ where: { id: storedRetrieval.id } });
    expect(storedRetrievalRow.mode).toBe('SE');
    expect(JSON.stringify(storedRetrievalRow.candidates)).not.toContain('SECRETO_DE_CODIGO');
  });

  it('links the context_id into a proposal and keeps one retrieval and one context per target when the job retries', async () => {
    const { runId, symbolId } = await createRunWithSymbol();
    const { retrieval, context } = buildRealContext([rule('rule-only')], 1);
    const contextEvidence = toAnalysisContextEvidence(context);
    const persist = async () => {
      const storedRetrieval = await repository.upsertRetrieval({
        analysisRunId: runId,
        analysisSymbolId: symbolId,
        mode: 'SE',
        config: { mode: 'SE', vectorTopK: DEFAULT_VECTOR_TOP_K, targetChunkIds: [] },
        candidates: [],
      });
      return repository.upsertContext({
        analysisRunId: runId,
        analysisSymbolId: symbolId,
        retrievalId: storedRetrieval.id,
        selectedChunkIds: contextEvidence.selectedChunkIds,
        discardedChunkIds: contextEvidence.discardedChunkIds,
        selectedTokens: contextEvidence.selectedTokens,
        tokenBudget: contextEvidence.tokenBudget,
        functionalRuleIds: contextEvidence.functionalRules.functionalRuleIds,
        functionalRulesRetrieved: contextEvidence.functionalRules.retrieved,
        functionalRulesSelected: contextEvidence.functionalRules.selected,
        functionalRulesOmitted: contextEvidence.functionalRules.omitted.length,
        omittedFunctionalRules: contextEvidence.functionalRules.omitted,
      });
    };

    const first = await persist();
    const retry = await persist();

    expect(retry.id).toBe(first.id);
    expect(retrieval.targetChunks).toHaveLength(1);
    expect(await prisma.analysisContext.count({ where: { analysisRunId: runId } })).toBe(1);
    expect(await prisma.analysisRetrieval.count({ where: { analysisRunId: runId } })).toBe(1);

    const proposal = await prisma.generatedTestProposal.create({
      data: {
        analysisRunId: runId,
        relativePath: 'src/thing.spec.ts',
        symbolLanguage: 'TYPESCRIPT',
        symbolKind: 'METHOD',
        qualifiedName: 'Thing.doIt',
        filePath: 'src/thing.ts',
        storageKey: `analysis-runs/${runId}/proposals/${crypto.randomUUID()}`,
        contentSha256: 'c'.repeat(64),
        status: 'AVAILABLE',
        contextId: retry.id,
      },
    });

    const stored = await prisma.generatedTestProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: { context: true },
    });
    expect(stored.contextId).toBe(first.id);
    expect(stored.context?.functionalRuleIds).toEqual(['rule-only']);
  });

  it('rejects a proposal that references a context_id that does not exist', async () => {
    const { runId } = await createRunWithSymbol();

    await expect(
      prisma.generatedTestProposal.create({
        data: {
          analysisRunId: runId,
          relativePath: 'src/thing.spec.ts',
          symbolLanguage: 'TYPESCRIPT',
          symbolKind: 'METHOD',
          qualifiedName: 'Thing.doIt',
          filePath: 'src/thing.ts',
          storageKey: `analysis-runs/${runId}/proposals/${crypto.randomUUID()}`,
          contentSha256: 'd'.repeat(64),
          status: 'HELD',
          contextId: 'context-does-not-exist',
        },
      }),
    ).rejects.toThrow();
  });

  describe('propuestas por símbolo y ejecuciones (WI-CORE-026, corte B)', () => {
    const proposalInput = (analysisRunId: string, analysisSymbolId: string, overrides: Record<string, unknown> = {}) => ({
      analysisRunId,
      analysisSymbolId,
      relativePath: 'src/thing.spec.ts',
      symbolLanguage: 'TYPESCRIPT' as const,
      symbolKind: 'METHOD' as const,
      qualifiedName: 'Thing.doIt',
      filePath: 'src/thing.ts',
      storageKey: `analysis-runs/${analysisRunId}/proposals/${crypto.randomUUID()}`,
      contentSha256: 'e'.repeat(64),
      status: 'HELD' as const,
      contextId: null,
      failureSummary: 'fallo previo',
      ...overrides,
    });

    it('upserts the proposal by (analysisRunId, analysisSymbolId): a retry keeps the id, updates the status and clears the old failure', async () => {
      const { runId, symbolId } = await createRunWithSymbol();

      const first = await proposals.upsertForSymbol(proposalInput(runId, symbolId));
      const retry = await proposals.upsertForSymbol(
        proposalInput(runId, symbolId, { status: 'AVAILABLE', failureSummary: null, contentSha256: 'f'.repeat(64) }),
      );

      expect(retry.id).toBe(first.id);
      expect(await prisma.generatedTestProposal.count({ where: { analysisRunId: runId } })).toBe(1);
      const stored = await prisma.generatedTestProposal.findUniqueOrThrow({ where: { id: first.id } });
      expect(stored).toMatchObject({ status: 'AVAILABLE', failureSummary: null, analysisSymbolId: symbolId });
    });

    it('keeps one execution per (proposalId, attempt): repeating an attempt updates it, a new attempt adds a row ordered by attempt', async () => {
      const { runId, symbolId } = await createRunWithSymbol();
      const proposal = await proposals.upsertForSymbol(proposalInput(runId, symbolId));
      const base = { analysisRunId: runId, proposalId: proposal.id, executionProfile: 'NODE_TYPESCRIPT', outcome: 'SUCCESS' };

      await repository.upsertExecution({ ...base, executionId: 'exec-a1', attempt: 1 });
      await repository.upsertExecution({ ...base, executionId: 'exec-a1-retry', attempt: 1, outcome: 'BEHAVIORAL_MISMATCH' });
      await repository.upsertExecution({ ...base, executionId: 'exec-a2', attempt: 2 });

      const rows = await prisma.analysisRunExecution.findMany({
        where: { proposalId: proposal.id },
        orderBy: { attempt: 'asc' },
      });
      expect(rows.map((row) => [row.attempt, row.executionId, row.outcome])).toEqual([
        [1, 'exec-a1-retry', 'BEHAVIORAL_MISMATCH'],
        [2, 'exec-a2', 'SUCCESS'],
      ]);
    });

    it('stores the sandbox evidence as JSON and leaves unobserved values as SQL NULL, never 0 (WI-CORE-027, DEC-EVID-003)', async () => {
      const { runId, symbolId } = await createRunWithSymbol();
      const proposal = await proposals.upsertForSymbol(
        proposalInput(runId, symbolId, {
          generation: { provider: 'openai', model: 'gpt-x', modelVersion: null, reasoningEffort: null, inputTokens: 3, outputTokens: 4, durationMs: 5 },
        }),
      );
      const facts = {
        executionProfile: 'NODE_TYPESCRIPT',
        runner: 'JEST',
        compiled: true,
        executed: true,
        passed: false,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCasesTruncated: false,
        failureStage: null,
        failureCategory: 'TEST_ASSERTION',
        failureCode: null,
        failureMessage: null,
      } as const;

      await repository.upsertExecution({
        analysisRunId: runId,
        proposalId: proposal.id,
        executionId: 'exec-ev-1',
        attempt: 1,
        executionProfile: 'NODE_TYPESCRIPT',
        outcome: 'BEHAVIORAL_MISMATCH',
        requestId: 'req-ev-1',
        correlationId: 'corr-ev-1',
        durationMs: 0,
        facts,
        failure: null,
      });
      await repository.upsertExecution({ analysisRunId: runId, proposalId: proposal.id, executionId: 'exec-ev-2', attempt: 2, executionProfile: 'NODE_TYPESCRIPT', outcome: 'TECHNICAL_GENERATION_FAILURE' });

      const [first, second] = await prisma.analysisRunExecution.findMany({ where: { proposalId: proposal.id }, orderBy: { attempt: 'asc' } });
      expect(first).toMatchObject({ requestId: 'req-ev-1', correlationId: 'corr-ev-1', durationMs: 0, failure: null });
      expect(first.facts).toEqual(facts);
      expect(second).toMatchObject({ requestId: null, correlationId: null, durationMs: null, facts: null, failure: null });
      const stored = await prisma.generatedTestProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      expect(stored.generation).toEqual({ provider: 'openai', model: 'gpt-x', modelVersion: null, reasoningEffort: null, inputTokens: 3, outputTokens: 4, durationMs: 5 });
    });

    it('rejects an execution that references a proposal which does not exist', async () => {
      const { runId } = await createRunWithSymbol();

      await expect(
        repository.upsertExecution({
          analysisRunId: runId,
          proposalId: 'proposal-does-not-exist',
          executionId: 'exec-x',
          attempt: 1,
          executionProfile: 'NODE_TYPESCRIPT',
          outcome: 'SUCCESS',
        }),
      ).rejects.toThrow();
    });
  });

  describe('lectura del trace sobre filas reales (WI-CORE-026, corte C)', () => {
    it('reads the checkId column persisted on the run (corte D) into publication', async () => {
      const { runId } = await createRunWithSymbol();
      await prisma.analysisRun.update({ where: { id: runId }, data: { status: 'SUCCESS', checkId: 'chk-pg-1' } });
      const run = await prisma.analysisRun.findUniqueOrThrow({ where: { id: runId } });
      const service = new AnalysisRunTraceService(
        { getById: async () => run } as never,
        { findByAnalysisRun: (id: string) => prisma.analysisSymbol.findMany({ where: { analysisRunId: id } }) } as never,
        repository as never,
      );

      const trace = await service.getTrace(runId, 'user-1');

      expect(run.checkId).toBe('chk-pg-1');
      expect(trace.publication).toMatchObject({ status: 'PRESENT', checkId: 'chk-pg-1', freshness: null });
    });

    /** Servicio de trace sobre el repositorio real: el Run se relee de la base para cada caso. */
    async function traceOf(runId: string) {
      const run = await prisma.analysisRun.findUniqueOrThrow({ where: { id: runId } });
      const service = new AnalysisRunTraceService(
        { getById: async () => run } as never,
        { findByAnalysisRun: (id: string) => prisma.analysisSymbol.findMany({ where: { analysisRunId: id } }) } as never,
        repository as never,
      );

      return service.getTrace(runId, 'user-1');
    }

    it('reports publication PRESENT with checkId null when GitHub answered 204 and the mark was persisted (DEC-TRACE-002)', async () => {
      const { runId } = await createRunWithSymbol();
      await prisma.analysisRun.update({
        where: { id: runId },
        data: { status: 'SUCCESS', checkId: null, checkPublishedAt: new Date('2026-10-09T10:00:00Z') },
      });

      const trace = await traceOf(runId);

      expect(trace.publication).toEqual({
        status: 'PRESENT',
        checkId: null,
        companionBranch: null,
        companionPullRequestUrl: null,
        sourceHeadSha: null,
        freshness: null,
      });
    });

    it('reports publication PRESENT with the checkId and the mark when GitHub returned an id', async () => {
      const { runId } = await createRunWithSymbol();
      await prisma.analysisRun.update({
        where: { id: runId },
        data: { status: 'SUCCESS', checkId: 'chk-pg-2', checkPublishedAt: new Date('2026-10-09T10:00:00Z') },
      });

      const trace = await traceOf(runId);

      expect(trace.publication).toMatchObject({ status: 'PRESENT', checkId: 'chk-pg-2', freshness: null });
    });

    it('reports publication PRESENT from a TestPublication alone, without any Check', async () => {
      const { runId } = await createRunWithSymbol();
      await prisma.analysisRun.update({ where: { id: runId }, data: { status: 'SUCCESS' } });
      await prisma.testPublication.create({
        data: {
          analysisRunId: runId,
          proposalIds: [],
          sourceHeadSha: 'b'.repeat(40),
          status: 'PUBLISHED',
          branchName: 'rag/only-publication',
          companionPullRequestUrl: 'https://github.com/owner/repo/pull/10',
        },
      });

      const trace = await traceOf(runId);

      expect(trace.publication).toEqual({
        status: 'PRESENT',
        checkId: null,
        companionBranch: 'rag/only-publication',
        companionPullRequestUrl: 'https://github.com/owner/repo/pull/10',
        sourceHeadSha: 'b'.repeat(40),
        freshness: 'CURRENT',
      });
    });

    it('reports publication NOT_APPLICABLE when there is neither a Check mark, a checkId nor a TestPublication', async () => {
      const { runId } = await createRunWithSymbol();
      await prisma.analysisRun.update({ where: { id: runId }, data: { status: 'SUCCESS' } });

      const trace = await traceOf(runId);

      expect(trace.publication).toEqual({
        status: 'NOT_APPLICABLE',
        checkId: null,
        companionBranch: null,
        companionPullRequestUrl: null,
        sourceHeadSha: null,
        freshness: null,
      });
    });

    it('exposes the context as status, contextId and functionalRuleIds only, from the full stored row (INTEROP §6.16)', async () => {
      const { runId, symbolId } = await createRunWithSymbol();
      await prisma.analysisRun.update({ where: { id: runId }, data: { status: 'SUCCESS' } });
      const storedRetrieval = await repository.upsertRetrieval({
        analysisRunId: runId,
        analysisSymbolId: symbolId,
        mode: 'SE',
        config: { mode: 'SE', vectorTopK: DEFAULT_VECTOR_TOP_K, targetChunkIds: [] },
        candidates: [],
      });
      const storedContext = await repository.upsertContext({
        analysisRunId: runId,
        analysisSymbolId: symbolId,
        retrievalId: storedRetrieval.id,
        selectedChunkIds: ['chunk-target'],
        discardedChunkIds: ['chunk-near'],
        selectedTokens: 5,
        tokenBudget: 10,
        functionalRuleIds: ['rule-1'],
        functionalRulesRetrieved: 3,
        functionalRulesSelected: 1,
        functionalRulesOmitted: 2,
        omittedFunctionalRules: [{ knowledgeId: 'rule-omitted-secret', reason: 'TOKEN_BUDGET' }],
      });
      const stored = await prisma.analysisContext.findUniqueOrThrow({ where: { id: storedContext.id } });
      expect(stored).toMatchObject({ functionalRulesRetrieved: 3, functionalRulesOmitted: 2 });

      const trace = await traceOf(runId);

      expect(trace.targets[0]!.context).toEqual({ status: 'PRESENT', contextId: storedContext.id, functionalRuleIds: ['rule-1'] });
      const serialized = JSON.stringify(trace);
      expect(serialized).not.toContain('omittedFunctionalRules');
      expect(serialized).not.toContain('functionalRulesRetrieved');
      expect(serialized).not.toContain('functionalRulesSelected');
      expect(serialized).not.toContain('functionalRulesOmitted');
      expect(serialized).not.toContain('rule-omitted-secret');
      expect(serialized).not.toContain('knowledgeId');
    });

    it('builds the INTEROP §6.16 chain from the persisted rows of a finished run', async () => {
      const { runId, symbolId } = await createRunWithSymbol();
      await prisma.analysisRun.update({ where: { id: runId }, data: { status: 'SUCCESS' } });
      const run = await prisma.analysisRun.findUniqueOrThrow({ where: { id: runId } });

      const storedRetrieval = await repository.upsertRetrieval({
        analysisRunId: runId,
        analysisSymbolId: symbolId,
        mode: 'SE',
        config: { mode: 'SE', vectorTopK: DEFAULT_VECTOR_TOP_K, targetChunkIds: [] },
        candidates: [],
      });
      const storedContext = await repository.upsertContext({
        analysisRunId: runId,
        analysisSymbolId: symbolId,
        retrievalId: storedRetrieval.id,
        selectedChunkIds: [],
        discardedChunkIds: [],
        selectedTokens: 1,
        tokenBudget: 10,
        functionalRuleIds: ['rule-1'],
        functionalRulesRetrieved: 1,
        functionalRulesSelected: 1,
        functionalRulesOmitted: 0,
        omittedFunctionalRules: [],
      });
      const proposal = await proposals.upsertForSymbol({
        analysisRunId: runId,
        analysisSymbolId: symbolId,
        relativePath: 'src/thing.spec.ts',
        symbolLanguage: 'TYPESCRIPT',
        symbolKind: 'METHOD',
        qualifiedName: 'Thing.doIt',
        filePath: 'src/thing.ts',
        storageKey: `analysis-runs/${runId}/proposals/${crypto.randomUUID()}`,
        contentSha256: '9'.repeat(64),
        status: 'AVAILABLE',
        contextId: storedContext.id,
        failureSummary: null,
      });
      await repository.upsertExecution({ analysisRunId: runId, proposalId: proposal.id, executionId: 'exec-2', attempt: 2, executionProfile: 'NODE_TYPESCRIPT', outcome: 'SUCCESS' });
      await repository.upsertExecution({ analysisRunId: runId, proposalId: proposal.id, executionId: 'exec-1', attempt: 1, executionProfile: 'NODE_TYPESCRIPT', outcome: 'BEHAVIORAL_MISMATCH' });
      await prisma.testPublication.create({
        data: {
          analysisRunId: runId,
          proposalIds: [proposal.id],
          sourceHeadSha: 'b'.repeat(40),
          status: 'PUBLISHED',
          branchName: 'rag/x',
          companionPullRequestUrl: 'https://github.com/owner/repo/pull/9',
        },
      });

      const service = new AnalysisRunTraceService(
        { getById: async () => run } as never,
        { findByAnalysisRun: (id: string) => prisma.analysisSymbol.findMany({ where: { analysisRunId: id } }) } as never,
        repository as never,
      );
      const trace = await service.getTrace(runId, 'user-1');

      expect(trace).toMatchObject({
        analysisRunId: runId,
        repositoryName: 'owner/repo',
        pullRequestNumber: 1,
        headSha: 'b'.repeat(40),
        changeset: { status: 'PRESENT', targetCount: 1 },
      });
      expect(trace.targets).toHaveLength(1);
      expect(trace.targets[0]).toMatchObject({
        symbol: { qualifiedName: 'Thing.doIt', filePath: 'src/thing.ts', kind: 'METHOD' },
        retrieval: { status: 'PRESENT', retrievalId: storedRetrieval.id },
        context: { status: 'PRESENT', contextId: storedContext.id, functionalRuleIds: ['rule-1'] },
        generation: { status: 'PRESENT', proposalIds: [proposal.id] },
        executions: {
          status: 'PRESENT',
          items: [
            { executionId: 'exec-1', proposalId: proposal.id, attempt: 1, executionProfile: 'NODE_TYPESCRIPT', outcome: 'BEHAVIORAL_MISMATCH' },
            { executionId: 'exec-2', proposalId: proposal.id, attempt: 2, executionProfile: 'NODE_TYPESCRIPT', outcome: 'SUCCESS' },
          ],
        },
      });
      expect(trace.publication).toEqual({
        status: 'PRESENT',
        checkId: null,
        companionBranch: 'rag/x',
        companionPullRequestUrl: 'https://github.com/owner/repo/pull/9',
        sourceHeadSha: 'b'.repeat(40),
        freshness: 'CURRENT',
      });
    });
  });
});
