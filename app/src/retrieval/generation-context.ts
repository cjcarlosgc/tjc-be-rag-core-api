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
}
