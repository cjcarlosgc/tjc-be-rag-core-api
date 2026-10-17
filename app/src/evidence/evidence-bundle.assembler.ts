import type { AnalysisSymbol } from '../generated/prisma/client.js';
import { toAnalysisSymbolResponse } from '../analysis-runs/dto/analysis-run.response.js';
import type { TracePublicationResponse } from '../analysis-runs/dto/analysis-run-trace.response.js';
import {
  EVIDENCE_SCHEMA_VERSION,
  type EvidenceAgentExplorationResponse,
  type EvidenceBundleResponse,
  type EvidenceContextResponse,
  type EvidenceExperimentalResponse,
  type EvidenceGenerationResponse,
  type EvidenceRetrievalResponse,
  type EvidenceSandboxResponse,
} from './dto/evidence-bundle.response.js';
import {
  artifactHashOf,
  ragCandidateIdsByDecision,
  isRecord,
  snapshotRefFor,
  toAgentSteps,
  toCount,
  toComparisonCandidates,
  toComparisonRetrievalConfig,
  toEvidenceFacts,
  toExecutionProfile,
  toPairPosition,
  toRagCandidates,
  toRagRetrievalConfig,
  toRetrievalMetrics,
  toRunCandidates,
  toRunRetrievalConfig,
  toRunnerHint,
  toSha256,
  toText,
  toTextList,
} from './evidence-mapping.js';

/** Cuándo y para qué petición se ensambla el bundle; el reloj y el correlationId los fija el servicio. */
export interface EvidenceAssemblyContext {
  correlationId: string;
  generatedAt: Date;
}

export interface RunRetrievalRow {
  id: string;
  analysisSymbolId: string;
  mode: 'SE' | 'SEM';
  config: unknown;
  candidates: unknown;
}

export interface RunContextRow {
  id: string;
  analysisSymbolId: string;
  selectedChunkIds: string[];
  discardedChunkIds: string[];
  selectedTokens: number;
  tokenBudget: number;
  functionalRuleIds: string[];
}

export interface RunProposalRow {
  id: string;
  contentSha256: string;
  generation: unknown;
}

export interface RunExecutionRow {
  id: string;
  proposalId: string;
  executionId: string;
  attempt: number;
  executionProfile: string;
  requestId: string | null;
  correlationId: string | null;
  durationMs: number | null;
  facts: unknown;
}

export interface AnalysisRunEvidenceInput extends EvidenceAssemblyContext {
  run: {
    id: string;
    repositoryName: string;
    prNumber: number;
    headSha: string;
    projectVersionId: string | null;
    createdAt: Date;
  };
  /** Objetivos del trace, en su orden (`AnalysisRunTraceService.loadTargets`). */
  targets: AnalysisSymbol[];
  publication: TracePublicationResponse;
  retrievals: RunRetrievalRow[];
  contexts: RunContextRow[];
  /** Propuestas del Run en orden de creación. */
  proposals: RunProposalRow[];
  /** Ejecuciones del Run en orden de intento. */
  executions: RunExecutionRow[];
}

export interface ExperimentRunRow {
  id: string;
  randomizationSeed: string | null;
  executionProfile: string | null;
  runnerHint: string | null;
  modelConfig: unknown;
}

export interface ExperimentRepetitionRow {
  id: string;
  strategy: 'RAG' | 'GENERALIST_AGENT';
  repetition: number;
  attempt: number;
  pairId: string | null;
  pairPosition: number | null;
  technicallyEvaluable: boolean;
  generationDurationMs: number | null;
  /** Duración de la llamada al Sandbox (`Date.now()` antes/después); `null` si no hubo invocación. */
  executionDurationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  artifactHash: string | null;
  sandboxExecutionId: string | null;
  sandboxRequestId: string | null;
  sandboxCorrelationId: string | null;
  sandboxFacts: unknown;
}

