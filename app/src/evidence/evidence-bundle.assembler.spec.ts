import { describe, expect, it } from 'vitest';
import {
  assembleAnalysisRunBundle,
  assembleExperimentBundle,
  assembleRetrievalComparisonBundle,
  type AnalysisRunEvidenceInput,
  type ExperimentEvidenceInput,
  type RetrievalComparisonEvidenceInput,
} from './evidence-bundle.assembler.js';
import { EMPTY_CONTENT_SHA256, snapshotRefFor } from './evidence-mapping.js';
import type { AnalysisSymbol } from '../generated/prisma/client.js';

const GENERATED_AT = new Date('2026-10-09T12:00:00.000Z');
const CONTEXT = { correlationId: 'corr-fixed', generatedAt: GENERATED_AT };
const HASH = 'a'.repeat(64);
const REPETITION_HASH = 'b'.repeat(64);

const TARGET = {
  id: 'sym-1',
  analysisRunId: 'run-1',
  language: 'TYPESCRIPT',
  kind: 'METHOD',
  qualifiedName: 'Thing.doIt',
  filePath: 'src/thing.ts',
  changeKind: 'DIRECTLY_CHANGED',
} as unknown as AnalysisSymbol;

const PUBLICATION = {
  status: 'PRESENT' as const,
  checkId: null,
  companionBranch: null,
  companionPullRequestUrl: null,
  sourceHeadSha: null,
  freshness: null,
};

/** Un Run con todas las secciones pobladas, y dos propuestas: una válida y una de excepción (content = ''). */
function analysisRunInput(overrides: Partial<AnalysisRunEvidenceInput> = {}): AnalysisRunEvidenceInput {
  return {
    ...CONTEXT,
    run: {
      id: 'run-1',
      repositoryName: 'org/repo',
      prNumber: 42,
      headSha: 'head-1',
      projectVersionId: 'pv-1',
      createdAt: new Date('2026-10-09T10:00:00.000Z'),
    },
    targets: [TARGET],
    publication: PUBLICATION,
    retrievals: [
      {
        id: 'ret-1',
        analysisSymbolId: 'sym-1',
        mode: 'SE',
        config: { mode: 'SE', vectorTopK: 20, targetChunkIds: ['t1'] },
        candidates: [
          { chunkId: 'c1', filePath: 'a.ts', symbolName: 'helper', parentSymbolName: null, semanticScore: 0.9, structuralMatch: 'IMPORTS' },
          { chunkId: 'c2', filePath: 'b.ts', symbolName: 'other', parentSymbolName: 'Thing', semanticScore: 0.4, structuralMatch: null },
        ],
      },
    ],
    contexts: [
      {
        id: 'ctx-1',
        analysisSymbolId: 'sym-1',
        selectedChunkIds: ['c1'],
        discardedChunkIds: ['c2'],
        selectedTokens: 10,
        tokenBudget: 1000,
        functionalRuleIds: ['kn-1'],
      },
    ],
    proposals: [
      {
        id: 'prop-1',
        contentSha256: HASH,
        generation: {
          provider: 'openai',
          model: 'gpt-x',
          modelVersion: null,
          reasoningEffort: 'low',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1200,
        },
      },
      { id: 'prop-2', contentSha256: EMPTY_CONTENT_SHA256, generation: null },
    ],
    executions: [
      {
        id: 'ex-1',
        proposalId: 'prop-1',
        executionId: 'sbx-1',
        attempt: 1,
        executionProfile: 'NODE_TYPESCRIPT',
        requestId: 'req-1',
        correlationId: 'corr-1',
        durationMs: 900,
        facts: {
          executionProfile: 'NODE_TYPESCRIPT',
          runner: 'JEST',
          compiled: true,
          executed: true,
          passed: false,
          totalTests: 3,
          passedTests: 2,
          failedTests: 1,
          skippedTests: 0,
          testCasesTruncated: false,
          failureStage: 'RUNNING_TESTS',
          failureCategory: 'TEST_ASSERTION',
          failureCode: 'ASSERT_FAILED',
          failureMessage: 'expected 1 password=hunter2',
        },
      },
      {
        id: 'ex-2',
        proposalId: 'prop-2',
        executionId: 'sbx-legacy',
        attempt: 2,
        executionProfile: 'NODE_TYPESCRIPT',
        requestId: null,
        correlationId: null,
        durationMs: null,
        facts: null,
      },
    ],
    ...overrides,
  };
}

function experimentRepetition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rep-rag-1',
    strategy: 'RAG' as const,
    repetition: 1,
    attempt: 2,
    pairId: 'pair-1',
    pairPosition: 1,
    technicallyEvaluable: true,
    generationDurationMs: 500,
    executionDurationMs: 200,
    inputTokens: 10,
    outputTokens: 5,
    artifactHash: REPETITION_HASH,
    sandboxExecutionId: 'sbx-r1',
    sandboxRequestId: 'req-r1',
    sandboxCorrelationId: 'corr-r1',
    sandboxFacts: {
      executionProfile: 'NODE_TYPESCRIPT',
      runner: 'JEST',
      compiled: true,
      executed: true,
      passed: true,
      totalTests: 2,
      passedTests: 2,
      failedTests: 0,
      skippedTests: 0,
      testCasesTruncated: false,
      failureStage: null,
      failureCategory: null,
      failureCode: null,
      failureMessage: null,
    },
    ...overrides,
  };
}

