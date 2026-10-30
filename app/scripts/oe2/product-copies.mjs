// WI-CORE-107: copias locales de lógica del producto que el CLI OE2 necesita sin importar TypeScript del producto.
// Cada copia tiene su prueba de PARIDAD contra la función del producto en `product-parity.spec.ts`; si el producto
// cambia y la copia no se actualiza, esas pruebas fallan. Ninguna copia cambia el comportamiento del producto.

/** Número de candidatos seleccionados por modo (`COMPARISON_FINAL_TOP_K` del producto). */
export const COMPARISON_FINAL_TOP_K = 10;
/** Candidatos semánticos de los que se derivan SE y SEM (`SEMANTIC_TOP_K` del job de comparación). */
export const SEMANTIC_TOP_K = 20;
/** Pesos congelados de SE (`DEFAULT_SEMANTIC_WEIGHT` y `DEFAULT_STRUCTURAL_WEIGHT` de ContextBuilder). */
export const FROZEN_SEMANTIC_WEIGHT = 0.7;
export const FROZEN_STRUCTURAL_WEIGHT = 0.3;

const METRIC_K_SECONDARY = 5;
const METRIC_K_PRIMARY = 10;

/**
 * Copia de `computeRetrievalMetrics` (`src/retrieval-comparisons/retrieval-comparison-metrics.ts`). Identidad
 * `(filePath, symbolQualifiedName)`; `hits@k` cuenta elementos distintos de la verdad de terreno; `null` sin GT.
 */
export function computeRetrievalMetrics(ranked, groundTruth) {
  if (!groundTruth || groundTruth.length === 0) {
    return null;
  }

  const keyOf = (filePath, symbolQualifiedName) => `${filePath}\u0000${symbolQualifiedName}`;
  const truth = new Set(groundTruth.map((item) => keyOf(item.filePath, item.symbolQualifiedName)));
  const total = truth.size;

  const hitsAt = (k) => {
    const matched = new Set();
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

/**
 * Copia de `symbolQualifiedNameOf` (`retrieval-comparison-ranking.ts`): `Parent.nombre` para métodos y `nombre`
 * para el resto; `null` si el chunk no tiene nombre.
 */
export function symbolQualifiedNameOf(chunk) {
  if (chunk.symbolName === null) {
    return null;
  }
  return chunk.parentSymbolName === null ? chunk.symbolName : `${chunk.parentSymbolName}.${chunk.symbolName}`;
}

function semanticOrderKey(score) {
  return score ?? Number.NEGATIVE_INFINITY;
}

/**
 * Copia de `rankComparisonCandidates` (`retrieval-comparison-ranking.ts`). `candidates` son
 * `{ chunk: { id, filePath, symbolName, parentSymbolName }, semanticScore, structuralMatch }`.
 * `scoreOf(candidate)` es la fórmula combinada (solo SE). Orden: score de orden desc, semántico desc, `chunk.id` asc.
 */
export function rankComparisonCandidates(candidates, mode, scoreOf) {
  const pool = mode === 'SEM' ? candidates.filter((candidate) => candidate.semanticScore !== null) : candidates;

  const entries = pool.map((candidate) => {
    const combinedScore = mode === 'SE' ? scoreOf(candidate) : null;
    return {
      candidate,
      combinedScore,
      orderScore: mode === 'SE' ? combinedScore : candidate.semanticScore,
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

/**
 * Fórmula combinada del producto (`ContextBuilder.scoreCandidate`): `semanticWeight * semantic + structuralWeight *
 * boost`, con boost 1 si hay relación estructural. El orden de operandos es el del producto (paridad bit a bit).
 */
export function combinedScoreOf(weights, semanticScore, structuralMatch) {
  const semantic = semanticScore ?? 0;
  const structuralBoost = structuralMatch ? 1 : 0;
  return weights.semanticWeight * semantic + weights.structuralWeight * structuralBoost;
}

/** Directorios que el indexado ignora (`INDEXING_IGNORED_DIRS` de `indexing.constants.ts`). */
export const INDEXING_IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor', 'storage', 'cache',
]);

/** Copia de `isIgnoredPath`: un segmento de la ruta está en la lista de directorios ignorados. */
export function isIgnoredPath(relativePath) {
  return relativePath.split('/').some((segment) => INDEXING_IGNORED_DIRS.has(segment));
}

/** Copia de `isTestFile`: tests TypeScript (`*.spec|test.ts`) y PHP en carpetas `test(s)/` o `*Test.php`. */
export function isTestFile(relativePath) {
  return /\.(spec|test)\.tsx?$/.test(relativePath)
    || (/\.php$/i.test(relativePath)
      && (/(^|\/)tests?\//i.test(relativePath) || /(?:^|\/)[^/]*Test\.php$/i.test(relativePath)));
}

/** Namespace de un FQCN: todo antes del último `\`; cadena vacía si no hay (copia de `namespaceOf`). */
export function namespaceOf(fqcn) {
  const index = fqcn.lastIndexOf('\\');
  return index === -1 ? '' : fqcn.slice(0, index);
}

/** Nombre corto de un FQCN: todo después del último `\` (copia de `shortNameOf`). */
export function shortNameOf(fqcn) {
  return fqcn.slice(fqcn.lastIndexOf('\\') + 1);
}

/** Escapa un texto para usarlo literal dentro de una expresión regular (copia de `escapeRegExp`). */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** R-PHP3 (producto): el nombre corto aparece como palabra completa en el contenido del target. */
export function shortNameMentionRegex(owner) {
  return new RegExp(`\\b${escapeRegExp(shortNameOf(owner))}\\b`);
}

/** R-PHP4 (producto): el contenido contiene `\O(K)` seguido de un carácter que no es de identificador o fin. */
export function fullyQualifiedMentionRegex(owner) {
  return new RegExp(`\\\\${escapeRegExp(owner)}(?![\\w\\u0080-\\uFFFF])`);
}