export interface ExperimentTraceRow {
  id: string;
  experimentRepetitionId: string;
  kind: 'RAG' | 'AGENT';
  detail: unknown;
}

export interface ExperimentEvidenceInput extends EvidenceAssemblyContext {
  run: ExperimentRunRow;
  /** Intento vigente de cada repetición lógica (último intento por slot). */
  repetitions: ExperimentRepetitionRow[];
  /** Trazas de los intentos vigentes; se unen por `experimentRepetitionId`. */
  traces: ExperimentTraceRow[];
}

export interface ComparisonResultRow {
  id: string;
  mode: 'SE' | 'SEM';
  config: unknown;
  candidates: unknown;
  metrics: unknown;
}

export interface RetrievalComparisonEvidenceInput extends EvidenceAssemblyContext {
  comparison: { id: string; status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' };
  /** Resultados de la comparación; solo se leen si está COMPLETED (en FAILED el bundle no trae retrieval). */
  results: ComparisonResultRow[];
}

const MODE_ORDER: Record<string, number> = { SE: 0, SEM: 1 };

function bundleBase(
  kind: EvidenceBundleResponse['kind'],
  subjectId: string,
  context: EvidenceAssemblyContext,
): Omit<EvidenceBundleResponse, 'analysisRun' | 'retrieval' | 'context' | 'generation' | 'agentExploration' | 'sandbox' | 'experimental' | 'publication'> {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind,
    subjectId,
    generatedAt: context.generatedAt.toISOString(),
    correlationId: context.correlationId,
  };
}

/**
 * Bundle de un AnalysisRun. Reutiliza los targets y la publicación del trace (WI-CORE-026). Un target sin
 * retrieval, contexto o ejecución no aparece en su sección; las secciones sin datos quedan vacías.
 */
export function assembleAnalysisRunBundle(input: AnalysisRunEvidenceInput): EvidenceBundleResponse {
  const { run, targets } = input;
  const retrievalBySymbol = new Map(input.retrievals.map((row) => [row.analysisSymbolId, row]));
  const contextBySymbol = new Map(input.contexts.map((row) => [row.analysisSymbolId, row]));
  const executionsByProposal = groupExecutions(input.executions);

  const retrieval: EvidenceRetrievalResponse[] = [];
  const context: EvidenceContextResponse[] = [];

  for (const symbol of targets) {
    const retrievalRow = retrievalBySymbol.get(symbol.id);
    const contextRow = contextBySymbol.get(symbol.id);

    if (retrievalRow) {
      retrieval.push({
        retrievalId: retrievalRow.id,
        mode: retrievalRow.mode,
        config: toRunRetrievalConfig(retrievalRow.config),
        candidates: toRunCandidates(retrievalRow.candidates, contextRow ? new Set(contextRow.selectedChunkIds) : null),
        metrics: null,
      });
    }

    if (contextRow) {
      context.push({
        contextId: contextRow.id,
        selectedChunkIds: contextRow.selectedChunkIds,
        discardedChunkIds: contextRow.discardedChunkIds,
        tokenCounts: { selected: contextRow.selectedTokens, budget: contextRow.tokenBudget },
        functionalRuleIds: contextRow.functionalRuleIds,
      });
    }
  }

  const generation: EvidenceGenerationResponse[] = input.proposals.map((proposal) => {
    const generated = isRecord(proposal.generation) ? proposal.generation : {};
    const attempts = (executionsByProposal.get(proposal.id) ?? []).map((execution) => execution.attempt);

    return {
      strategy: 'PRODUCT',
      repetition: null,
      attempt: attempts.length > 0 ? Math.max(...attempts) : null,
      provider: toText(generated.provider),
      model: toText(generated.model),
      modelVersion: toText(generated.modelVersion),
      reasoningEffort: toText(generated.reasoningEffort),
      inputTokens: toCount(generated.inputTokens),
      outputTokens: toCount(generated.outputTokens),
      durationMs: toCount(generated.durationMs),
      artifactHash: artifactHashOf(proposal.contentSha256),
    };
  });

  const sandbox: EvidenceSandboxResponse[] = input.executions.map((execution) => {
    const facts = toEvidenceFacts(execution.facts, toExecutionProfile(execution.executionProfile));

    return {
      executionId: toText(execution.executionId),
      strategy: 'PRODUCT',
      repetition: null,
      executionProfile: facts.executionProfile,
      runnerHint: facts.runner,
      attempt: execution.attempt,
      facts,
      durationMs: toCount(execution.durationMs),
      requestId: toText(execution.requestId),
      correlationId: toText(execution.correlationId),
    };
  });

  return {
    ...bundleBase('ANALYSIS_RUN', run.id, input),
    analysisRun: {
      analysisRunId: run.id,
      repositoryName: run.repositoryName,
      pullRequestNumber: run.prNumber,
      headSha: run.headSha,
      projectVersionId: run.projectVersionId,
      snapshotRef: snapshotRefFor(run.projectVersionId, run.headSha),
      targets: targets.map((symbol) => toAnalysisSymbolResponse(symbol)),
      createdAt: run.createdAt.toISOString(),
    },
    retrieval,
    context,
    generation,
    agentExploration: [],
    sandbox,
    experimental: [],
    publication: input.publication,
  };
}

