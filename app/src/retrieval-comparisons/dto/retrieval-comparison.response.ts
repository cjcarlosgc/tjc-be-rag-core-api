/** INTEROP-2.7 §6.15: respuesta `202` de la creación; la comparación se consulta por `retrievalComparisonId`. */
export interface RetrievalComparisonAcceptedResponse {
  analysisRunId: string;
  retrievalComparisonId: string;
  projectVersionId: string;
  status: 'PENDING';
  pollAfterMs: number;
}
