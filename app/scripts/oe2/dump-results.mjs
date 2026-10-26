// WI-CORE-107: subcomando `dump-results`. Vuelca las comparaciones de retrieval YA PERSISTIDAS como JSON con la forma
// de `RetrievalComparisonResultsResponse` (INTEROP-2.7 §6.15): símbolo, modos SE y SEM con `config` y la lista
// completa de candidatos. Solo comparaciones COMPLETED; el resto se lista como omitido en el manifiesto. No ejecuta
// retrieval ni escribe nada en la base.
import { OE2_COMPARISON_BY_ID, OE2_COMPARISON_RESULTS, OE2_COMPARISONS_BY_RUN } from '../evidence-extractor/queries.mjs';
import { Oe2DataError } from './io-primitives.mjs';
import { readOnlySession, toIsoOrNull } from './db.mjs';
import { PackagePlan, resolveOe2OutputDir, writeOe2Package } from './output.mjs';

const MODE_ORDER = Object.freeze(['SE', 'SEM']);

/** Candidato con exactamente los campos de `RetrievalCandidateResponse`. */
export function normalizeCandidate(candidate) {
  return {
    rank: candidate.rank,
    chunkId: candidate.chunkId,
    filePath: candidate.filePath,
    symbolQualifiedName: candidate.symbolQualifiedName ?? null,
    semanticScore: candidate.semanticScore ?? null,
    structuralRelation: candidate.structuralRelation ?? null,
    combinedScore: candidate.combinedScore ?? null,
    selected: candidate.selected === true,
  };
}

/**
 * Forma de `RetrievalComparisonResultsResponse` a partir de la fila de comparación y de sus filas de modo. Exige
 * exactamente SE y SEM (una comparación COMPLETED los tiene siempre).
 */
export function buildComparisonResponse(comparison, modeRows) {
  const modes = modeRows
    .map((row) => ({
      mode: row.mode,
      retrievalId: row.id,
      config: row.config,
      candidates: (Array.isArray(row.candidates) ? row.candidates : []).map(normalizeCandidate),
      metrics: row.metrics ?? null,
    }))
    .sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode));
  const found = modes.map((mode) => mode.mode);
  if (found.length !== 2 || found[0] !== 'SE' || found[1] !== 'SEM') {
    throw new Oe2DataError(`la comparación ${comparison.id} no tiene exactamente los modos SE y SEM`);
  }
  return {
    retrievalComparisonId: comparison.id,
    analysisRunId: comparison.analysisRunId,
    projectVersionId: comparison.projectVersionId,
    symbol: comparison.symbol,
    modes,
    completedAt: toIsoOrNull(comparison.completedAt),
  };
}

/** Subcomando `dump-results`. */
export async function runDumpResults({ options, env, cwd, repoRoot, openDriver }) {
  const outDir = await resolveOe2OutputDir(options, { cwd, repoRoot });
  const data = await readOnlySession({
    openDriver,
    env,
    work: async (session) => {
      let comparisons = [];
      if (typeof options.analysisRun === 'string') {
        comparisons = await session.query(OE2_COMPARISONS_BY_RUN, [options.analysisRun]);
      } else {
        for (const id of options.comparisons) {
          const [row] = await session.query(OE2_COMPARISON_BY_ID, [id]);
          if (!row) throw new Oe2DataError(`comparación no encontrada: ${id}`);
          comparisons.push(row);
        }
      }
      const responses = [];
      const omitted = [];
      for (const comparison of comparisons) {
        if (comparison.status !== 'COMPLETED') {
          omitted.push({ retrievalComparisonId: comparison.id, status: comparison.status });
          continue;
        }
        const modeRows = await session.query(OE2_COMPARISON_RESULTS, [comparison.id]);
        responses.push(buildComparisonResponse(comparison, modeRows));
      }
      return { responses, omitted, requested: comparisons.length };
    },
  });

  const plan = new PackagePlan();
  for (const response of data.responses) plan.addJson(`${response.retrievalComparisonId}.json`, response);
  const written = await writeOe2Package(outDir, plan, 'dump-results', {
    analysisRunId: typeof options.analysisRun === 'string' ? options.analysisRun : null,
    requestedComparisons: data.requested,
    included: data.responses.map((response) => ({
      retrievalComparisonId: response.retrievalComparisonId,
      file: `${response.retrievalComparisonId}.json`,
    })),
    omitted: data.omitted,
  });
  return {
    exitCode: 0,
    lines: [
      `Comparaciones volcadas: ${data.responses.length}. Omitidas (no COMPLETED): ${data.omitted.length}.`,
      `Archivos escritos: ${written.length}.`,
    ],
    outDir,
  };
}
