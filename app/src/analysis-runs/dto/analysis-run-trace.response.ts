import type { AnalysisSymbolResponse } from './analysis-run.response.js';

/**
 * WI-CORE-026: forma de `GET /analysis-runs/{id}/trace` (INTEROP-2.7 §6.16). El trace no contiene
 * chain-of-thought, secretos, código fuente, conteos de contexto, omitidas ni `knowledgeId` fuera de
 * `context.functionalRuleIds`.
 */
export type TraceLinkStatus = 'PRESENT' | 'NOT_APPLICABLE';

export interface TraceExecutionResponse {
  /** Identificador del Sandbox. */
  executionId: string;
  proposalId: string;
  attempt: number;
  executionProfile: string;
  /** Clasificación técnica ya expuesta por el Run (SUCCESS, BEHAVIORAL_MISMATCH, TECHNICAL_GENERATION_FAILURE). */
  outcome: string;
}

export interface TraceTargetResponse {
  symbol: AnalysisSymbolResponse;
  retrieval: { status: TraceLinkStatus; retrievalId: string | null };
  context: { status: TraceLinkStatus; contextId: string | null; functionalRuleIds: string[] };
  generation: { status: TraceLinkStatus; proposalIds: string[] };
  executions: { status: TraceLinkStatus; items: TraceExecutionResponse[] };
}

export interface TracePublicationResponse {
  status: TraceLinkStatus;
  checkId: string | null;
  companionBranch: string | null;
  companionPullRequestUrl: string | null;
  sourceHeadSha: string | null;
  freshness: 'CURRENT' | 'STALE' | null;
}

export interface AnalysisRunTraceResponse {
  analysisRunId: string;
  repositoryName: string;
  pullRequestNumber: number;
  headSha: string;
  changeset: { status: TraceLinkStatus; targetCount: number };
  targets: TraceTargetResponse[];
  publication: TracePublicationResponse;
}
