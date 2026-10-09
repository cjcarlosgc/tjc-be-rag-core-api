import type { AnalysisSymbolResponse } from '../../analysis-runs/dto/analysis-run.response.js';
import type { RetrievalComparison, RetrievalComparisonResult } from '../../generated/prisma/client.js';
import type { Page } from '../../common/dto/page.response.js';

/** INTEROP-2.7 §6.15: respuesta `202` de la creación; la comparación se consulta por `retrievalComparisonId`. */
export interface RetrievalComparisonAcceptedResponse {
  analysisRunId: string;
  retrievalComparisonId: string;
  projectVersionId: string;
  status: 'PENDING';
  pollAfterMs: number;
}

export type RetrievalComparisonStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type RetrievalResponseMode = 'SE' | 'SEM';
export type StructuralRelation = 'IMPORTS' | 'IMPORTED_BY' | 'SAME_NAMESPACE' | 'FULLY_QUALIFIED_REFERENCE' | 'DECLARING_CLASS';

export interface RetrievalComparisonStatusResponse {
  id: string;
  analysisRunId: string;
  projectId: string;
  projectVersionId: string;
  symbol: AnalysisSymbolResponse;
  status: RetrievalComparisonStatus;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RetrievalCandidateResponse {
  rank: number;
  chunkId: string;
  filePath: string;
  symbolQualifiedName: string | null;
  semanticScore: number | null;
  structuralRelation: StructuralRelation | null;
  combinedScore: number | null;
  selected: boolean;
}

export interface RetrievalMetricsResponse {
  precisionAt5: number;
  recallAt5: number;
  precisionAt10: number;
  recallAt10: number;
}

export interface RetrievalModeResultResponse {
  mode: RetrievalResponseMode;
  retrievalId: string;
  config: {
    semanticTopK: number;
    finalTopK: number;
    semanticWeight: number | null;
    structuralWeight: number | null;
    embeddingModel: string;
  };
  candidates: RetrievalCandidateResponse[];
  metrics: RetrievalMetricsResponse | null;
}

export interface RetrievalComparisonResultsResponse {
  retrievalComparisonId: string;
  analysisRunId: string;
  projectVersionId: string;
  symbol: AnalysisSymbolResponse;
  /** Exactamente SE y SEM en una comparación COMPLETED; vacío en FAILED (no hubo resultados persistidos). */
  modes: RetrievalModeResultResponse[];
  completedAt: string;
}

/** El snapshot `symbol` se escribe al crear con la forma de `AnalysisSymbolResponse` (ver el servicio). */
export function toRetrievalComparisonStatusResponse(row: RetrievalComparison): RetrievalComparisonStatusResponse {
  return {
    id: row.id,
    analysisRunId: row.analysisRunId,
    projectId: row.projectId,
    projectVersionId: row.projectVersionId,
    symbol: row.symbol as unknown as AnalysisSymbolResponse,
    status: row.status,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export function toRetrievalModeResultResponse(row: RetrievalComparisonResult): RetrievalModeResultResponse {
  return {
    mode: row.mode,
    retrievalId: row.id,
    config: row.config as unknown as RetrievalModeResultResponse['config'],
    candidates: row.candidates as unknown as RetrievalCandidateResponse[],
    metrics: (row.metrics ?? null) as unknown as RetrievalMetricsResponse | null,
  };
}

export function toRetrievalComparisonPage(
  page: { items: RetrievalComparison[]; nextCursor: string | null },
): Page<RetrievalComparisonStatusResponse> {
  return { items: page.items.map(toRetrievalComparisonStatusResponse), nextCursor: page.nextCursor };
}