function experimentInput(overrides: Partial<ExperimentEvidenceInput> = {}): ExperimentEvidenceInput {
  return {
    ...CONTEXT,
    run: {
      id: 'exp-1',
      randomizationSeed: 'seed-1',
      executionProfile: 'NODE_TYPESCRIPT',
      runnerHint: 'JEST',
      modelConfig: { provider: 'openai', model: 'gpt-x', modelVersion: 'v1', reasoningEffort: 'low', temperature: null },
    },
    repetitions: [
      experimentRepetition(),
      {
        id: 'rep-agent-1',
        strategy: 'GENERALIST_AGENT',
        repetition: 1,
        attempt: 1,
        pairId: null,
        pairPosition: null,
        technicallyEvaluable: false,
        generationDurationMs: null,
        executionDurationMs: null,
        inputTokens: null,
        outputTokens: null,
        artifactHash: null,
        sandboxExecutionId: null,
        sandboxRequestId: null,
        sandboxCorrelationId: null,
        sandboxFacts: null,
      },
      {
        id: 'rep-rag-2',
        strategy: 'RAG',
        repetition: 2,
        attempt: 1,
        pairId: null,
        pairPosition: null,
        technicallyEvaluable: true,
        generationDurationMs: null,
        executionDurationMs: null,
        inputTokens: null,
        outputTokens: null,
        artifactHash: null,
        sandboxExecutionId: null,
        sandboxRequestId: null,
        sandboxCorrelationId: null,
        sandboxFacts: null,
      },
    ],
    traces: [
      {
        id: 'trace-rag-1',
        experimentRepetitionId: 'rep-rag-1',
        kind: 'RAG',
        detail: {
          configuration: { minimumScore: 0.5, topK: 5, maxContextTokens: 4000, semanticWeight: 0.7, structuralWeight: 0.3 },
          candidates: [
            {
              chunkId: 'k1',
              rank: 1,
              excerpt: { filePath: 'src/x.ts', symbolName: 'f', parentSymbolName: 'C', snippet: 'SECRET_SNIPPET' },
              semanticScore: 0.8,
              structuralMatch: 'SAME_NAMESPACE',
              combinedScore: 0.7,
              decision: 'SELECTED',
            },
            {
              chunkId: 'k2',
              rank: 2,
              excerpt: { filePath: 'src/y.ts', symbolName: 'g', parentSymbolName: null, snippet: 'OTHER' },
              semanticScore: 0.3,
              structuralMatch: null,
              combinedScore: 0.2,
              decision: 'DISCARDED',
            },
          ],
          contextTokens: 300,
          functionalRules: { functionalRuleIds: ['kn-9'], retrieved: 1, selected: 1, omitted: [{ knowledgeId: 'kn-x', reason: 'TOKEN_BUDGET' }] },
        },
      },
      {
        id: 'trace-agent-1',
        experimentRepetitionId: 'rep-agent-1',
        kind: 'AGENT',
        detail: {
          budget: { toolCallCap: 8, contextTokenBudget: 4000, contextTokensDelivered: 100, capReached: false, truncatedSteps: 0 },
          trajectory: [{ step: 1, toolName: 'read_file', status: 'OK', arguments: { relativePath: 'src/x.ts' }, resultSummary: 'SECRET_RESULT' }],
          toolCalls: 1,
          filesInspected: 1,
        },
      },
    ],
    ...overrides,
  };
}

function comparisonResult(mode: 'SE' | 'SEM', overrides: Record<string, unknown> = {}) {
  return {
    id: `result-${mode}`,
    mode,
    config: {
      semanticTopK: 50,
      finalTopK: 10,
      semanticWeight: mode === 'SE' ? 0.7 : null,
      structuralWeight: mode === 'SE' ? 0.3 : null,
      embeddingModel: 'text-embedding-3-small',
    },
    candidates: [
      { rank: 1, chunkId: 'c1', filePath: 'f.ts', symbolQualifiedName: 'A.b', semanticScore: 0.5, structuralRelation: 'IMPORTS', combinedScore: 0.4, selected: true },
    ],
    metrics: mode === 'SE' ? { precisionAt5: 0.2, recallAt5: 0.5, precisionAt10: 0.1, recallAt10: 1 } : null,
    ...overrides,
  };
}

function comparisonInput(overrides: Partial<RetrievalComparisonEvidenceInput> = {}): RetrievalComparisonEvidenceInput {
  return {
    ...CONTEXT,
    comparison: { id: 'cmp-1', status: 'COMPLETED' },
    results: [comparisonResult('SEM'), comparisonResult('SE')],
    ...overrides,
  };
}

