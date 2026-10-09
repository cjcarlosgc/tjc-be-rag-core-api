import type { RetrievalResult } from '../retrieval/retrieval.service.js';
import type { GenerationContext } from '../retrieval/generation-context.js';
import { toFunctionalRuleEvidence, type FunctionalRuleEvidence } from '../retrieval/functional-rule-evidence.js';

/**
 * Forma persistible de un candidato de retrieval (`analysis_retrievals.candidates`). Nunca incluye
 * `content`: el trace operativo no devuelve ni almacena código fuente.
 */
export type RetrievalCandidateEvidence = {
  chunkId: string;
  filePath: string;
  symbolKind: string;
  symbolName: string | null;
  parentSymbolName: string | null;
  startLine: number;
  endLine: number;
  tokenCount: number | null;
  semanticScore: number | null;
  structuralMatch: string | null;
};

export type RetrievalEvidence = {
  config: { mode: 'SE'; vectorTopK: number; targetChunkIds: string[] };
  candidates: RetrievalCandidateEvidence[];
};

export type AnalysisContextEvidence = {
  selectedChunkIds: string[];
  discardedChunkIds: string[];
  selectedTokens: number;
  tokenBudget: number;
  functionalRules: FunctionalRuleEvidence;
};

/** Convierte el resultado del retrieval en la evidencia persistible, sin modificarlo. */
export function toRetrievalEvidence(result: RetrievalResult, vectorTopK: number): RetrievalEvidence {
  return {
    config: {
      mode: 'SE',
      vectorTopK,
      targetChunkIds: result.targetChunks.map((chunk) => chunk.id),
    },
    candidates: result.candidates.map(({ chunk, semanticScore, structuralMatch }) => ({
      chunkId: chunk.id,
      filePath: chunk.filePath,
      symbolKind: chunk.symbolKind,
      symbolName: chunk.symbolName,
      parentSymbolName: chunk.parentSymbolName,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      tokenCount: chunk.tokenCount ?? null,
      semanticScore,
      structuralMatch,
    })),
  };
}

/**
 * Evidencia del contexto construido por `ContextBuilder`: chunks seleccionados y descartados según la
 * auditoría, tokens y presupuesto, y reglas funcionales. Lee `audit`; no cambia `GenerationContext`.
 */
export function toAnalysisContextEvidence(context: GenerationContext): AnalysisContextEvidence {
  const audit = context.audit;

  if (!audit) {
    throw new Error('ContextBuilder no produjo evidencia para el contexto persistido.');
  }

  return {
    selectedChunkIds: audit.candidates.filter((candidate) => candidate.decision === 'SELECTED').map((c) => c.chunkId),
    discardedChunkIds: audit.candidates.filter((candidate) => candidate.decision === 'DISCARDED').map((c) => c.chunkId),
    selectedTokens: context.contextTokens,
    tokenBudget: audit.configuration.maxContextTokens,
    functionalRules: toFunctionalRuleEvidence(context),
  };
}
