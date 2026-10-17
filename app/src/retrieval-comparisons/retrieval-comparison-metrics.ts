/** Ks de §6.15: `Precision@10`/`Recall@10` principales; `@5` secundarias. */
export const METRIC_K_SECONDARY = 5;
export const METRIC_K_PRIMARY = 10;

/** Elemento de la verdad de terreno externa (§6.15). La identidad es exacta: `filePath` + `symbolQualifiedName`. */
export interface RetrievalGroundTruthItem {
  filePath: string;
  symbolQualifiedName: string;
}

export interface RetrievalMetricsValues {
  precisionAt5: number;
  recallAt5: number;
  precisionAt10: number;
  recallAt10: number;
}

export interface RankedForMetrics {
  rank: number;
  filePath: string;
  symbolQualifiedName: string | null;
}

function keyOf(filePath: string, symbolQualifiedName: string): string {
  return `${filePath}\u0000${symbolQualifiedName}`;
}

/**
 * Precisión y recall en k sobre el ranking de un modo (función pura, WI-CORE-022).
 *
 * - Coincidencia exacta de `(filePath, symbolQualifiedName)`; un candidato sin `symbolQualifiedName`
 *   nunca coincide.
 * - `hits@k` cuenta elementos DISTINTOS de la verdad de terreno recuperados en el top k, así que
 *   `P@k = hits/k` y `R@k = hits/|groundTruth|` quedan acotados en [0, 1] aunque haya varios chunks del
 *   mismo símbolo. La verdad de terreno se deduplica antes de contar.
 * - `P@k` usa k fijo (5 y 10) aunque haya menos candidatos.
 * - Devuelve `null` si no hay verdad de terreno o está vacía: Core nunca inventa una.
 */
export function computeRetrievalMetrics(
  ranked: readonly RankedForMetrics[],
  groundTruth: readonly RetrievalGroundTruthItem[] | null | undefined,
): RetrievalMetricsValues | null {
  if (!groundTruth || groundTruth.length === 0) {
    return null;
  }

  const truth = new Set(groundTruth.map((item) => keyOf(item.filePath, item.symbolQualifiedName)));
  const total = truth.size;

  const hitsAt = (k: number): number => {
    const matched = new Set<string>();

    for (const candidate of ranked) {
      if (candidate.rank > k || candidate.symbolQualifiedName === null) {
        continue;
      }

      const key = keyOf(candidate.filePath, candidate.symbolQualifiedName);
      if (truth.has(key)) {
        matched.add(key);
      }
    }

    return matched.size;
  };

  const hits5 = hitsAt(METRIC_K_SECONDARY);
  const hits10 = hitsAt(METRIC_K_PRIMARY);

  return {
    precisionAt5: hits5 / METRIC_K_SECONDARY,
    recallAt5: hits5 / total,
    precisionAt10: hits10 / METRIC_K_PRIMARY,
    recallAt10: hits10 / total,
  };
}
