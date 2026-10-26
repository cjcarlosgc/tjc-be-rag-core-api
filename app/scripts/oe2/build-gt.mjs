// WI-CORE-108: subcomando `build-gt`. Construye la verdad de terreno (`gt.json`, forma de `score`) a partir de la
// plantilla de anotación adjudicada, la llave del pool y las hojas que vieron los anotadores (`--sheets`). Solo lee
// archivos locales (sin base de datos). Validación estricta: toda incoherencia se acumula y aborta con la lista
// completa de problemas; nada se descarta en silencio. Filas de targets fuera de la selección de `--roles` se validan
// en su identidad, se cuentan y se declaran en el manifiesto. Determinista: mismas entradas, mismos bytes.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from '../evidence-extractor/options.mjs';
import { Oe2DataError, compareCodeUnits, identityKey, parseCsv } from './io-primitives.mjs';
import { BUILD_GT_DEFAULT_ROLES, rolesWithoutRows } from './args.mjs';
import { readSampleRows, targetIdOf } from './pool.mjs';
import { parseSheet } from './sheets.mjs';
import { PackagePlan, resolveOe2OutputDir, writeOe2Package } from './output.mjs';
import { sha256Hex, stableStringify, toCsv } from '../evidence-extractor/util.mjs';

/** Valores de `adjudicacion` (tras normalizar espacios y mayúsculas). */
export const DECISION_VALUES = Object.freeze(['relevante', 'no relevante']);
/** Criterios de relevancia de la guía de anotación (los define el equipo investigador; aquí solo el vocabulario). */
export const CRITERIA = Object.freeze(['R1', 'R2', 'R3', 'R4', 'R5']);
export const GT_SUMMARY_COLUMNS = Object.freeze(['targetId', 'role', 'candidatos', 'relevantes', 'noRelevantes']);
const REQUIRED_TEMPLATE_COLUMNS = Object.freeze(['candidate_id', 'target_id', 'adjudicacion', 'adjudicacion_criterio']);
const BOM = '﻿';

/** Decisión normalizada: recorta, colapsa espacios internos y pasa a minúsculas. */
export function normalizeDecision(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Criterios de un valor (separados por `;` o `,`, con espacios libres). Devuelve `{ criteria }` en orden R1…R5 o
 * `{ error }` con el motivo: «vacío» o «fuera de R1…R5». Admite minúsculas.
 */
export function parseCriteria(value) {
  const text = String(value ?? '').trim();
  if (text.length === 0) return { error: 'vacío' };
  const tokens = text.split(/[;,]/).map((token) => token.trim().toUpperCase());
  if (tokens.some((token) => !CRITERIA.includes(token))) return { error: 'fuera de R1…R5' };
  return { criteria: CRITERIA.filter((criterion) => tokens.includes(criterion)) };
}

/** Lee la llave de `pool` (`clave/key.json`) y valida su forma mínima. */
export function parseKey(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Oe2DataError('key.json no es JSON válido');
  }
  if (!data || typeof data !== 'object' || data.schemaVersion !== 1 || !data.targets || typeof data.targets !== 'object') {
    throw new Oe2DataError('key.json no tiene la forma de la llave de pool (schemaVersion 1 y targets)');
  }
  for (const [targetId, target] of Object.entries(data.targets)) {
    if (!target || typeof target.candidates !== 'object' || target.candidates === null) {
      throw new Oe2DataError(`key.json: el target ${targetId} no tiene candidatos`);
    }
    for (const [candidateId, candidate] of Object.entries(target.candidates)) {
      if (typeof candidate?.filePath !== 'string' || typeof candidate?.qualifiedName !== 'string') {
        throw new Oe2DataError(`key.json: el candidato ${candidateId} no tiene filePath o qualifiedName`);
      }
    }
  }
  return data;
}

/**
 * Quita las filas totalmente en blanco del final de la plantilla (las añaden las hojas de cálculo). Solo al final:
 * una fila en blanco en medio, o una fila parcialmente rellena, sigue siendo un error.
 */
export function stripTrailingBlankRows(text) {
  const lines = text.split(/\r?\n/);
  let removed = 0;
  while (lines.length > 1 && /^[\s,]*$/.test(lines[lines.length - 1])) {
    // Una línea vacía sin más contenido es el salto final o un hueco; solo cuenta como fila lo que tiene comas.
    if (lines.pop() !== '') removed += 1;
  }
  return { text: lines.join('\n'), removed };
}