/**
 * Bundle de un experimento: por cada intento vigente de repetición. RAG aporta retrieval y contexto desde su
 * traza (`retrievalId = contextId = ContextTrace.id`, DEC-EVID-005); GENERALIST_AGENT aporta la exploración.
 * Sandbox solo aparece si la repetición invocó al Sandbox y la captura lo registró.
 */
export function assembleExperimentBundle(input: ExperimentEvidenceInput): EvidenceBundleResponse {
  const { run } = input;
  const modelConfig = isRecord(run.modelConfig) ? run.modelConfig : {};
  const tracesByRepetition = new Map(input.traces.map((trace) => [trace.experimentRepetitionId, trace]));

  const retrieval: EvidenceRetrievalResponse[] = [];
  const context: EvidenceContextResponse[] = [];
  const generation: EvidenceGenerationResponse[] = [];
  const agentExploration: EvidenceAgentExplorationResponse[] = [];
  const sandbox: EvidenceSandboxResponse[] = [];
  const experimental: EvidenceExperimentalResponse[] = [];

  for (const repetition of input.repetitions) {
    const trace = tracesByRepetition.get(repetition.id);

    experimental.push({
      experimentId: run.id,
      strategy: repetition.strategy,
      repetition: repetition.repetition,
      pairId: toText(repetition.pairId),
      pairPosition: toPairPosition(repetition.pairPosition),
      attempt: repetition.attempt,
      randomizationSeed: toText(run.randomizationSeed),
      technicallyEvaluable: repetition.technicallyEvaluable,
    });

    generation.push({
      strategy: repetition.strategy,
      repetition: repetition.repetition,
      attempt: repetition.attempt,
      provider: toText(modelConfig.provider),
      model: toText(modelConfig.model),
      modelVersion: toText(modelConfig.modelVersion),
      reasoningEffort: toText(modelConfig.reasoningEffort),
      inputTokens: toCount(repetition.inputTokens),
      outputTokens: toCount(repetition.outputTokens),
      durationMs: toCount(repetition.generationDurationMs),
      artifactHash: toSha256(repetition.artifactHash),
    });

    if (trace && repetition.strategy === 'RAG' && trace.kind === 'RAG') {
      const detail = isRecord(trace.detail) ? trace.detail : {};
      const configuration = detail.configuration;
      const functionalRules = isRecord(detail.functionalRules) ? detail.functionalRules : {};

      retrieval.push({
        retrievalId: trace.id,
        mode: 'SE',
        config: toRagRetrievalConfig(configuration),
        candidates: toRagCandidates(detail.candidates),
        metrics: null,
      });
      context.push({
        contextId: trace.id,
        selectedChunkIds: ragCandidateIdsByDecision(detail, 'SELECTED'),
        discardedChunkIds: ragCandidateIdsByDecision(detail, 'DISCARDED'),
        tokenCounts: {
          selected: toCount(detail.contextTokens),
          budget: toCount(isRecord(configuration) ? configuration.maxContextTokens : null),
        },
        functionalRuleIds: toTextList(functionalRules.functionalRuleIds),
      });
    }

    if (trace && repetition.strategy === 'GENERALIST_AGENT' && trace.kind === 'AGENT') {
      const detail = isRecord(trace.detail) ? trace.detail : {};
      const budget = isRecord(detail.budget) ? detail.budget : {};

      agentExploration.push({
        toolCallCap: toCount(budget.toolCallCap),
        steps: toAgentSteps(detail.trajectory),
        filesInspected: toCount(detail.filesInspected),
        contextTokenBudget: toCount(budget.contextTokenBudget),
      });
    }

    if (hasSandboxEvidence(repetition)) {
      const facts = toEvidenceFacts(repetition.sandboxFacts, toExecutionProfile(run.executionProfile));

      sandbox.push({
        executionId: toText(repetition.sandboxExecutionId),
        strategy: repetition.strategy,
        repetition: repetition.repetition,
        executionProfile: facts.executionProfile,
        runnerHint: toRunnerHint(run.runnerHint),
        attempt: repetition.attempt,
        facts,
        durationMs: toCount(repetition.executionDurationMs),
        requestId: toText(repetition.sandboxRequestId),
        correlationId: toText(repetition.sandboxCorrelationId),
      });
    }
  }

  return {
    ...bundleBase('EXPERIMENT', run.id, input),
    analysisRun: null,
    retrieval,
    context,
    generation,
    agentExploration,
    sandbox,
    experimental,
    publication: null,
  };
}