describe('assembleAnalysisRunBundle (WI-CORE-027, kind ANALYSIS_RUN)', () => {
  it('builds the run section, the publication and every section from the persisted rows', () => {
    const bundle = assembleAnalysisRunBundle(analysisRunInput());

    expect(bundle).toMatchObject({
      schemaVersion: '1',
      kind: 'ANALYSIS_RUN',
      subjectId: 'run-1',
      generatedAt: '2026-10-09T12:00:00.000Z',
      correlationId: 'corr-fixed',
      analysisRun: {
        analysisRunId: 'run-1',
        repositoryName: 'org/repo',
        pullRequestNumber: 42,
        headSha: 'head-1',
        projectVersionId: 'pv-1',
        snapshotRef: snapshotRefFor('pv-1', 'head-1'),
        createdAt: '2026-10-09T10:00:00.000Z',
        targets: [{ language: 'TYPESCRIPT', kind: 'METHOD', qualifiedName: 'Thing.doIt', filePath: 'src/thing.ts', changeKind: 'DIRECTLY_CHANGED' }],
      },
      publication: PUBLICATION,
      experimental: [],
      agentExploration: [],
    });
  });

  it('gives candidates rank from the persisted position and selected from the context, with combinedScore null in SE', () => {
    const [retrieval] = assembleAnalysisRunBundle(analysisRunInput()).retrieval;

    expect(retrieval).toMatchObject({ retrievalId: 'ret-1', mode: 'SE', metrics: null, config: { semanticTopK: 20, finalTopK: null } });
    expect(retrieval.candidates).toEqual([
      { rank: 1, chunkId: 'c1', filePath: 'a.ts', symbolQualifiedName: 'helper', semanticScore: 0.9, structuralRelation: 'IMPORTS', combinedScore: null, selected: true },
      { rank: 2, chunkId: 'c2', filePath: 'b.ts', symbolQualifiedName: 'Thing.other', semanticScore: 0.4, structuralRelation: null, combinedScore: null, selected: false },
    ]);
  });

  it('maps the context counts and rules, and keeps ids only', () => {
    expect(assembleAnalysisRunBundle(analysisRunInput()).context).toEqual([
      {
        contextId: 'ctx-1',
        selectedChunkIds: ['c1'],
        discardedChunkIds: ['c2'],
        tokenCounts: { selected: 10, budget: 1000 },
        functionalRuleIds: ['kn-1'],
      },
    ]);
  });

  it('marks the generation as PRODUCT, takes the attempt of the execution, and sets artifactHash null for the exception proposal', () => {
    const [valid, exception] = assembleAnalysisRunBundle(analysisRunInput()).generation;

    expect(valid).toEqual({
      strategy: 'PRODUCT',
      repetition: null,
      attempt: 1,
      provider: 'openai',
      model: 'gpt-x',
      modelVersion: null,
      reasoningEffort: 'low',
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 1200,
      artifactHash: HASH,
    });
    expect(exception).toEqual({
      strategy: 'PRODUCT',
      repetition: null,
      attempt: 2,
      provider: null,
      model: null,
      modelVersion: null,
      reasoningEffort: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
      artifactHash: null,
    });
  });

  it('exports the sandbox facts from the row, sanitized, and reports rows without evidence as null', () => {
    const [observed, legacy] = assembleAnalysisRunBundle(analysisRunInput()).sandbox;

    expect(observed).toMatchObject({
      executionId: 'sbx-1',
      strategy: 'PRODUCT',
      repetition: null,
      executionProfile: 'NODE_TYPESCRIPT',
      runnerHint: 'JEST',
      attempt: 1,
      durationMs: 900,
      requestId: 'req-1',
      correlationId: 'corr-1',
    });
    expect(observed.facts.failureMessage).toBe('expected 1 password=[REDACTED]');
    expect(observed.facts.failureCode).toBe('ASSERT_FAILED');

    expect(legacy).toMatchObject({
      executionId: 'sbx-legacy',
      attempt: 2,
      durationMs: null,
      requestId: null,
      correlationId: null,
      runnerHint: null,
    });
    expect(legacy.facts).toMatchObject({
      executionProfile: 'NODE_TYPESCRIPT',
      runner: null,
      totalTests: null,
      failureMessage: null,
    });
  });

  it('emits runnerHint PHPUNIT in sandbox[] when the Sandbox reported it, and null for a runner outside TestRunner', () => {
    const bundle = assembleAnalysisRunBundle(
      analysisRunInput({
        executions: [
          {
            id: 'ex-php',
            proposalId: 'prop-1',
            executionId: 'sbx-php',
            attempt: 1,
            executionProfile: 'PHP_LARAVEL_PHPUNIT',
            requestId: 'req-php',
            correlationId: 'corr-php',
            durationMs: 1200,
            facts: {
              executionProfile: 'PHP_LARAVEL_PHPUNIT',
              runner: 'PHPUNIT',
              compiled: true,
              executed: true,
              passed: true,
              totalTests: 4,
              passedTests: 4,
              failedTests: 0,
              skippedTests: 0,
              testCasesTruncated: false,
            },
          },
          {
            id: 'ex-other',
            proposalId: 'prop-2',
            executionId: 'sbx-other',
            attempt: 1,
            executionProfile: 'NODE_TYPESCRIPT',
            requestId: null,
            correlationId: null,
            durationMs: null,
            facts: { runner: 'MOCHA', totalTests: 1 },
          },
        ],
      }),
    );
    const [php, other] = bundle.sandbox;

    expect(php).toMatchObject({ executionId: 'sbx-php', executionProfile: 'PHP_LARAVEL_PHPUNIT', runnerHint: 'PHPUNIT' });
    expect(php.facts.runner).toBe('PHPUNIT');
    expect(other).toMatchObject({ executionId: 'sbx-other', runnerHint: null });
    expect(other.facts.runner).toBeNull();
  });

  it('exports the PHP structural relations of §6.15 in retrieval candidates and null for any other value', () => {
    const bundle = assembleAnalysisRunBundle(
      analysisRunInput({
        retrievals: [
          {
            id: 'ret-php',
            analysisSymbolId: 'sym-1',
            mode: 'SE',
            config: { mode: 'SE', vectorTopK: 20, targetChunkIds: ['t1'] },
            candidates: [
              { chunkId: 'p1', filePath: 'app/Svc.php', symbolName: 'run', parentSymbolName: 'Svc', semanticScore: 0.5, structuralMatch: 'SAME_NAMESPACE' },
              { chunkId: 'p2', filePath: 'app/Use.php', symbolName: null, parentSymbolName: null, semanticScore: 0.4, structuralMatch: 'FULLY_QUALIFIED_REFERENCE' },
              { chunkId: 'p3', filePath: 'app/Decl.php', symbolName: 'make', parentSymbolName: 'Decl', semanticScore: 0.3, structuralMatch: 'DECLARING_CLASS' },
              { chunkId: 'p4', filePath: 'app/Odd.php', symbolName: null, parentSymbolName: null, semanticScore: 0.2, structuralMatch: 'NAMESPACE_ONLY' },
            ],
          },
        ],
      }),
    );

    expect(bundle.retrieval[0].candidates.map((candidate) => candidate.structuralRelation)).toEqual([
      'SAME_NAMESPACE',
      'FULLY_QUALIFIED_REFERENCE',
      'DECLARING_CLASS',
      null,
    ]);
  });

  it('leaves each section empty when the Run has no targets, without inventing links', () => {
    const bundle = assembleAnalysisRunBundle(
      analysisRunInput({ targets: [], retrievals: [], contexts: [], proposals: [], executions: [] }),
    );

    expect(bundle).toMatchObject({ retrieval: [], context: [], generation: [], sandbox: [], analysisRun: { targets: [] } });
  });

  it('gives a null snapshotRef and projectVersionId when the Run has no snapshot yet', () => {
    const bundle = assembleAnalysisRunBundle(
      analysisRunInput({ run: { id: 'run-1', repositoryName: 'org/repo', prNumber: 42, headSha: 'head-1', projectVersionId: null, createdAt: GENERATED_AT } }),
    );

    expect(bundle.analysisRun).toMatchObject({ projectVersionId: null, snapshotRef: null });
  });
});

