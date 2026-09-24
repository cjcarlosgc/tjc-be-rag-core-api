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

export type RagMatchedVia = 'SEMANTIC' | 'IMPORTS' | 'IMPORTED_BY';
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
  structuralMatch: 'IMPORTS' | 'IMPORTED_BY' | null;
  combinedScore: number;
  matchedVia: RagMatchedVia[];
  decision: RagCandidateDecision;
  discardReason: RagDiscardReason | null;
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
