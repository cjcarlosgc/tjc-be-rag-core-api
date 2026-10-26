// WI-CORE-107: subcomando `score`. Calcula P@5/10 y R@5/10 de SE y SEM por target oficial con la verdad de terreno
// congelada (GT), tras comprobar que re-rankear con la copia de `rankComparisonCandidates` reproduce los `rank`
// persistidos. Incluye la sensibilidad al desempate (D-OE2-3): SE re-ordenado por (filePath, symbolQualifiedName).
// La estadística inferencial no está aquí (la hace cross).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Oe2DataError, compareCodeUnits, identityKey, readText } from './io-primitives.mjs';
import { readSampleRows, loadComparisons, targetIdOf } from './pool.mjs';
import {
  combinedScoreOf,
  computeRetrievalMetrics,
  rankComparisonCandidates,
} from './product-copies.mjs';
import { PackagePlan, resolveOe2OutputDir, writeOe2Package } from './output.mjs';
import { sha256Hex, toCsv, stableStringify } from '../evidence-extractor/util.mjs';

const METRIC_KEYS = Object.freeze(['P5', 'R5', 'P10', 'R10']);

/** Valida la verdad de terreno: `{ "<archivo>::<nombre>": [ { filePath, symbolQualifiedName } ] }`. */
export function parseGroundTruth(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Oe2DataError('la GT no es JSON válido');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Oe2DataError('la GT debe ser un objeto JSON');
  const map = new Map();
  for (const [targetId, items] of Object.entries(data)) {
    if (targetId.indexOf('::') <= 0) throw new Oe2DataError(`clave de GT sin formato archivo::nombre: ${targetId}`);
    if (!Array.isArray(items)) throw new Oe2DataError(`la GT de ${targetId} debe ser una lista`);
    const normalized = items.map((item) => {
      if (!item || typeof item.filePath !== 'string' || typeof item.symbolQualifiedName !== 'string') {
        throw new Oe2DataError(`elemento de GT mal formado en ${targetId}`);
      }
      return { filePath: item.filePath, symbolQualifiedName: item.symbolQualifiedName };
    });
    map.set(targetId, normalized);
  }
  return map;
}

/** Re-rankea los candidatos persistidos con la copia del producto y compara posición, chunk, selección y score. */
export function checkCongruence(comparisonModes, label) {
  const issues = [];
  for (const mode of ['SE', 'SEM']) {
    const persisted = [...comparisonModes.get(mode).candidates].sort((a, b) => a.rank - b.rank);
    const weights = mode === 'SE'
      ? { semanticWeight: comparisonModes.get(mode).config.semanticWeight, structuralWeight: comparisonModes.get(mode).config.structuralWeight }
      : null;
    const inputs = persisted.map((candidate) => ({
      chunk: { id: candidate.chunkId, filePath: candidate.filePath, symbolName: candidate.symbolQualifiedName, parentSymbolName: null },
      semanticScore: candidate.semanticScore,
      structuralMatch: mode === 'SE' ? candidate.structuralRelation : null,
    }));
    const scoreOf = (candidate) => combinedScoreOf(weights, candidate.semanticScore, candidate.structuralMatch);
    const reranked = rankComparisonCandidates(inputs, mode, scoreOf);
    if (reranked.length !== persisted.length) {
      issues.push({ label, mode, position: null, field: 'número de candidatos' });
      continue;
    }
    persisted.forEach((candidate, index) => {
      const copy = reranked[index];
      if (candidate.rank !== index + 1) issues.push({ label, mode, position: index + 1, field: 'rank persistido no consecutivo' });
      if (copy.chunkId !== candidate.chunkId) issues.push({ label, mode, position: index + 1, field: 'chunkId' });
      if (copy.rank !== candidate.rank) issues.push({ label, mode, position: index + 1, field: 'rank' });
      if (copy.selected !== candidate.selected) issues.push({ label, mode, position: index + 1, field: 'selected' });
      if (mode === 'SE' && copy.combinedScore !== candidate.combinedScore) {
        issues.push({ label, mode, position: index + 1, field: 'combinedScore' });
      }
    });
  }
  return issues;
}

function semanticKey(score) {
  return score ?? Number.NEGATIVE_INFINITY;
}

/**
 * Sensibilidad (D-OE2-3): SE re-ordenado por score combinado desc, semántico desc, `(filePath, symbolQualifiedName)`
 * asc y, como último desempate entre partes del mismo símbolo, el rank original. No cambia el producto.
 */