describe('assembleExperimentBundle (WI-CORE-027, kind EXPERIMENT)', () => {
  it('gives the RAG retrieval and context the ContextTrace id and the configuration of the trace (no excerpt, no rule text)', () => {
    const bundle = assembleExperimentBundle(experimentInput());
    const [retrieval] = bundle.retrieval;
    const [context] = bundle.context;

    expect(retrieval).toMatchObject({
      retrievalId: 'trace-rag-1',
      mode: 'SE',
      config: { semanticTopK: null, finalTopK: 5, semanticWeight: 0.7, structuralWeight: 0.3, embeddingModel: null },
      metrics: null,
    });
    expect(retrieval.candidates).toEqual([
      {
        rank: 1,
        chunkId: 'k1',
        filePath: 'src/x.ts',
        symbolQualifiedName: 'C.f',
        semanticScore: 0.8,
        structuralRelation: 'SAME_NAMESPACE',
        combinedScore: 0.7,
        selected: true,
      },
      {
        rank: 2,
        chunkId: 'k2',
        filePath: 'src/y.ts',
        symbolQualifiedName: 'g',
        semanticScore: 0.3,
        structuralRelation: null,
        combinedScore: 0.2,
        selected: false,
      },
    ]);
    expect(context).toEqual({
      contextId: 'trace-rag-1',
      selectedChunkIds: ['k1'],
      discardedChunkIds: ['k2'],
      tokenCounts: { selected: 300, budget: 4000 },
      functionalRuleIds: ['kn-9'],
    });
  });

  it('exports the agent exploration only with step, toolName and status and the budget of the trace', () => {
    expect(assembleExperimentBundle(experimentInput()).agentExploration).toEqual([
      {
        toolCallCap: 8,
        steps: [{ step: 1, toolName: 'read_file', status: 'OK' }],
        filesInspected: 1,
        contextTokenBudget: 4000,
      },
    ]);
  });

  it('takes the model from the experiment config and the tokens and duration from each current repetition, null when absent', () => {
    const [rag, agent, legacyRag] = assembleExperimentBundle(experimentInput()).generation;

    expect(rag).toEqual({
      strategy: 'RAG',
      repetition: 1,
      attempt: 2,
      provider: 'openai',
      model: 'gpt-x',
      modelVersion: 'v1',
      reasoningEffort: 'low',
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 500,
      artifactHash: REPETITION_HASH,
    });
    expect(agent).toMatchObject({ strategy: 'GENERALIST_AGENT', durationMs: null, inputTokens: null, artifactHash: null });
    expect(legacyRag).toMatchObject({ strategy: 'RAG', repetition: 2, durationMs: null, artifactHash: null });
  });

  it('lists a sandbox entry only for a repetition that invoked the Sandbox, with the measured durationMs', () => {
    const bundle = assembleExperimentBundle(experimentInput());

    expect(bundle.sandbox).toHaveLength(1);
    expect(bundle.sandbox[0]).toMatchObject({
      executionId: 'sbx-r1',
      strategy: 'RAG',
      repetition: 1,
      executionProfile: 'NODE_TYPESCRIPT',
      runnerHint: 'JEST',
      attempt: 2,
      durationMs: 200,
      requestId: 'req-r1',
      correlationId: 'corr-r1',
    });
    expect(bundle.sandbox[0].facts.passed).toBe(true);
  });

  it('emits the experiment runnerHint PHPUNIT in sandbox[] of an invoked PHP repetition, and null for a runner outside TestRunner', () => {
    const phpRepetition = experimentRepetition({
      sandboxFacts: {
        ...(experimentRepetition().sandboxFacts as Record<string, unknown>),
        executionProfile: 'PHP_LARAVEL_PHPUNIT',
        runner: 'PHPUNIT',
      },
    });
    const phpRun = {
      id: 'exp-php',
      randomizationSeed: 'seed-1',
      executionProfile: 'PHP_LARAVEL_PHPUNIT',
      runnerHint: 'PHPUNIT',
      modelConfig: null,
    };

    const [php] = assembleExperimentBundle(experimentInput({ run: phpRun, repetitions: [phpRepetition] })).sandbox;
    expect(php).toMatchObject({ executionProfile: 'PHP_LARAVEL_PHPUNIT', runnerHint: 'PHPUNIT', strategy: 'RAG' });
    expect(php.facts.runner).toBe('PHPUNIT');

    const [unknown] = assembleExperimentBundle(
      experimentInput({ run: { ...phpRun, runnerHint: 'MOCHA' }, repetitions: [phpRepetition] }),
    ).sandbox;
    expect(unknown.runnerHint).toBeNull();
  });

  it('gives no sandbox entry for a repetition without invocation, even when the sandbox columns are empty', () => {
    const bundle = assembleExperimentBundle(
      experimentInput({
        repetitions: [
          experimentRepetition({
            sandboxExecutionId: null,
            sandboxRequestId: null,
            sandboxCorrelationId: null,
            sandboxFacts: null,
            executionDurationMs: null,
          }),
        ],
      }),
    );

    expect(bundle.sandbox).toEqual([]);
  });

  it('gives durationMs null for an invoked repetition whose execution duration was not recorded', () => {
    const bundle = assembleExperimentBundle(experimentInput({ repetitions: [experimentRepetition({ executionDurationMs: null })] }));

    expect(bundle.sandbox).toHaveLength(1);
    expect(bundle.sandbox[0]).toMatchObject({ executionId: 'sbx-r1', durationMs: null });
  });

  it('gives durationMs null, never 0, for a negative execution duration of an invoked repetition', () => {
    const bundle = assembleExperimentBundle(experimentInput({ repetitions: [experimentRepetition({ executionDurationMs: -5 })] }));

    expect(bundle.sandbox).toHaveLength(1);
    expect(bundle.sandbox[0].durationMs).toBeNull();
  });

  it('keeps a zero execution duration as an observed 0 for an invoked repetition', () => {
    const bundle = assembleExperimentBundle(experimentInput({ repetitions: [experimentRepetition({ executionDurationMs: 0 })] }));

    expect(bundle.sandbox[0].durationMs).toBe(0);
  });

  it('exports every current repetition in experimental with technicallyEvaluable, and keeps the pair null for legacy rows', () => {
    const { experimental } = assembleExperimentBundle(experimentInput());

    expect(experimental).toEqual([
      { experimentId: 'exp-1', strategy: 'RAG', repetition: 1, pairId: 'pair-1', pairPosition: 1, attempt: 2, randomizationSeed: 'seed-1', technicallyEvaluable: true },
      { experimentId: 'exp-1', strategy: 'GENERALIST_AGENT', repetition: 1, pairId: null, pairPosition: null, attempt: 1, randomizationSeed: 'seed-1', technicallyEvaluable: false },
      { experimentId: 'exp-1', strategy: 'RAG', repetition: 2, pairId: null, pairPosition: null, attempt: 1, randomizationSeed: 'seed-1', technicallyEvaluable: true },
    ]);
  });

  it('leaves the retrieval and context empty for a repetition without a trace, and the run-level sections null', () => {
    const bundle = assembleExperimentBundle(experimentInput({ traces: [] }));

    expect(bundle).toMatchObject({ analysisRun: null, publication: null, retrieval: [], context: [], agentExploration: [] });
    expect(bundle.generation).toHaveLength(3);
  });

  it('gives null for a run without the persisted experiment identity (legacy experiment)', () => {
    const bundle = assembleExperimentBundle(
      experimentInput({ run: { id: 'exp-old', randomizationSeed: null, executionProfile: null, runnerHint: null, modelConfig: null } }),
    );

    expect(bundle.experimental[0].randomizationSeed).toBeNull();
    expect(bundle.generation[0]).toMatchObject({ provider: null, model: null, modelVersion: null });
  });
});

