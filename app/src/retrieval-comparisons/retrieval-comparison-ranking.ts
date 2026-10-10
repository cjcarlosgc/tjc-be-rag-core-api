import type { StructuralMatch } from '../retrieval/generation-context.js';
import type { RetrievalCandidate, RetrievalMode } from '../retrieval/retrieval.service.js';

/** Número de candidatos seleccionados por modo en la comparación (INTEROP-2.7 §6.15: `finalTopK` = 10). */
export const COMPARISON_FINAL_TOP_K = 10;

/** Candidato rankeado de un modo; `combinedScore` solo existe en `SE` (§6.15). */
export interface RankedComparisonCandidate {
  rank: number;
  chunkId: string;
  filePath: string;
  symbolQualifiedName: string | null;
  semanticScore: number | null;
  structuralMatch: StructuralMatch | null;
  combinedScore: number | null;
  selected: boolean;
}

/**
 * `qualifiedName` de un chunk con la misma convención que `AnalysisSymbol.qualifiedName`:
 * `parentSymbolName.symbolName` para métodos, `symbolName` para el resto. Un chunk sin nombre no
 * tiene identidad y nunca coincide con la verdad de terreno.
 */
export function symbolQualifiedNameOf(chunk: { symbolName: string | null; parentSymbolName: string | null }): string | null {
  if (chunk.symbolName === null) {
    return null;
  }

  return chunk.parentSymbolName === null ? chunk.symbolName : `${chunk.parentSymbolName}.${chunk.symbolName}`;
}

/** Orden de desempate por semántico: un candidato sin semántico (solo estructural) queda después de cualquiera con él. */
function semanticOrderKey(score: number | null): number {
  return score ?? Number.NEGATIVE_INFINITY;
}

/**
 * Ranking de comparación (función pura, WI-CORE-022).
 *
 * - `SE`: orden por score combinado desc (`scoreOf`, la fórmula de `ContextBuilder`), luego
 *   `semanticScore` desc y `chunkId` asc. Usa todos los candidatos.
 * - `SEM`: solo los candidatos con `semanticScore`, ordenados por `semanticScore` desc y `chunkId`
 *   asc; sin relación estructural y sin `combinedScore`.
 *
 * `rank` va de 1 a N; `selected` es `rank <= COMPARISON_FINAL_TOP_K`. No aplica `minimumScore` ni
 * presupuesto de tokens: no es la selección del producto.
 */
export function rankComparisonCandidates(
  candidates: readonly RetrievalCandidate[],
  mode: RetrievalMode,
  scoreOf: (candidate: RetrievalCandidate) => number,
): RankedComparisonCandidate[] {
  const pool = mode === 'SEM' ? candidates.filter((candidate) => candidate.semanticScore !== null) : candidates;

  const entries = pool.map((candidate) => {
    const combinedScore = mode === 'SE' ? scoreOf(candidate) : null;
    return {
      candidate,
      combinedScore,
      orderScore: mode === 'SE' ? (combinedScore as number) : (candidate.semanticScore as number),
    };
  });

  entries.sort((a, b) => {
    if (a.orderScore !== b.orderScore) {
      return b.orderScore - a.orderScore;
    }

    const semanticA = semanticOrderKey(a.candidate.semanticScore);
    const semanticB = semanticOrderKey(b.candidate.semanticScore);
    if (semanticA !== semanticB) {
      return semanticA > semanticB ? -1 : 1;
    }

    if (a.candidate.chunk.id === b.candidate.chunk.id) {
      return 0;
    }

    return a.candidate.chunk.id < b.candidate.chunk.id ? -1 : 1;
  });

  return entries.map((entry, index) => {
    const rank = index + 1;
    const { candidate } = entry;

    return {
      rank,
      chunkId: candidate.chunk.id,
      filePath: candidate.chunk.filePath,
      symbolQualifiedName: symbolQualifiedNameOf(candidate.chunk),
      semanticScore: candidate.semanticScore,
      structuralMatch: mode === 'SE' ? candidate.structuralMatch : null,
      combinedScore: entry.combinedScore,
      selected: rank <= COMPARISON_FINAL_TOP_K,
    };
  });
}
