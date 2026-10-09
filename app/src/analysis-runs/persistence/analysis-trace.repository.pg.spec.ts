import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { CodeChunk } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AnalysisTraceRepository } from './analysis-trace.repository.js';
import { ContextBuilder } from '../../retrieval/context-builder.service.js';
import { countFunctionalRuleTokens } from '../../retrieval/functional-rule-format.js';
import type { FunctionalRule, RetrievalTarget } from '../../retrieval/generation-context.js';
import type { RetrievalResult } from '../../retrieval/retrieval.service.js';
import { DEFAULT_VECTOR_TOP_K } from '../../retrieval/retrieval.service.js';
import { toAnalysisContextEvidence, toRetrievalEvidence } from '../analysis-trace-evidence.util.js';

/**
 * WI-CORE-026 (corte A): SQL real de `analysis_retrievals`, `analysis_contexts` y la FK
 * `generated_test_proposals.contextId`, con el `ContextBuilder` real y la omisión por `TOKEN_BUDGET`.
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

  beforeAll(() => {
    if (!isLocal) {
      throw new Error('ANALYSIS_TRACE_TEST_DATABASE_URL debe apuntar a localhost.');
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    repository = new AnalysisTraceRepository(prisma as unknown as PrismaService);
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
});