/**
 * Comprueba que las hojas leídas (`sheets`: `[{ name, text }]`) coinciden con la llave en los targets seleccionados:
 * mismos `candidate_id`, mismo archivo y mismo símbolo, sin candidatos sobrantes ni faltantes. Acumula en `problems`.
 * Devuelve el mapa `targetId -> nombre de la hoja` de los targets verificados.
 */
export function checkSheets({ sheets, key, selectedIds, problems }) {
  const byTarget = new Map();
  for (const sheet of sheets) {
    let parsed;
    try {
      parsed = parseSheet(sheet.text, `hoja ${sheet.name}`);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    const { targetId } = parsed;
    if (!Object.prototype.hasOwnProperty.call(key.targets, targetId)) {
      problems.push(`hoja ${sheet.name}: el target ${targetId} no está en la llave (¿hoja de otra ejecución de pool?)`);
      continue;
    }
    if (parsed.targetFile !== null && parsed.targetSymbol !== null && `${parsed.targetFile}::${parsed.targetSymbol}` !== targetId) {
      problems.push(`hoja ${sheet.name}: su archivo y símbolo no corresponden al target ${targetId}`);
    }
    if (byTarget.has(targetId)) {
      problems.push(`target ${targetId}: hay dos hojas (${byTarget.get(targetId).name} y ${sheet.name})`);
      continue;
    }
    byTarget.set(targetId, { name: sheet.name, parsed });
  }

  for (const targetId of selectedIds) {
    const entry = byTarget.get(targetId);
    if (!entry) {
      problems.push(`target ${targetId}: sin hoja en --sheets`);
      continue;
    }
    const target = key.targets[targetId];
    if (typeof target.sheet === 'string' && path.posix.basename(target.sheet) !== entry.name) {
      problems.push(`target ${targetId}: la llave indica la hoja ${path.posix.basename(target.sheet)} y se leyó ${entry.name}`);
    }
    const keyCandidates = new Map(Object.entries(target.candidates));
    for (const [candidateId, candidate] of keyCandidates) {
      const seen = entry.parsed.candidates.get(candidateId);
      if (!seen) {
        problems.push(`${candidateId}: está en la llave pero no en la hoja ${entry.name}`);
      } else if (seen.filePath !== candidate.filePath || seen.qualifiedName !== candidate.qualifiedName) {
        problems.push(`${candidateId}: la hoja muestra ${seen.filePath}::${seen.qualifiedName} y la llave ${candidate.filePath}::${candidate.qualifiedName}`);
      }
    }
    for (const candidateId of entry.parsed.candidates.keys()) {
      if (!keyCandidates.has(candidateId)) problems.push(`${candidateId}: está en la hoja ${entry.name} pero no en la llave`);
    }
  }
  return new Map([...byTarget].map(([targetId, entry]) => [targetId, entry.name]));
}

/**
 * Construye la GT (función pura sobre los textos de plantilla, llave, sample y hojas). Devuelve `{ gt, gtText,
 * summaryRows, counts, missingRoles }`. Lanza `Oe2DataError` con la lista completa de problemas si algo no encaja.
 * `sheets` es obligatorio: `[{ name, text }]` con las hojas de `ciego/hojas/`.
 */
export function buildGroundTruth({ templateText, keyText, sampleText, sheets, roles }) {
  if (!Array.isArray(sheets)) throw new UsageError('falta --sheets <carpeta ciego/hojas>');
  const sampleRows = readSampleRows(sampleText);
  const selectedRows = sampleRows.filter((row) => roles.includes(row.role));
  if (selectedRows.length === 0) throw new UsageError('ninguna fila de sample.csv tiene los roles pedidos en --roles');
  const missingRoles = rolesWithoutRows(roles, sampleRows);
  const key = parseKey(keyText);
  const withoutBom = templateText.startsWith(BOM) ? templateText.slice(1) : templateText;
  const stripped = stripTrailingBlankRows(withoutBom);
  const { header, rows } = parseCsv(stripped.text);
  for (const column of REQUIRED_TEMPLATE_COLUMNS) {
    if (!header.includes(column)) throw new Oe2DataError(`la plantilla no tiene la columna ${column}`);
  }

  const roleByTarget = new Map(selectedRows.map((row) => [targetIdOf(row.filePath, row.qualifiedName), row.role]));
  const selectedIds = [...roleByTarget.keys()].sort(compareCodeUnits);
  const problems = [];

  // Dueño de cada candidato en la llave: el id lleva el targetId, así que debería ser único.
  const owner = new Map();
  for (const [targetId, target] of Object.entries(key.targets)) {
    for (const candidateId of Object.keys(target.candidates)) {
      if (owner.has(candidateId)) problems.push(`${candidateId}: aparece en la llave bajo dos targets`);
      owner.set(candidateId, targetId);
    }
  }

  const rowCount = new Map();
  const templateTargets = new Set();
  const rowIds = new Set();
  const decisions = new Map();
  let templateRowsIgnored = 0;
  rows.forEach((row, index) => {
    const line = index + 2;
    const candidateId = row.candidate_id.trim();
    const targetId = row.target_id.trim();
    if (candidateId === '' || targetId === '') {
      problems.push(`fila ${line}: candidate_id o target_id vacío`);
      return;
    }
    rowCount.set(candidateId, (rowCount.get(candidateId) ?? 0) + 1);
    if (rowCount.get(candidateId) === 2) problems.push(`${candidateId}: candidate_id duplicado en la plantilla`);
    rowIds.add(candidateId);
    templateTargets.add(targetId);

    const declared = owner.get(candidateId);
    if (declared === undefined) {
      problems.push(`${candidateId}: no existe en la llave`);
      return;
    }
    if (declared !== targetId) {
      problems.push(`${candidateId}: target_id ${targetId} no coincide (la llave lo sitúa en ${declared})`);
      return;
    }
    if (!roleByTarget.has(targetId)) {
      // Fila de un target fuera de la selección de --roles: se valida su identidad, pero no se exige adjudicación.
      templateRowsIgnored += 1;
      return;
    }

    const decision = normalizeDecision(row.adjudicacion);
    if (!DECISION_VALUES.includes(decision)) {
      const shown = decision === '' ? 'vacía' : `«${decision.slice(0, 40)}»`;
      problems.push(`${candidateId}: adjudicacion no válida (${shown}); valores: relevante, no relevante`);
      return;
    }
    // El criterio es obligatorio para «relevante» y, si se rellena, se valida también para «no relevante».
    const criterionText = String(row.adjudicacion_criterio ?? '');
    if (decision === 'relevante' || criterionText.trim() !== '') {
      const parsed = parseCriteria(criterionText);
      if (parsed.error) {
        const requirement = decision === 'relevante' ? 'obligatorio para relevante' : 'si se rellena';
        problems.push(`${candidateId}: adjudicacion_criterio ${parsed.error} (${requirement}; R1…R5 separados por ; o ,)`);
        return;
      }
    }
    decisions.set(candidateId, { targetId, decision });
  });

  for (const targetId of selectedIds) {
    const target = key.targets[targetId];
    if (!target) {
      problems.push(`target ${targetId}: no está en la llave`);
      continue;
    }
    if (!templateTargets.has(targetId)) {
      problems.push(`target ${targetId}: sin filas en la plantilla`);
      continue;
    }
    const unadjudicated = Object.keys(target.candidates).filter((candidateId) => !rowIds.has(candidateId));
    if (unadjudicated.length > 0) {
      problems.push(`target ${targetId}: candidatos de la llave sin fila adjudicada: ${unadjudicated.join(', ')}`);
    }
  }

  const sheetNames = checkSheets({ sheets, key, selectedIds, problems });

  const gt = {};
  const summaryRows = [];
  let relevantTotal = 0;
  let candidateTotal = 0;
  for (const targetId of selectedIds) {
    const target = key.targets[targetId];
    if (!target) continue;
    const entries = Object.entries(target.candidates);
    const items = [];
    for (const [candidateId, candidate] of entries) {
      const decision = decisions.get(candidateId);
      if (decision?.decision === 'relevante') {
        items.push({ filePath: candidate.filePath, symbolQualifiedName: candidate.qualifiedName });
      }
    }
    items.sort((a, b) => compareCodeUnits(a.filePath, b.filePath) || compareCodeUnits(a.symbolQualifiedName, b.symbolQualifiedName));
    const identities = new Set();
    for (const item of items) {
      const identity = identityKey(item.filePath, item.symbolQualifiedName);
      if (identities.has(identity)) problems.push(`target ${targetId}: relevante duplicado ${item.filePath}::${item.symbolQualifiedName}`);
      identities.add(identity);
    }
    gt[targetId] = items;
    relevantTotal += items.length;
    candidateTotal += entries.length;
    summaryRows.push({
      targetId,
      role: roleByTarget.get(targetId),
      candidatos: entries.length,
      relevantes: items.length,
      noRelevantes: entries.length - items.length,
    });
  }

  if (problems.length > 0) {
    throw new Oe2DataError(`build-gt: ${problems.length} problema(s) en la plantilla, la llave o las hojas; no se construye la GT:\n  - ${problems.join('\n  - ')}`);
  }
  return {
    gt,
    gtText: stableStringify(gt),
    summaryRows,
    missingRoles,
    counts: {
      targets: selectedIds.length,
      candidates: candidateTotal,
      relevant: relevantTotal,
      notRelevant: candidateTotal - relevantTotal,
      templateRowsIgnored,
      templateBlankRowsIgnored: stripped.removed,
      templateRows: rows.length,
      sheetsVerified: sheetNames.size,
    },
  };
}

/** Lee las hojas `.md` de una carpeta (`ciego/hojas`), en orden de nombre por unidades de código. */
export async function readSheets(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new Oe2DataError('la carpeta de --sheets no existe o no se puede leer');
  }
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort(compareCodeUnits);
  if (names.length === 0) throw new Oe2DataError('la carpeta de --sheets no tiene hojas .md');
  return Promise.all(names.map(async (name) => {
    const bytes = await readFile(path.join(dir, name));
    return { name, bytes, text: bytes.toString('utf8') };
  }));
}

