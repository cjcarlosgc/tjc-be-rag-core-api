import type { AnalysisSymbolResponse } from '../../analysis-runs/dto/analysis-run.response.js';
import type { TracePublicationResponse } from '../../analysis-runs/dto/analysis-run-trace.response.js';
import type { ExecutionProfile } from '../../sandbox/sandbox.types.js';
import type { SandboxEvidenceFacts } from '../../sandbox/sandbox-evidence-facts.js';
import type {
  RetrievalMetricsResponse,
  StructuralRelation,
} from '../../retrieval-comparisons/dto/retrieval-comparison.response.js';

/**
 * WI-CORE-027 (INTEROP-2.7 §6.16, `EvidenceBundleResponse`). Forma con los tipos de §5.1 del informe del
 * contract-reviewer (`harness/reports/wi-core-027-contract-review.md`) y las decisiones DEC-EVID-002 y 007.
 * Un dato no observado es `null`, nunca `0` ni cadena vacía. `schemaVersion` se mantiene en `'1'`.
 */
export const EVIDENCE_SCHEMA_VERSION = '1' as const;

export type EvidenceKind = 'ANALYSIS_RUN' | 'EXPERIMENT' | 'RETRIEVAL_COMPARISON';

/** `PRODUCT` para un AnalysisRun; las estrategias experimentales en un experimento. */
export type EvidenceStrategy = 'PRODUCT' | 'RAG' | 'GENERALIST_AGENT';

export type EvidenceRetrievalMode = 'SE' | 'SEM';

/** `runnerHint` de §6.16: los valores de `TestRunner` (§7.1); cualquier otro valor se exporta como `null`. */
export type EvidenceRunnerHint = 'JEST' | 'VITEST' | 'PHPUNIT';

export interface EvidenceAnalysisRunResponse {
  analysisRunId: string;
  repositoryName: string;
  pullRequestNumber: number;
  headSha: string;
  projectVersionId: string | null;
  /** Referencia opaca derivada del proyecto y del HEAD; nunca una clave de almacenamiento ni una URL. */
  snapshotRef: string | null;
  targets: AnalysisSymbolResponse[];
  createdAt: string;
}

/**
 * `config` de un resultado de retrieval de la evidencia. Tipo propio (DEC-EVID-007), no alias de §6.15: todos
 * sus campos admiten `null` cuando el dato no se persistió.
 */
export interface EvidenceRetrievalConfigResponse {
  semanticTopK: number | null;
  finalTopK: number | null;
  semanticWeight: number | null;
  structuralWeight: number | null;
  embeddingModel: string | null;
}

/**
 * Candidato de retrieval de la evidencia. Como `RetrievalCandidateResponse` de §6.15, con cada campo que
 * puede no haberse observado en `null`. `filePath` es `null` solo en una fila RAG de experimento sin
 * fragmento de origen; la forma completa de §6.15 no es alcanzable sin inventar datos.
 */
export interface EvidenceRetrievalCandidateResponse {
  rank: number | null;
  chunkId: string | null;
  filePath: string | null;
  symbolQualifiedName: string | null;
  semanticScore: number | null;
  structuralRelation: StructuralRelation | null;
  combinedScore: number | null;
  selected: boolean | null;
}

export interface EvidenceRetrievalResponse {
  retrievalId: string;
  mode: EvidenceRetrievalMode;
  config: EvidenceRetrievalConfigResponse;
  candidates: EvidenceRetrievalCandidateResponse[];
  metrics: RetrievalMetricsResponse | null;
}

export interface EvidenceContextResponse {
  contextId: string;
  selectedChunkIds: string[];
  discardedChunkIds: string[];
  tokenCounts: { selected: number | null; budget: number | null };
  functionalRuleIds: string[];
}

export interface EvidenceGenerationResponse {
  strategy: EvidenceStrategy;
  repetition: number | null;
  attempt: number | null;
  provider: string | null;
  model: string | null;
  modelVersion: string | null;
  reasoningEffort: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  artifactHash: string | null;
}

export interface EvidenceAgentStepResponse {
  step: number | null;
  toolName: string | null;
  status: string | null;
}

export interface EvidenceAgentExplorationResponse {
  toolCallCap: number | null;
  steps: EvidenceAgentStepResponse[];
  filesInspected: number | null;
  contextTokenBudget: number | null;
}

export interface EvidenceSandboxResponse {
  executionId: string | null;
  strategy: EvidenceStrategy;
  repetition: number | null;
  executionProfile: ExecutionProfile | null;
  runnerHint: EvidenceRunnerHint | null;
  attempt: number;
  /** Las 14 claves cerradas de §6.16 (solo conteos y banderas, con `failureMessage` ya saneado). */
  facts: SandboxEvidenceFacts;
  durationMs: number | null;
  requestId: string | null;
  correlationId: string | null;
}

export interface EvidenceExperimentalResponse {
  experimentId: string;
  strategy: 'RAG' | 'GENERALIST_AGENT';
  repetition: number;
  pairId: string | null;
  pairPosition: 1 | 2 | null;
  attempt: number;
  randomizationSeed: string | null;
  technicallyEvaluable: boolean;
}

export interface EvidenceBundleResponse {
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  kind: EvidenceKind;
  subjectId: string;
  generatedAt: string;
  correlationId: string;
  analysisRun: EvidenceAnalysisRunResponse | null;
  retrieval: EvidenceRetrievalResponse[];
  context: EvidenceContextResponse[];
  generation: EvidenceGenerationResponse[];
  agentExploration: EvidenceAgentExplorationResponse[];
  sandbox: EvidenceSandboxResponse[];
  experimental: EvidenceExperimentalResponse[];
  publication: TracePublicationResponse | null;
}
