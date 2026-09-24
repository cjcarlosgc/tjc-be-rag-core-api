export interface RetrievalTarget {
  filePath: string;
  symbolName: string;
  methodName: string | null;
  targetType: 'METHOD' | 'FUNCTION';
}

export type StructuralMatch = 'IMPORTS' | 'IMPORTED_BY';

export interface ContextChunk {
  filePath: string;
  symbolKind: string;
  symbolName: string | null;
  parentSymbolName: string | null;
  content: string;
  score: number;
  matchedVia: Array<'SEMANTIC' | StructuralMatch>;
}

export interface GenerationContextMetadata {
  language: 'typescript';
  framework: 'JEST' | 'VITEST' | null;
}

export interface GenerationContextTarget {
  filePath: string;
  symbolName: string;
  methodName: string | null;
  targetType: 'METHOD' | 'FUNCTION';
  content: string;
}

export interface GenerationContext {
  target: GenerationContextTarget;
  relatedChunks: ContextChunk[];
  metadata: GenerationContextMetadata;
  retrievedChunks: number;
  selectedChunks: number;
  contextTokens: number;
  /** Evidence about retrieval and selection. PromptBuilder intentionally ignores this field. */
  audit?: GenerationContextAudit;
}

export type RagCandidateDecision = 'SELECTED' | 'DISCARDED';
export type RagDiscardReason =
  'BELOW_MINIMUM_SCORE' | 'TOP_K_LIMIT' | 'TOKEN_BUDGET';

export interface GenerationContextAuditChunk {
  chunkId: string;
  filePath: string;
  symbolKind: string;
  symbolName: string | null;
  parentSymbolName: string | null;
  startLine: number;
  endLine: number;
  content: string;
  tokenCount: number;
}

export interface GenerationContextAuditCandidate extends GenerationContextAuditChunk {
  rank: number;
  semanticScore: number | null;
  structuralMatch: StructuralMatch | null;
  combinedScore: number;
  matchedVia: Array<'SEMANTIC' | StructuralMatch>;
  decision: RagCandidateDecision;
  discardReason: RagDiscardReason | null;
}

export interface GenerationContextAudit {
  target: {
    chunkIds: string[];
    chunks: GenerationContextAuditChunk[];
    tokenCount: number;
  };
  candidates: GenerationContextAuditCandidate[];
  configuration: {
    minimumScore: number;
    topK: number;
    maxContextTokens: number;
    semanticWeight: number;
    structuralWeight: number;
  };
}