/** Subcomando `build-gt`. Sin base de datos. */
export async function runBuildGt({ options, cwd, repoRoot }) {
  const outDir = await resolveOe2OutputDir(options, { cwd, repoRoot });
  const templateBytes = await readFile(options.template);
  const keyBytes = await readFile(options.key);
  const sampleBytes = await readFile(options.sample);
  const sheets = await readSheets(options.sheets);
  const roles = options.roles ?? [...BUILD_GT_DEFAULT_ROLES];
  const built = buildGroundTruth({
    templateText: templateBytes.toString('utf8'),
    keyText: keyBytes.toString('utf8'),
    sampleText: sampleBytes.toString('utf8'),
    sheets: sheets.map((sheet) => ({ name: sheet.name, text: sheet.text })),
    roles,
  });
  const gtBytes = Buffer.from(built.gtText, 'utf8');
  const gtSha256 = sha256Hex(gtBytes);

  const plan = new PackagePlan();
  plan.addBytes('gt.json', gtBytes);
  plan.addText('gt.sha256', `${gtSha256}  gt.json\n`);
  plan.addText('gt-summary.csv', toCsv(GT_SUMMARY_COLUMNS, built.summaryRows));
  const written = await writeOe2Package(outDir, plan, 'build-gt', {
    gtSha256,
    gtFile: 'gt.json',
    rolesSelected: roles,
    targets: built.counts.targets,
    candidates: built.counts.candidates,
    relevant: built.counts.relevant,
    notRelevant: built.counts.notRelevant,
    templateRows: built.counts.templateRows,
    templateRowsOfUnselectedTargets: built.counts.templateRowsIgnored,
    templateBlankRowsIgnored: built.counts.templateBlankRowsIgnored,
    sheetsVerified: built.counts.sheetsVerified,
    // SHA-256 de cada hoja leída (todas las de la carpeta, también las de targets no seleccionados).
    sheets: sheets.map((sheet) => ({ file: sheet.name, sha256: sha256Hex(sheet.bytes), bytes: sheet.bytes.length })),
    inputs: {
      template: { sha256: sha256Hex(templateBytes), bytes: templateBytes.length },
      key: { sha256: sha256Hex(keyBytes), bytes: keyBytes.length },
      sample: { sha256: sha256Hex(sampleBytes), bytes: sampleBytes.length },
    },
  });
  const lines = [
    `Targets: ${built.counts.targets} (roles: ${roles.join(', ')}). Candidatos: ${built.counts.candidates}; relevantes: ${built.counts.relevant}; no relevantes: ${built.counts.notRelevant}.`,
    `Hojas verificadas contra la llave: ${built.counts.sheetsVerified} (de ${sheets.length} leídas).`,
    `Filas de la plantilla de targets no seleccionados (no adjudicadas, solo validadas): ${built.counts.templateRowsIgnored}.`,
  ];
  if (built.counts.templateBlankRowsIgnored > 0) {
    lines.push(`Filas totalmente en blanco al final de la plantilla ignoradas: ${built.counts.templateBlankRowsIgnored}.`);
  }
  if (built.missingRoles.length > 0) {
    lines.push(`AVISO: --roles pide ${built.missingRoles.join(', ')} y el sample no tiene filas de ese rol; no se usan.`);
  }
  lines.push(`GT SHA-256 (gt.json): ${gtSha256}. Úsalo en score con --gt-sha256.`, `Archivos escritos: ${written.length}.`);
  return { exitCode: 0, lines, outDir };
}