describe('assembleRetrievalComparisonBundle (WI-CORE-027, kind RETRIEVAL_COMPARISON)', () => {
  it('returns SE and SEM with their metrics, in mode order, and never exposes groundTruth', () => {
    const bundle = assembleRetrievalComparisonBundle(comparisonInput());

    expect(bundle).toMatchObject({ kind: 'RETRIEVAL_COMPARISON', subjectId: 'cmp-1', analysisRun: null, publication: null });
    expect(bundle.retrieval.map((row) => row.mode)).toEqual(['SE', 'SEM']);
    expect(bundle.retrieval[0]).toMatchObject({
      retrievalId: 'result-SE',
      config: { semanticTopK: 50, finalTopK: 10, semanticWeight: 0.7, structuralWeight: 0.3, embeddingModel: 'text-embedding-3-small' },
      metrics: { precisionAt5: 0.2, recallAt5: 0.5, precisionAt10: 0.1, recallAt10: 1 },
    });
    expect(bundle.retrieval[1].metrics).toBeNull();
    expect(JSON.stringify(bundle)).not.toContain('groundTruth');
  });

  it('gives an empty retrieval for a FAILED comparison even if results exist', () => {
    const bundle = assembleRetrievalComparisonBundle(
      comparisonInput({ comparison: { id: 'cmp-1', status: 'FAILED' }, results: [comparisonResult('SE')] }),
    );

    expect(bundle.retrieval).toEqual([]);
    expect(bundle.kind).toBe('RETRIEVAL_COMPARISON');
  });
});


