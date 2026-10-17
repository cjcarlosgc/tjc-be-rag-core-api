import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ExperimentRunsRepository } from '../../experiments/persistence/experiment-runs.repository.js';
import { ContextTracesRepository } from '../../context-traces/context-traces.repository.js';
import { AnalysisTraceRepository } from '../../analysis-runs/persistence/analysis-trace.repository.js';
import { assembleAnalysisRunBundle, assembleExperimentBundle } from '../evidence-bundle.assembler.js';
import { EvidenceRepository } from './evidence.repository.js';

/**
 * WI-CORE-027 (corte C): captura y lectura reales de la evidencia sobre PostgreSQL, con las columnas del corte B
 * (`experiment_repetitions` y `analysis_run_executions`). Necesita un PostgreSQL LOCAL descartable con las
 * migraciones aplicadas. Sin `EVIDENCE_TEST_DATABASE_URL` se omite; la suite nunca toca Supabase ni una base
 * compartida. Cada caso crea su propio proyecto; no borra filas.
 *
 *   EVIDENCE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/ev_test npx vitest run src/evidence/persistence/evidence.repository.pg.spec.ts
 */
const url = process.env.EVIDENCE_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

const SAMPLE_CODE = 'SECRETO_DE_CODIGO_PG';
const HASH = 'e'.repeat(64);

const FACTS = {
  executionProfile: 'NODE_TYPESCRIPT',
  runner: 'JEST',
  compiled: true,
  executed: true,
  passed: false,
  totalTests: 4,
  passedTests: 3,
  failedTests: 1,
  skippedTests: 0,
  testCasesTruncated: false,
  failureStage: 'RUNNING_TESTS',
  failureCategory: 'TEST_ASSERTION',
  failureCode: 'ASSERT_FAILED',
  failureMessage: 'expected 2 password=hunter2',
};

function repetitionInput(overrides: Record<string, unknown> = {}) {
  return {
    repetition: 1,
    strategy: 'RAG' as const,
    compiled: true,
    executed: true,
    passed: true,
    valid: true,
    failureType: null,
    errorSummary: null,
    generationDurationMs: 300,
    executionDurationMs: 200,
    totalDurationMs: 500,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    estimatedCost: null,
    retrievedChunks: 2,
    selectedChunks: 1,
    contextTokens: 120,
    toolCalls: null,
    filesInspected: null,
    trajectory: undefined,
    ...overrides,
  };
}

