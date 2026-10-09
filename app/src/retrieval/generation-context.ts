export interface RetrievalTarget {
  filePath: string;
  symbolName: string;
  methodName: string | null;
  targetType: 'METHOD' | 'FUNCTION';
}

import type {
  ConfirmingRole,
  FunctionalKnowledgeSource,
  FunctionalScope,
} from '../generated/prisma/client.js';

export type StructuralMatch = 'IMPORTS' | 'IMPORTED_BY';

/**
 * Procedencia de una regla funcional (INTEROP-2.7, WI-CORE-019). Cada campo es nulo en reglas
 * históricas anteriores a esa versión. `confirmedByUserId` no sale hacia el prompt.
 */
export interface FunctionalRuleProvenance {
  confirmedByUserId: string | null;
  confirmedRole: ConfirmingRole | null;
  originHeadSha: string | null;
  sourceRef: string | null;
}

/**
 * Regla funcional ACTIVE recuperada de `FunctionalKnowledge` (WI-CORE-021). Es conocimiento
 * aprobado, no código: nunca entra en `relatedChunks` ni en el bloque de código del prompt.
 */
export interface FunctionalRule {
  knowledgeId: string;
  scenarioKey: string;
  normalizedRule: string;
  scope: FunctionalScope;
  targetRef: string;
  source: FunctionalKnowledgeSource;
  provenance: FunctionalRuleProvenance;
}

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
  /** Reglas funcionales incluidas en el prompt (las que caben en el presupuesto, en orden). */
  functionalRules: FunctionalRule[];
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

export interface GenerationContextAuditFunctionalRuleOmission {
  knowledgeId: string;
  tokenCount: number;
  reason: 'TOKEN_BUDGET';
}

export interface GenerationContextAuditFunctionalRules {
  /** Reglas ACTIVE recuperadas para el target. */
  retrieved: number;
  /** Reglas incluidas en el contexto. */
  selected: number;
  /** Tokens consumidos por las reglas incluidas. */
  tokenCount: number;
  omitted: GenerationContextAuditFunctionalRuleOmission[];
}

export interface GenerationContextAudit {
  /** Evidence about functional rules. Never serialized into ContextTrace (WI-CORE-021). */
  functionalRules: GenerationContextAuditFunctionalRules;
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
