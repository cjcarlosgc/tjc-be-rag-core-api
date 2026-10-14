export type ContextTraceKind = 'RAG' | 'AGENT';
export type ContextTraceStrategy = 'RAG' | 'GENERALIST_AGENT';

export interface ContextTraceSummaryResponse {
  id: string;
  kind: ContextTraceKind;
  projectVersionId: string;
  targetId: string;
  testRunId: null;
  experimentId: string;
  strategy: ContextTraceStrategy;
  repetition: 1 | 2 | 3;
  attempt: number;
  current: boolean;
  artifactIds: [];
  createdAt: string;
}

export interface SourceLineResponse {
  lineNumber: number;
  content: string;
}

export interface SourceExcerptResponse {
  filePath: string;
  symbolName: string | null;
  parentSymbolName: string | null;
  startLine: number | null;
  endLine: number | null;
  snippet: string;
  before: SourceLineResponse[];
  after: SourceLineResponse[];
  contentSha256: string;
  truncated: boolean;
}

export type RagStructuralMatch =
  'IMPORTS' | 'IMPORTED_BY' | 'SAME_NAMESPACE' | 'FULLY_QUALIFIED_REFERENCE' | 'DECLARING_CLASS';
export type RagMatchedVia = 'SEMANTIC' | RagStructuralMatch;
export type RagCandidateDecision = 'SELECTED' | 'DISCARDED';
export type RagDiscardReason =
  'BELOW_MINIMUM_SCORE' | 'TOP_K_LIMIT' | 'TOKEN_BUDGET';

export interface RagTargetNodeResponse {
  chunkIds: string[];
  excerpt: SourceExcerptResponse;
  tokenCount: number;
}

export interface RagCandidateNodeResponse {
  chunkId: string;
  rank: number;
  excerpt: SourceExcerptResponse;
  tokenCount: number;
  semanticScore: number | null;
  structuralMatch: RagStructuralMatch | null;
  combinedScore: number;
  matchedVia: RagMatchedVia[];
  decision: RagCandidateDecision;
  discardReason: RagDiscardReason | null;
}

export type RagDependencyOrigin = 'CONSTRUCTOR' | 'METHOD_SIGNATURE';
export type RagDependencyResolvedBy = 'LITERAL' | 'IMPORT' | 'SAME_NAMESPACE';

/** INTEROP-2.14 (WI-CORE-057): FQCN verificado contra el índice de la versión, sin '\' inicial. */
export interface RagDependencyEntryResponse {
  typeName: string;
  fqcn: string;
  origin: RagDependencyOrigin;
  resolvedBy: RagDependencyResolvedBy;
  /** INTEROP-2.15 (WI-CORE-058): presente solo cuando el tipo es final o enum según el índice; ausente = no determinado o no final. */
  final?: true;
}

/** INTEROP-2.14 (WI-CORE-057): contexto no rankeado; no cuenta en contextTokens. */
export interface RagDependencyContextResponse {
  entries: RagDependencyEntryResponse[];
  unresolvedCount: number;
  tokenCount: number;
  truncated: boolean;
}

export interface RagContextTraceDetailResponse extends ContextTraceSummaryResponse {
  kind: 'RAG';
  target: RagTargetNodeResponse;
  candidates: RagCandidateNodeResponse[];
  retrievedChunks: number;
  selectedChunks: number;
  contextTokens: number;
  configuration: {
    minimumScore: number;
    topK: number;
    maxContextTokens: number;
    semanticWeight: number;
    structuralWeight: number;
  };
  /** INTEROP-2.14; solo PHP; ausente en trazas anteriores y en TypeScript. */
  dependencyContext?: RagDependencyContextResponse;
}

export type AgentToolName =
  'list_files' | 'search_text' | 'inspect_symbol' | 'read_file';
export type AgentStepStatus = 'SUCCEEDED' | 'EMPTY' | 'FAILED';
export type AgentObservationKind =
  'FILE_LIST_SUMMARY' | 'TEXT_MATCH' | 'SYMBOL' | 'FILE_CONTENT';

export interface AgentObservationResponse {
  kind: AgentObservationKind;
  filePath: string | null;
  symbolName: string | null;
  excerpt: SourceExcerptResponse | null;
  discoveredFilesCount: number | null;
}

export interface AgentTrajectoryStepResponse {
  step: number;
  toolName: AgentToolName;
  arguments: Record<string, unknown>;
  status: AgentStepStatus;
  resultSummary: string;
  resultSha256: string;
  truncated: boolean;
  observations: AgentObservationResponse[];
}

export interface AgentContextTraceDetailResponse extends ContextTraceSummaryResponse {
  kind: 'AGENT';
  trajectory: AgentTrajectoryStepResponse[];
  toolCalls: number;
  filesInspected: number;
}

export interface DiscoveredFileResponse {
  filePath: string;
}

export type ContextTraceDetailResponse =
  RagContextTraceDetailResponse | AgentContextTraceDetailResponse;