export function reorderSeByFileAndName(persistedSe) {
  const items = [...persistedSe];
  items.sort((a, b) => {
    if (a.combinedScore !== b.combinedScore) return b.combinedScore - a.combinedScore;
    const sa = semanticKey(a.semanticScore);
    const sb = semanticKey(b.semanticScore);
    if (sa !== sb) return sa > sb ? -1 : 1;
    const byFile = compareCodeUnits(a.filePath, b.filePath);
    if (byFile !== 0) return byFile;
    const byName = compareCodeUnits(a.symbolQualifiedName ?? '', b.symbolQualifiedName ?? '');
    if (byName !== 0) return byName;
    return a.rank - b.rank;
  });
  return items.map((candidate, index) => ({
    rank: index + 1,
    filePath: candidate.filePath,
    symbolQualifiedName: candidate.symbolQualifiedName,
  }));
}

function toRanked(candidates) {
  return candidates.map((candidate) => ({
    rank: candidate.rank,
    filePath: candidate.filePath,
    symbolQualifiedName: candidate.symbolQualifiedName,
  }));
}

/** Métricas de un ranking con GT; `null` si la GT está vacía o ausente. */
function metricsOf(ranked, groundTruth) {
  return computeRetrievalMetrics(ranked, groundTruth);
}

/** Puntuación de un target. Devuelve la fila de salida y las incongruencias encontradas. */
export function scoreTarget({ row, targetId, comparison, groundTruth }) {
  const common = { repo: row.repo, targetId, role: row.role, gtSize: groundTruth?.length ?? 0 };
  const se = [...comparison.modes.get('SE').candidates].sort((a, b) => a.rank - b.rank);
  const sem = [...comparison.modes.get('SEM').candidates].sort((a, b) => a.rank - b.rank);
  const seRanked = toRanked(se);
  const semRanked = toRanked(sem);
  const seMetrics = metricsOf(seRanked, groundTruth);
  const semMetrics = metricsOf(semRanked, groundTruth);
  if (seMetrics === null || semMetrics === null) {
    const na = Object.fromEntries(
      [...METRIC_KEYS.flatMap((key) => [`SE_${key}`, `SEM_${key}`, `d${key}`, `sens_SE_${key}`, `sensDelta_${key}`])]
        .map((name) => [name, 'NA']),
    );
    return { row: { ...common, estado: 'NA', ...na } };
  }
  const sensMetrics = metricsOf(reorderSeByFileAndName(se), groundTruth);
  const values = {
    SE_P5: seMetrics.precisionAt5,
    SE_R5: seMetrics.recallAt5,
    SE_P10: seMetrics.precisionAt10,
    SE_R10: seMetrics.recallAt10,
    SEM_P5: semMetrics.precisionAt5,
    SEM_R5: semMetrics.recallAt5,
    SEM_P10: semMetrics.precisionAt10,
    SEM_R10: semMetrics.recallAt10,
    dP5: seMetrics.precisionAt5 - semMetrics.precisionAt5,
    dR5: seMetrics.recallAt5 - semMetrics.recallAt5,
    dP10: seMetrics.precisionAt10 - semMetrics.precisionAt10,
    dR10: seMetrics.recallAt10 - semMetrics.recallAt10,
    sens_SE_P5: sensMetrics.precisionAt5,
    sens_SE_R5: sensMetrics.recallAt5,
    sens_SE_P10: sensMetrics.precisionAt10,
    sens_SE_R10: sensMetrics.recallAt10,
    sensDelta_P5: sensMetrics.precisionAt5 - seMetrics.precisionAt5,
    sensDelta_R5: sensMetrics.recallAt5 - seMetrics.recallAt5,
    sensDelta_P10: sensMetrics.precisionAt10 - seMetrics.precisionAt10,
    sensDelta_R10: sensMetrics.recallAt10 - seMetrics.recallAt10,
  };
  return { row: { ...common, estado: 'puntuado', ...values } };
}

/** Columnas de la tabla por target (la de no reportables añade `uso`). */
export const SCORE_COLUMNS = Object.freeze([
  'repo', 'targetId', 'role', 'estado', 'gtSize',
  'SE_P5', 'SE_R5', 'SE_P10', 'SE_R10',
  'SEM_P5', 'SEM_R5', 'SEM_P10', 'SEM_R10',
  'dP5', 'dR5', 'dP10', 'dR10',
  'sens_SE_P5', 'sens_SE_R5', 'sens_SE_P10', 'sens_SE_R10',
  'sensDelta_P5', 'sensDelta_R5', 'sensDelta_P10', 'sensDelta_R10',
]);