/** Claves por objeto de cada kind (ancla de `schemaVersion '1'`). Una clave nueva sin versionar hace fallar la prueba. */
const EXPECTED_KEY_SHAPE = {
  ANALYSIS_RUN: {
    '(raiz)': ['agentExploration', 'analysisRun', 'context', 'correlationId', 'experimental', 'generatedAt', 'generation', 'kind', 'publication', 'retrieval', 'sandbox', 'schemaVersion', 'subjectId'],
    'analysisRun': ['analysisRunId', 'createdAt', 'headSha', 'projectVersionId', 'pullRequestNumber', 'repositoryName', 'snapshotRef', 'targets'],
    'analysisRun.targets[]': ['changeKind', 'filePath', 'kind', 'language', 'qualifiedName'],
    'retrieval[]': ['candidates', 'config', 'metrics', 'mode', 'retrievalId'],
    'retrieval[].config': ['embeddingModel', 'finalTopK', 'semanticTopK', 'semanticWeight', 'structuralWeight'],
    'retrieval[].candidates[]': ['chunkId', 'combinedScore', 'filePath', 'rank', 'selected', 'semanticScore', 'structuralRelation', 'symbolQualifiedName'],
    'context[]': ['contextId', 'discardedChunkIds', 'functionalRuleIds', 'selectedChunkIds', 'tokenCounts'],
    'context[].tokenCounts': ['budget', 'selected'],
    'generation[]': ['artifactHash', 'attempt', 'durationMs', 'inputTokens', 'model', 'modelVersion', 'outputTokens', 'provider', 'reasoningEffort', 'repetition', 'strategy'],
    'sandbox[]': ['attempt', 'correlationId', 'durationMs', 'executionId', 'executionProfile', 'facts', 'repetition', 'requestId', 'runnerHint', 'strategy'],
    'sandbox[].facts': ['compiled', 'executed', 'executionProfile', 'failedTests', 'failureCategory', 'failureCode', 'failureMessage', 'failureStage', 'passed', 'passedTests', 'runner', 'skippedTests', 'testCasesTruncated', 'totalTests'],
    'publication': ['checkId', 'companionBranch', 'companionPullRequestUrl', 'freshness', 'sourceHeadSha', 'status']
  },
  EXPERIMENT: {
    '(raiz)': ['agentExploration', 'analysisRun', 'context', 'correlationId', 'experimental', 'generatedAt', 'generation', 'kind', 'publication', 'retrieval', 'sandbox', 'schemaVersion', 'subjectId'],
    'retrieval[]': ['candidates', 'config', 'metrics', 'mode', 'retrievalId'],
    'retrieval[].config': ['embeddingModel', 'finalTopK', 'semanticTopK', 'semanticWeight', 'structuralWeight'],
    'retrieval[].candidates[]': ['chunkId', 'combinedScore', 'filePath', 'rank', 'selected', 'semanticScore', 'structuralRelation', 'symbolQualifiedName'],
    'context[]': ['contextId', 'discardedChunkIds', 'functionalRuleIds', 'selectedChunkIds', 'tokenCounts'],
    'context[].tokenCounts': ['budget', 'selected'],
    'generation[]': ['artifactHash', 'attempt', 'durationMs', 'inputTokens', 'model', 'modelVersion', 'outputTokens', 'provider', 'reasoningEffort', 'repetition', 'strategy'],
    'agentExploration[]': ['contextTokenBudget', 'filesInspected', 'steps', 'toolCallCap'],
    'agentExploration[].steps[]': ['status', 'step', 'toolName'],
    'sandbox[]': ['attempt', 'correlationId', 'durationMs', 'executionId', 'executionProfile', 'facts', 'repetition', 'requestId', 'runnerHint', 'strategy'],
    'sandbox[].facts': ['compiled', 'executed', 'executionProfile', 'failedTests', 'failureCategory', 'failureCode', 'failureMessage', 'failureStage', 'passed', 'passedTests', 'runner', 'skippedTests', 'testCasesTruncated', 'totalTests'],
    'experimental[]': ['attempt', 'experimentId', 'pairId', 'pairPosition', 'randomizationSeed', 'repetition', 'strategy', 'technicallyEvaluable']
  },
  RETRIEVAL_COMPARISON: {
    '(raiz)': ['agentExploration', 'analysisRun', 'context', 'correlationId', 'experimental', 'generatedAt', 'generation', 'kind', 'publication', 'retrieval', 'sandbox', 'schemaVersion', 'subjectId'],
    'retrieval[]': ['candidates', 'config', 'metrics', 'mode', 'retrievalId'],
    'retrieval[].config': ['embeddingModel', 'finalTopK', 'semanticTopK', 'semanticWeight', 'structuralWeight'],
    'retrieval[].candidates[]': ['chunkId', 'combinedScore', 'filePath', 'rank', 'selected', 'semanticScore', 'structuralRelation', 'symbolQualifiedName'],
    'retrieval[].metrics': ['precisionAt10', 'precisionAt5', 'recallAt10', 'recallAt5']
  },
};