describe.skipIf(!url)('evidencia sobre PostgreSQL local: captura y lectura (WI-CORE-027, corte C)', () => {
  let prisma: PrismaClient;
  let experiments: ExperimentRunsRepository;
  let contextTraces: ContextTracesRepository;
  let traces: AnalysisTraceRepository;
  let evidence: EvidenceRepository;

  beforeAll(() => {
    if (!isLocal) {
      throw new Error('EVIDENCE_TEST_DATABASE_URL debe apuntar a localhost.');
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    experiments = new ExperimentRunsRepository(prisma as unknown as PrismaService);
    contextTraces = new ContextTracesRepository(prisma as unknown as PrismaService);
    traces = new AnalysisTraceRepository(prisma as unknown as PrismaService);
    evidence = new EvidenceRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createExperiment() {
    const project = await prisma.project.create({ data: { name: `pg-evidence-${crypto.randomUUID()}` } });
    const version = await prisma.projectVersion.create({ data: { projectId: project.id } });
    const target = await prisma.testTarget.create({
      data: {
        projectVersionId: version.id,
        filePath: 'src/thing.ts',
        symbolName: 'Thing',
        methodName: 'doIt',
        targetType: 'METHOD',
        startLine: 1,
        endLine: 3,
      },
    });
    const run = await experiments.create({
      projectId: project.id,
      projectVersionId: version.id,
      targetId: target.id,
      totalRepetitions: 6,
      modelConfig: {
        provider: 'openai',
        model: 'gpt-x',
        modelVersion: 'v1',
        reasoningEffort: 'low',
        temperature: null,
        maxOutputTokens: 1000,
      } as never,
      randomizationSeed: 'seed-pg',
      budget: { toolCallCap: 8, contextTokenBudget: 4000, maxDurationMs: 60000 },
      executionProfile: 'NODE_TYPESCRIPT',
      runnerHint: 'JEST',
    });

    return { projectId: project.id, versionId: version.id, targetId: target.id, experimentId: run.id };
  }

  it('captures the Sandbox evidence of a RAG repetition and reads it back with its trace, without excerpt code', async () => {
    const ids = await createExperiment();
    // Se siembra la repetición y su traza con las mismas columnas que escribe `beginAttempt` (su lock ya usa
    // $executeRaw desde el corte E; `context-traces.repository.pg.spec.ts` cubre `beginAttempt` de verdad).
    const repetition = await prisma.experimentRepetition.create({
      data: {
        experimentId: ids.experimentId,
        strategy: 'RAG',
        repetition: 1,
        attempt: 1,
        state: 'RUNNING',
        lastHeartbeatAt: new Date(),
      },
    });
    const trace = await prisma.contextTrace.create({
      data: {
        projectId: ids.projectId,
        projectVersionId: ids.versionId,
        targetId: ids.targetId,
        experimentId: ids.experimentId,
        experimentRepetitionId: repetition.id,
        strategy: 'RAG',
        kind: 'RAG',
        repetition: 1,
        attempt: 1,
        current: true,
        state: 'CAPTURING',
      },
    });
    await contextTraces.updateDetail(trace.id, {
      configuration: { minimumScore: 0.5, topK: 5, maxContextTokens: 4000, semanticWeight: 0.7, structuralWeight: 0.3 },
      candidates: [
        {
          chunkId: 'k1',
          rank: 1,
          excerpt: { filePath: 'src/thing.ts', symbolName: 'doIt', parentSymbolName: 'Thing', snippet: SAMPLE_CODE },
          semanticScore: 0.8,
          structuralMatch: 'SAME_NAMESPACE',
          combinedScore: 0.7,
          decision: 'SELECTED',
        },
      ],
      contextTokens: 120,
      functionalRules: { functionalRuleIds: ['kn-1'], retrieved: 1, selected: 1, omitted: [] },
    } as never);

    const written = await experiments.updateRepetitionById(
      repetition.id,
      repetitionInput({
        sandboxExecutionId: 'sbx-pg-1',
        sandboxRequestId: 'req-pg-1',
        sandboxCorrelationId: 'corr-pg-1',
        sandboxFacts: FACTS,
        artifactHash: HASH,
      }) as never,
      'COMPLETED',
    );
    expect(written).toBe(true);

    const rows = await experiments.findRepetitions(ids.experimentId);
    const tracesOfRows = await evidence.findContextTracesByRepetitionIds(rows.map((row) => row.id));
    const run = await experiments.findById(ids.experimentId);
    const bundle = assembleExperimentBundle({
      correlationId: 'corr-pg',
      generatedAt: new Date('2026-10-09T12:00:00.000Z'),
      run: run as never,
      repetitions: rows as never,
      traces: tracesOfRows as never,
    });

    expect(bundle.sandbox).toHaveLength(1);
    expect(bundle.sandbox[0]).toMatchObject({
      executionId: 'sbx-pg-1',
      strategy: 'RAG',
      repetition: 1,
      executionProfile: 'NODE_TYPESCRIPT',
      runnerHint: 'JEST',
      requestId: 'req-pg-1',
      correlationId: 'corr-pg-1',
      durationMs: 200,
    });
    expect(bundle.sandbox[0].facts).toMatchObject({ runner: 'JEST', totalTests: 4, failedTests: 1, failureCode: 'ASSERT_FAILED' });
    expect(bundle.sandbox[0].facts.failureMessage).toBe('expected 2 password=[REDACTED]');
    expect(bundle.generation[0]).toMatchObject({ artifactHash: HASH, durationMs: 300, provider: 'openai', model: 'gpt-x' });
    expect(bundle.retrieval[0]).toMatchObject({ retrievalId: trace.id, config: { finalTopK: 5, semanticWeight: 0.7 } });
    expect(bundle.context[0]).toMatchObject({ contextId: trace.id, selectedChunkIds: ['k1'], functionalRuleIds: ['kn-1'] });
    expect(JSON.stringify(bundle)).not.toContain(SAMPLE_CODE);
    expect(JSON.stringify(bundle)).not.toContain('hunter2');
  });

  it('reads a legacy repetition written without the evidence columns as null, never as 0 or an empty string', async () => {
    const ids = await createExperiment();
    await experiments.insertRepetition(
      ids.experimentId,
      repetitionInput({ strategy: 'GENERALIST_AGENT', generationDurationMs: 0, inputTokens: null, outputTokens: null }) as never,
    );

    const rows = await experiments.findRepetitions(ids.experimentId);
    const bundle = assembleExperimentBundle({
      correlationId: 'corr-pg',
      generatedAt: new Date('2026-10-09T12:00:00.000Z'),
      run: (await experiments.findById(ids.experimentId)) as never,
      repetitions: rows as never,
      traces: [],
    });

    expect(bundle.sandbox).toEqual([]);
    expect(bundle.generation[0]).toMatchObject({ strategy: 'GENERALIST_AGENT', artifactHash: null, inputTokens: null, durationMs: 0 });
    expect(bundle.experimental[0]).toMatchObject({ technicallyEvaluable: true, pairId: null, pairPosition: null, randomizationSeed: 'seed-pg' });
  });

  it('keeps a repetition that is not technically evaluable as technicallyEvaluable false', async () => {
    const ids = await createExperiment();
    await experiments.insertRepetition(
      ids.experimentId,
      repetitionInput({ repetition: 2, technicallyEvaluable: false, valid: null, compiled: null, executed: null, passed: null }) as never,
    );

    const rows = await experiments.findRepetitions(ids.experimentId);
    const bundle = assembleExperimentBundle({
      correlationId: 'corr-pg',
      generatedAt: new Date('2026-10-09T12:00:00.000Z'),
      run: (await experiments.findById(ids.experimentId)) as never,
      repetitions: rows as never,
      traces: [],
    });

    expect(bundle.experimental[0]).toMatchObject({ repetition: 2, technicallyEvaluable: false });
  });

  it('stores a negative execution duration as null (clamp, never 0) and reads the Run evidence with the sandbox identity', async () => {
    const project = await prisma.project.create({ data: { name: `pg-run-${crypto.randomUUID()}` } });
    const version = await prisma.projectVersion.create({ data: { projectId: project.id } });
    const run = await prisma.analysisRun.create({
      data: {
        projectId: project.id,
        repositoryId: 'repo-1',
        repositoryName: 'owner/repo',
        prNumber: 1,
        prTitle: 'pg evidence',
        baseRef: 'main',
        headRef: 'feature',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        changesetBaseSha: 'a'.repeat(40),
        changesetHeadSha: 'b'.repeat(40),
        projectVersionId: version.id,
        status: 'SUCCESS',
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
    const proposal = await prisma.generatedTestProposal.create({
      data: {
        analysisRunId: run.id,
        analysisSymbolId: symbol.id,
        relativePath: 'src/thing.test.ts',
        symbolLanguage: 'TYPESCRIPT',
        symbolKind: 'METHOD',
        qualifiedName: 'Thing.doIt',
        filePath: 'src/thing.ts',
        storageKey: `analysis-runs/${run.id}/proposals/x`,
        contentSha256: 'd'.repeat(64),
        status: 'HELD',
        generation: { provider: 'openai', model: 'gpt-x', modelVersion: null, reasoningEffort: 'low', inputTokens: 5, outputTokens: 3, durationMs: 12 },
      },
    });

    await traces.upsertExecution({
      analysisRunId: run.id,
      proposalId: proposal.id,
      executionId: 'sbx-run-pg',
      attempt: 1,
      executionProfile: 'NODE_TYPESCRIPT',
      outcome: 'BEHAVIORAL_MISMATCH',
      requestId: 'req-run-pg',
      correlationId: 'corr-run-pg',
      durationMs: -40,
      facts: FACTS as never,
      failure: null,
    });

    const [execution] = await evidence.findExecutionsForEvidence(run.id);
    expect(execution.durationMs).toBeNull();

    const bundle = assembleAnalysisRunBundle({
      correlationId: 'corr-pg',
      generatedAt: new Date('2026-10-09T12:00:00.000Z'),
      run: { ...run, projectVersionId: version.id },
      targets: [symbol],
      publication: { status: 'NOT_APPLICABLE', checkId: null, companionBranch: null, companionPullRequestUrl: null, sourceHeadSha: null, freshness: null },
      retrievals: await evidence.findRetrievalsForEvidence(run.id),
      contexts: await evidence.findContextsForEvidence(run.id),
      proposals: await evidence.findProposalsForEvidence(run.id),
      executions: await evidence.findExecutionsForEvidence(run.id),
    } as never);

    expect(bundle.sandbox[0]).toMatchObject({ executionId: 'sbx-run-pg', requestId: 'req-run-pg', correlationId: 'corr-run-pg', durationMs: null, attempt: 1 });
    expect(bundle.generation[0]).toMatchObject({ attempt: 1, provider: 'openai', durationMs: 12, artifactHash: 'd'.repeat(64) });
  });

  it('rejects a negative duration at the column level, which is why the write clamps it', async () => {
    const project = await prisma.project.create({ data: { name: `pg-check-${crypto.randomUUID()}` } });
    const version = await prisma.projectVersion.create({ data: { projectId: project.id } });
    const run = await prisma.analysisRun.create({
      data: {
        projectId: project.id,
        repositoryId: 'repo-2',
        repositoryName: 'owner/repo',
        prNumber: 2,
        prTitle: 'pg check',
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
      data: { analysisRunId: run.id, language: 'TYPESCRIPT', kind: 'FUNCTION', qualifiedName: 'f', filePath: 'src/f.ts', changeKind: 'DIRECTLY_CHANGED' },
    });
    const proposal = await prisma.generatedTestProposal.create({
      data: {
        analysisRunId: run.id,
        analysisSymbolId: symbol.id,
        relativePath: 'src/f.test.ts',
        symbolLanguage: 'TYPESCRIPT',
        symbolKind: 'FUNCTION',
        qualifiedName: 'f',
        filePath: 'src/f.ts',
        storageKey: `analysis-runs/${run.id}/proposals/y`,
        contentSha256: 'f'.repeat(64),
        status: 'AVAILABLE',
      },
    });

    await expect(
      prisma.analysisRunExecution.create({
        data: {
          analysisRunId: run.id,
          proposalId: proposal.id,
          executionId: 'sbx-neg',
          attempt: 1,
          executionProfile: 'NODE_TYPESCRIPT',
          outcome: 'SUCCESS',
          durationMs: -1,
        },
      }),
    ).rejects.toThrow();
  });
});