/**
 * Bundle de una comparación de retrieval. `retrieval` sale de los resultados SE y SEM con sus métricas (sin
 * `groundTruth`); una comparación FAILED no trae resultados y su `retrieval` es `[]`.
 */
export function assembleRetrievalComparisonBundle(input: RetrievalComparisonEvidenceInput): EvidenceBundleResponse {
  const results = input.comparison.status === 'FAILED' ? [] : input.results;
  const retrieval: EvidenceRetrievalResponse[] = [...results]
    .sort((a, b) => (MODE_ORDER[a.mode] ?? 0) - (MODE_ORDER[b.mode] ?? 0))
    .map((row) => ({
      retrievalId: row.id,
      mode: row.mode,
      config: toComparisonRetrievalConfig(row.config),
      candidates: toComparisonCandidates(row.candidates),
      metrics: toRetrievalMetrics(row.metrics),
    }));

  return {
    ...bundleBase('RETRIEVAL_COMPARISON', input.comparison.id, input),
    analysisRun: null,
    retrieval,
    context: [],
    generation: [],
    agentExploration: [],
    sandbox: [],
    experimental: [],
    publication: null,
  };
}

/** Un intento aporta Sandbox si su identidad o sus hechos se capturaron; sin invocación no hay entrada. */
function hasSandboxEvidence(repetition: ExperimentRepetitionRow): boolean {
  return (
    repetition.sandboxExecutionId !== null ||
    repetition.sandboxRequestId !== null ||
    repetition.sandboxCorrelationId !== null ||
    (repetition.sandboxFacts !== null && repetition.sandboxFacts !== undefined)
  );
}

function groupExecutions(executions: RunExecutionRow[]): Map<string, RunExecutionRow[]> {
  const groups = new Map<string, RunExecutionRow[]>();
  for (const execution of executions) {
    const bucket = groups.get(execution.proposalId);
    if (bucket) bucket.push(execution);
    else groups.set(execution.proposalId, [execution]);
  }
  return groups;
}