/** Forma de los objetos de un bundle: claves por ruta (los arrays se recorren con `[]` y sus claves se unen). */
function keyShapeOf(bundle: unknown): Record<string, string[]> {
  const shape: Record<string, Set<string>> = {};
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, `${path}[]`);
      return;
    }
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      shape[path] = new Set([...(shape[path] ?? []), ...entries.map(([key]) => key)]);
      for (const [key, child] of entries) visit(child, path === '' ? key : `${path}.${key}`);
    }
  };
  visit(bundle, '');
  return Object.fromEntries(Object.entries(shape).map(([path, keys]) => [path || '(raiz)', [...keys].sort()]));
}

/** Bundles de los tres kinds con todas las secciones pobladas, con el reloj y la correlación fijos. */
function populatedBundles() {
  return {
    ANALYSIS_RUN: assembleAnalysisRunBundle(analysisRunInput()),
    EXPERIMENT: assembleExperimentBundle(experimentInput()),
    RETRIEVAL_COMPARISON: assembleRetrievalComparisonBundle(comparisonInput()),
  };
}

describe('esquema estable de EvidenceBundleResponse (schemaVersion 1, WI-CORE-027)', () => {
  it.each(['ANALYSIS_RUN', 'EXPERIMENT', 'RETRIEVAL_COMPARISON'] as const)(
    'keeps the keys of every object of the %s bundle; a new unversioned key makes this fail',
    (kind) => {
      expect(keyShapeOf(populatedBundles()[kind])).toEqual(EXPECTED_KEY_SHAPE[kind]);
    },
  );

  it('is anchored to schemaVersion 1, a fixed clock and a fixed snapshot reference', () => {
    const bundle = assembleAnalysisRunBundle(analysisRunInput());

    expect(bundle.schemaVersion).toBe('1');
    expect(bundle.generatedAt).toBe('2026-10-09T12:00:00.000Z');
    expect(bundle.analysisRun?.snapshotRef).toBe('dbcf983b-0215-5de2-a881-77d3a9c4c6c1');
  });
});

/** Claves que la evidencia nunca exporta (INTEROP-2.7 §6.16; WI-CORE-027 criterio 6). */
const FORBIDDEN_KEYS = [
  'excerpt',
  'content',
  'url',
  'signedUrl',
  'storageKey',
  'chainOfThought',
  'reasoning',
  'groundTruth',
  'testCases',
  'knowledgeId',
  'omittedFunctionalRules',
  'functionalRulesRetrieved',
  'functionalRulesSelected',
  'functionalRulesOmitted',
  'snippet',
  'arguments',
  'resultSummary',
  'resultSha256',
  'errorMessage',
  'trajectory',
  'logs',
  'evidence',
  'contentSha256',
  'errorSummary',
  'failureSummary',
  'tokenCount',
  'matchedVia',
  'discardReason',
  'discoveredFiles',
  'retrievedChunks',
  'selectedChunks',
  'contextTokens',
  // Campos que PHP/PHPUnit puede introducir en el Sandbox o en el retrieval y que la evidencia nunca exporta.
  'failureKind',
  'phase',
  'stdout',
  'stderr',
  'namespace',
  'composerLock',
];