/** Subcomando `score`. */
export async function runScore({ options, cwd, repoRoot }) {
  const outDir = await resolveOe2OutputDir(options, { cwd, repoRoot });
  const gtBytes = await readFile(options.gt);
  const gtSha256 = sha256Hex(gtBytes);
  if (gtSha256 !== options.gtSha256) {
    throw new Oe2DataError('el SHA-256 de la GT no coincide con --gt-sha256; no se puntúa');
  }
  const groundTruth = parseGroundTruth(gtBytes.toString('utf8'));
  const sampleText = await readText(options.sample);
  const sampleRows = readSampleRows(sampleText);
  const sampleIds = new Set(sampleRows.map((row) => targetIdOf(row.filePath, row.qualifiedName)));
  for (const id of groundTruth.keys()) {
    if (!sampleIds.has(id)) throw new Oe2DataError(`la GT contiene un target que no está en el sample: ${id}`);
  }
  const comparisons = await loadComparisons(options.results);

  const officialRows = [];
  const noReportableRows = [];
  // La congruencia se comprueba en TODAS las comparaciones cargadas, no solo en las puntuadas.
  const issues = [];
  for (const comparison of comparisons.values()) {
    issues.push(...checkCongruence(comparison.modes, `comparación ${comparison.comparisonId}`));
  }
  for (const row of sampleRows) {
    const isOfficial = row.role === 'oficial';
    if (!isOfficial && !options.includeCalibration) continue;
    const targetId = targetIdOf(row.filePath, row.qualifiedName);
    const comparison = comparisons.get(identityKey(row.filePath, row.qualifiedName));
    if (!comparison) throw new Oe2DataError(`falta la comparación de retrieval del target ${targetId}`);
    const scored = scoreTarget({
      row: { ...row, repo: row.repo ?? '' },
      targetId,
      comparison,
      groundTruth: groundTruth.get(targetId) ?? null,
    });
    if (isOfficial) officialRows.push(scored.row);
    else noReportableRows.push({ ...scored.row, uso: 'NO REPORTABLE (calibración o reserva)' });
  }
  if (issues.length > 0) {
    const sample = issues.slice(0, 10).map((issue) => `${issue.mode} posición ${issue.position ?? '-'} (${issue.field})`);
    throw new Oe2DataError(`incongruencia en ${issues.length} posiciones al re-rankear: ${sample.join('; ')}`);
  }

  const scoredOfficial = officialRows.filter((row) => row.estado === 'puntuado');
  const mean = (field) => (scoredOfficial.length === 0
    ? 'NA'
    : scoredOfficial.reduce((sum, row) => sum + row[field], 0) / scoredOfficial.length);
  const summary = {
    official: officialRows.length,
    scored: scoredOfficial.length,
    na: officialRows.length - scoredOfficial.length,
    meanDelta: { P5: mean('dP5'), R5: mean('dR5'), P10: mean('dP10'), R10: mean('dR10') },
    meanSensitivityDelta: {
      P5: scoredOfficial.length === 0 ? 'NA' : scoredOfficial.reduce((sum, row) => sum + row.sensDelta_P5, 0) / scoredOfficial.length,
      P10: scoredOfficial.length === 0 ? 'NA' : scoredOfficial.reduce((sum, row) => sum + row.sensDelta_P10, 0) / scoredOfficial.length,
    },
  };

  const plan = new PackagePlan();
  plan.addText('metrics-per-target.csv', toCsv(SCORE_COLUMNS, officialRows));
  if (options.includeCalibration) {
    // Calibración y reserva solo en este CSV aparte, marcado «no reportable»; scores.json no las contiene.
    plan.addText('metrics-calibracion-reserva-NO-REPORTABLE.csv', toCsv([...SCORE_COLUMNS, 'uso'], noReportableRows));
  }
  plan.addText('scores.json', stableStringify({
    schemaVersion: 1,
    gtSha256,
    gtFile: path.basename(options.gt),
    congruence: { comparisons: comparisons.size, mismatches: 0 },
    summary,
    official: officialRows,
  }));
  const written = await writeOe2Package(outDir, plan, 'score', {
    gtSha256,
    sampleSha256: sha256Hex(sampleText),
    officialTargets: officialRows.length,
    includeCalibration: options.includeCalibration === true,
  });
  return {
    exitCode: 0,
    lines: [
      `Targets oficiales: ${officialRows.length}; puntuados: ${scoredOfficial.length}; NA: ${summary.na}.`,
      `Congruencia de re-ranking en ${comparisons.size} comparaciones: 0 incongruencias.`,
      `Archivos escritos: ${written.length}.`,
    ],
    outDir,
  };
}