/** Fragmentos que no pueden aparecer en ningún valor: código de muestra, credenciales sembradas, URLs firmadas, claves de storage e identificadores EV-OE. */
const FORBIDDEN_VALUE_FRAGMENTS = [
  'SECRET_',
  'hunter2',
  'SIG123',
  'sk_live_',
  'tok-SECRET',
  'xoxb-',
  'EV-OE',
  'kn-x',
  'analysis-runs/',
  'proposals/',
  'chainOfThought',
  'OTHER_SNIPPET',
  'SECRET_STDERR',
  'SECRET_STDOUT',
];

function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
}

/** Fuentes con datos hostiles sembrados en cada campo que la evidencia no debe leer ni exponer. */
function hostileBundles() {
  const SECRET_FAILURE = 'failed: password=hunter2 url=https://bucket.example.com/o?X-Amz-Signature=SIG123 key sk_live_abcdefgh12345678 bearer tok-SECRET';
  const run = analysisRunInput({
    proposals: [
      {
        id: 'prop-1',
        contentSha256: HASH,
        generation: { provider: 'openai', model: 'gpt-x', inputTokens: 1, outputTokens: 1, durationMs: 1, chainOfThought: 'SECRET_THOUGHT' },
        storageKey: 'analysis-runs/run-1/proposals/prop-1',
        content: 'SECRET_CONTENT',
      },
    ] as never,
    executions: [
      {
        id: 'ex-1',
        proposalId: 'prop-1',
        executionId: 'sbx-1',
        attempt: 1,
        executionProfile: 'NODE_TYPESCRIPT',
        requestId: 'req-1',
        correlationId: 'corr-1',
        durationMs: 900,
        facts: {
          executionProfile: 'NODE_TYPESCRIPT',
          runner: 'JEST',
          failureStage: 'RUNNING_TESTS',
          failureCategory: 'TEST_ASSERTION',
          failureCode: 'ASSERT_FAILED',
          failureMessage: SECRET_FAILURE,
          testCases: [{ name: 'x', errorMessage: 'SECRET_TEST_CASE' }],
          logs: 'SECRET_LOG',
          failureKind: 'ERROR',
          phase: 'PHPUNIT_RUN',
          stdout: 'SECRET_STDOUT',
          stderr: 'SECRET_STDERR',
        },
      },
    ] as never,
  });
  const experiment = experimentInput({
    repetitions: [
      experimentRepetition({ sandboxFacts: { executionProfile: 'NODE_TYPESCRIPT', passed: true, testCases: [{ errorMessage: 'SECRET_TEST_CASE' }] } }),
    ] as never,
    traces: [
      {
        id: 'trace-rag-1',
        experimentRepetitionId: 'rep-rag-1',
        kind: 'RAG',
        detail: {
          configuration: { topK: 5, maxContextTokens: 4000, semanticWeight: 0.7, structuralWeight: 0.3 },
          candidates: [
            {
              chunkId: 'k1',
              rank: 1,
              excerpt: { filePath: 'src/x.ts', symbolName: 'f', snippet: 'SECRET_SNIPPET', namespace: 'App\\Models' },
              tokenCount: 3,
              decision: 'SELECTED',
              structuralMatch: 'SAME_NAMESPACE',
            },
          ],
          contextTokens: 300,
          functionalRules: { functionalRuleIds: ['kn-9'], omitted: [{ knowledgeId: 'kn-x', reason: 'TOKEN_BUDGET' }] },
        },
      },
    ] as never,
  });
  const comparison = comparisonInput({
    results: [comparisonResult('SE', { groundTruth: [{ filePath: 'OTHER_SNIPPET.ts' }], snippet: 'SECRET_SNIPPET' })] as never,
  });

  return {
    ANALYSIS_RUN: assembleAnalysisRunBundle(run),
    EXPERIMENT: assembleExperimentBundle(experiment),
    RETRIEVAL_COMPARISON: assembleRetrievalComparisonBundle(comparison),
  };
}

describe('claves y valores prohibidos en la evidencia (WI-CORE-027, criterio 6)', () => {
  it.each(['ANALYSIS_RUN', 'EXPERIMENT', 'RETRIEVAL_COMPARISON'] as const)(
    'never exports a forbidden key from the %s bundle, even when the sources carry one',
    (kind) => {
      const keys = new Set<string>();
      collectKeys(hostileBundles()[kind], keys);

      expect([...keys].filter((key) => FORBIDDEN_KEYS.includes(key))).toEqual([]);
    },
  );

  it.each(['ANALYSIS_RUN', 'EXPERIMENT', 'RETRIEVAL_COMPARISON'] as const)(
    'never serializes sample code, seeded credentials, signed URLs or storage keys in the %s bundle',
    (kind) => {
      const serialized = JSON.stringify(hostileBundles()[kind]);

      for (const fragment of FORBIDDEN_VALUE_FRAGMENTS) {
        expect(serialized, `${kind} no debe exponer "${fragment}"`).not.toContain(fragment);
      }
    },
  );

  it('still exports the failure message, redacted, with the seeded secret replaced', () => {
    const [sandbox] = hostileBundles().ANALYSIS_RUN.sandbox;

    expect(sandbox.facts.failureMessage).toContain('password=[REDACTED]');
    expect(sandbox.facts.failureMessage).not.toContain('hunter2');
    expect(sandbox.facts.failureMessage).not.toContain('SIG123');
  });
});
