// WI-CORE-107: subcomando `pool`. Por target: pool = candidatos `selected` de SE ∪ candidatos `selected` de SEM ∪ la
// declaración de cada tipo del cierre de profundidad 1, deduplicado por (filePath, symbolQualifiedName) y sin el
// propio target. Salidas separadas por carácter de uso:
//   ciego/hojas/T<nn>.md        código del target y de cada candidato con candidate_id opaco y orden barajado.
//   ciego/annotation-template.csv  una fila por candidato para los anotadores (sin origen ni puntuación).
//   clave/key.json              candidate_id -> origen SE/SEM (rank, score, relación), pertenencia al cierre.
//   pool-summary.csv            recuentos agregados por target (sin procedencia por candidato).
// Ceguera: nada de `ciego/` contiene SE, SEM, rank, score, relación estructural ni origen; esos datos solo van a clave/.
// WI-CORE-108: `--guide` copia la guía de anotación (bytes sin tocar) a `ciego/GUIA.md`; la hoja solo la referencia.
// `--roles` filtra las filas del sample que se procesan (las demás no generan comparación, hoja ni llave).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from '../evidence-extractor/options.mjs';
import { rolesWithoutRows } from './args.mjs';
import {
  Oe2DataError,
  compareCodeUnits,
  createMulberry32,
  identityKey,
  pad2,
  parseCsv,
  readChunksFile,
  readText,
  seedStateFromText,
  shuffleInPlace,
} from './io-primitives.mjs';
import { TYPE_KINDS, buildTypeIndex, symbolClosure } from './closure.mjs';
import { SYMBOL_KINDS, groupSymbols } from './universe.mjs';
import { FROZEN_SEMANTIC_WEIGHT, FROZEN_STRUCTURAL_WEIGHT, SEMANTIC_TOP_K, COMPARISON_FINAL_TOP_K } from './product-copies.mjs';
import { PackagePlan, resolveOe2OutputDir, writeOe2Package } from './output.mjs';
import { toCsv, sha256Hex, stableStringify } from '../evidence-extractor/util.mjs';
import { listJsonFiles } from './files.mjs';

export const SAMPLE_REQUIRED_COLUMNS = Object.freeze([
  'role', 'order', 'repo', 'filePath', 'qualifiedName', 'kind', 'closureSize', 'closureTypes',
]);

export const TEMPLATE_COLUMNS = Object.freeze([
  'candidate_id', 'target_id',
  'anotador_A_decision', 'anotador_A_criterio',
  'anotador_B_decision', 'anotador_B_criterio',
  'adjudicacion', 'adjudicacion_criterio',
]);

export const POOL_SUMMARY_COLUMNS = Object.freeze([
  'targetId', 'role', 'nSE10', 'nSEM10', 'nClosure', 'nUnion', 'nSEandSEM', 'nSEandClosure', 'nSEMandClosure',
  'nSinIdentidad', 'ambiguousKinds',
]);

/** Prioridad del tipo de chunk cuando un mismo (archivo, nombre calificado) tiene varios grupos. */
const KIND_PRECEDENCE = Object.freeze(['METHOD', 'FUNCTION', ...TYPE_KINDS, 'CONSTRUCTOR']);

/** Configuración congelada (D-OE2-3): SE con pesos 0.7/0.3; SEM sin pesos. `embeddingModel` solo se registra. */
export const FROZEN_CONFIG = Object.freeze({
  SE: { semanticTopK: SEMANTIC_TOP_K, finalTopK: COMPARISON_FINAL_TOP_K, semanticWeight: FROZEN_SEMANTIC_WEIGHT, structuralWeight: FROZEN_STRUCTURAL_WEIGHT },
  SEM: { semanticTopK: SEMANTIC_TOP_K, finalTopK: COMPARISON_FINAL_TOP_K, semanticWeight: null, structuralWeight: null },
});

/** Comprueba la configuración de un modo frente a la congelada. Lanza `Oe2DataError` si no coincide. */
export function verifyFrozenConfig(mode, config, label) {
  const frozen = FROZEN_CONFIG[mode];
  for (const [key, expected] of Object.entries(frozen)) {
    if (config?.[key] !== expected) {
      throw new Oe2DataError(`${label}: la configuración ${mode} no coincide con la congelada (${key})`);
    }
  }
  if (typeof config.embeddingModel !== 'string') throw new Oe2DataError(`${label}: falta embeddingModel en ${mode}`);
}

export function targetIdOf(filePath, qualifiedName) {
  return `${filePath}::${qualifiedName}`;
}

/** Lee y valida `sample.csv`. */
export function readSampleRows(text) {
  const { header, rows } = parseCsv(text);
  for (const column of SAMPLE_REQUIRED_COLUMNS) {
    if (!header.includes(column)) throw new Oe2DataError(`sample.csv sin columna ${column}`);
  }
  if (rows.length === 0) throw new Oe2DataError('sample.csv sin targets');
  const ids = new Set();
  for (const row of rows) {
    const id = targetIdOf(row.filePath, row.qualifiedName);
    if (ids.has(id)) throw new Oe2DataError(`sample.csv repite el target ${id}`);
    ids.add(id);
  }
  return rows;
}

/**
 * Carga los volcados de `dump-results` (un JSON por comparación; `manifest.json` se ignora). Devuelve un Map por
 * identidad del símbolo `(filePath, qualifiedName)`. Verifica la forma, que existan SE y SEM y la configuración.
 */
export async function loadComparisons(dir) {
  const map = new Map();
  for (const file of await listJsonFiles(dir)) {
    const data = JSON.parse((await readFile(path.join(dir, file))).toString('utf8'));
    if (!data || typeof data !== 'object' || typeof data.retrievalComparisonId !== 'string' || !Array.isArray(data.modes)) {
      throw new Oe2DataError(`${file}: no es un volcado de comparación`);
    }
    const label = `comparación ${data.retrievalComparisonId}`;
    const symbol = data.symbol ?? {};
    if (typeof symbol.filePath !== 'string' || typeof symbol.qualifiedName !== 'string') {
      throw new Oe2DataError(`${label}: el símbolo no tiene filePath o qualifiedName`);
    }
    const modes = new Map();
    for (const mode of data.modes) {
      if (mode.mode !== 'SE' && mode.mode !== 'SEM') throw new Oe2DataError(`${label}: modo no reconocido`);
      verifyFrozenConfig(mode.mode, mode.config, label);
      modes.set(mode.mode, mode);
    }
    if (!modes.has('SE') || !modes.has('SEM') || modes.size !== 2) {
      throw new Oe2DataError(`${label}: deben existir exactamente los modos SE y SEM`);
    }
    const identity = identityKey(symbol.filePath, symbol.qualifiedName);
    if (map.has(identity)) throw new Oe2DataError(`varias comparaciones para el target ${symbol.filePath}::${symbol.qualifiedName}`);
    map.set(identity, { comparisonId: data.retrievalComparisonId, file, symbol, modes });
  }
  return map;
}

/** Trunca un código a `maxChars` con un marcador explícito. */
export function truncateCode(code, maxChars) {
  if (code.length <= maxChars) return code;
  return `${code.slice(0, maxChars)}\n[... código truncado: se muestran ${maxChars} de ${code.length} caracteres ...]\n`;
}

/** Fence de Markdown más largo que cualquier secuencia de comillas invertidas del código. */
function fenceFor(code) {
  const longest = (code.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function codeBlock(code) {
  const fence = fenceFor(code);
  return `${fence}php\n${code.endsWith('\n') ? code : `${code}\n`}${fence}\n`;
}

/**
 * Texto de la hoja ciega de un target. Solo código, archivo, símbolo, tipo y candidate_id. La introducción es un
 * puntero neutro a la guía (`ciego/GUIA.md`): no define relevancia; la define la guía, que redacta el equipo.
 */
export function renderSheet({ index, targetId, target, candidates, maxChars, guideSha256 }) {
  const lines = [
    `# Hoja ciega T${pad2(index)}`,
    '',
    `Para cada candidato, registra tu decisión y el criterio según la guía \`ciego/GUIA.md\` (SHA-256 ${guideSha256}). Usa solo esta hoja y la guía.`,
    '',
    `Target: ${targetId}`,
    `- Archivo: ${target.filePath}`,
    `- Símbolo: ${target.qualifiedName}`,
    `- Tipo: ${target.kind}`,
    '',
    codeBlock(truncateCode(target.code, maxChars)),
    '## Candidatos',
    '',
  ];
  for (const candidate of candidates) {
    lines.push(
      `### ${candidate.candidateId}`,
      `- Archivo: ${candidate.filePath}`,
      `- Símbolo: ${candidate.qualifiedName}`,
      `- Tipo: ${candidate.kind}`,
      '',
      codeBlock(truncateCode(candidate.code, maxChars)),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Elige el grupo de chunks de una identidad según la precedencia de tipo. Devuelve `{ group, ambiguous }`. */
function chooseGroup(groups) {
  const ordered = [...groups].sort((a, b) => {
    const rankA = KIND_PRECEDENCE.indexOf(a.kind);
    const rankB = KIND_PRECEDENCE.indexOf(b.kind);
    return (rankA === -1 ? 99 : rankA) - (rankB === -1 ? 99 : rankB) || compareCodeUnits(a.kind, b.kind);
  });
  return { group: ordered[0], ambiguous: groups.length > 1 };
}

/** Une los grupos de todas las identidades (símbolos y tipos) del volcado. */
function indexGroups(chunks) {
  const map = new Map();
  // CONSTRUCTOR entra aquí: el retriever no filtra por symbolKind y un constructor puede estar en el top-10 de SE o
  // SEM. Sigue FUERA del universo de `sample` (universe.mjs usa solo METHOD y FUNCTION).
  for (const group of groupSymbols(chunks, [...SYMBOL_KINDS, ...TYPE_KINDS, 'CONSTRUCTOR'])) {
    const identity = identityKey(group.filePath, group.qualifiedName ?? '');
    if (!map.has(identity)) map.set(identity, []);
    map.get(identity).push(group);
  }
  return map;
}

/**
 * Construye el pool de un target (función pura sobre el volcado y la comparación). Devuelve la lista de candidatos
 * con su origen, el cierre recalculado y los contadores. No produce archivos.
 */
export function buildTargetPool({ target, comparison, typeIndex, groupsByIdentity, closure }) {
  const targetIdentity = identityKey(target.filePath, target.qualifiedName);
  const entries = new Map();
  let withoutIdentity = 0;

  const ensure = (identity, filePath, qualifiedName) => {
    if (!entries.has(identity)) {
      entries.set(identity, { identity, filePath, qualifiedName, SE: null, SEM: null, inClosure: false });
    }
    return entries.get(identity);
  };

  const origin = (candidate) => ({
    rank: candidate.rank,
    semanticScore: candidate.semanticScore ?? null,
    structuralRelation: candidate.structuralRelation ?? null,
    combinedScore: candidate.combinedScore ?? null,
  });

  const distinct = { SE: new Set(), SEM: new Set() };
  for (const mode of ['SE', 'SEM']) {
    for (const candidate of comparison.modes.get(mode).candidates) {
      if (candidate.selected !== true) continue;
      if (typeof candidate.symbolQualifiedName !== 'string') {
        withoutIdentity += 1;
        continue;
      }
      const identity = identityKey(candidate.filePath, candidate.symbolQualifiedName);
      if (identity === targetIdentity) continue;
      const entry = ensure(identity, candidate.filePath, candidate.symbolQualifiedName);
      if (entry[mode] === null) entry[mode] = origin(candidate);
      distinct[mode].add(identity);
    }
  }

  for (const fqcn of closure) {
    const type = typeIndex.get(fqcn);
    const identity = identityKey(type.filePath, fqcn);
    if (identity === targetIdentity) continue;
    ensure(identity, type.filePath, fqcn).inClosure = true;
  }

  const ambiguousKinds = [];
  const pool = [];
  for (const entry of entries.values()) {
    const groups = groupsByIdentity.get(entry.identity);
    if (!groups || groups.length === 0) {
      throw new Oe2DataError(`candidato sin chunks en el volcado: ${entry.filePath}::${entry.qualifiedName}`);
    }
    const { group, ambiguous } = chooseGroup(groups);
    if (!group.complete) {
      throw new Oe2DataError(`candidato con partes incompletas en el volcado: ${entry.filePath}::${entry.qualifiedName}`);
    }
    if (ambiguous) ambiguousKinds.push(entry.identity);
    pool.push({ ...entry, group });
  }
  pool.sort((a, b) => compareCodeUnits(a.filePath, b.filePath) || compareCodeUnits(a.qualifiedName, b.qualifiedName));

  return {
    pool,
    counts: {
      nSE10: distinct.SE.size,
      nSEM10: distinct.SEM.size,
      nClosure: closure.length,
      nUnion: pool.length,
      nSEandSEM: pool.filter((entry) => entry.SE !== null && entry.SEM !== null).length,
      nSEandClosure: pool.filter((entry) => entry.SE !== null && entry.inClosure).length,
      nSEMandClosure: pool.filter((entry) => entry.SEM !== null && entry.inClosure).length,
      nSinIdentidad: withoutIdentity,
      ambiguousKinds: ambiguousKinds.length,
    },
  };
}

/** Barajado determinista por target: semilla = SHA-256(semilla + '|' + targetId) y Fisher–Yates descendente. */
export function shuffleForTarget(pool, seed, targetId) {
  const nextRaw = createMulberry32(seedStateFromText(`${seed}|${targetId}`));
  return shuffleInPlace([...pool], nextRaw);
}

/**
 * Términos de procedencia que la ceguera vigila (modo, rank, score, relación estructural, origen). La guía la escribe
 * el equipo y la tool no la modifica: solo se avisa si aparecen, para que se revise antes de distribuirla.
 */
const GUIDE_BLIND_TERMS_UPPER = /\bSEM?\b|IMPORTED_BY|IMPORTS|SAME_NAMESPACE|FULLY_QUALIFIED|DECLARING/g;
const GUIDE_BLIND_TERMS_LOWER = /\b(?:rank|score|estructural|structural|semantic|sem[aá]ntic[oa]s?|combined|selected|seleccionad[oa]s?|origen)\b/gi;

/** Términos de procedencia que aparecen en la guía (distintos, en orden de unidades de código). */
export function guideBlindTerms(guideText) {
  const found = new Set();
  for (const match of guideText.matchAll(GUIDE_BLIND_TERMS_UPPER)) found.add(match[0]);
  for (const match of guideText.matchAll(GUIDE_BLIND_TERMS_LOWER)) found.add(match[0].toLowerCase());
  return [...found].sort(compareCodeUnits);
}

/** Subcomando `pool`. `options.guide` es obligatorio; `options.roles` es `null` (todos) o una lista de roles. */
export async function runPool({ options, cwd, repoRoot }) {
  const outDir = await resolveOe2OutputDir(options, { cwd, repoRoot });
  if (typeof options.guide !== 'string' || options.guide.length === 0) {
    throw new UsageError('falta --guide <guia.md> (la guía de anotación es obligatoria)');
  }
  // La guía se copia byte a byte: no se decodifica ni se normaliza (puede tener CRLF o bytes no UTF-8).
  const guideBytes = await readFile(options.guide);
  if (guideBytes.length === 0) throw new Oe2DataError('la guía de anotación está vacía');
  const guideSha256 = sha256Hex(guideBytes);
  const { chunks, sha256: dumpSha256 } = await readChunksFile(options.dump);
  const sampleText = await readText(options.sample);
  const sampleRows = readSampleRows(sampleText);
  const roles = options.roles ?? null;
  const selectedRows = roles === null ? sampleRows : sampleRows.filter((row) => roles.includes(row.role));
  if (selectedRows.length === 0) throw new UsageError('ninguna fila de sample.csv tiene los roles pedidos en --roles');
  // Solo se exige comparación para las filas seleccionadas: las excluidas no generan hoja, plantilla ni llave.
  const comparisons = await loadComparisons(options.results);
  const typeIndex = buildTypeIndex(chunks);
  const groupsByIdentity = indexGroups(chunks);
  const seed = options.seed;

  const plan = new PackagePlan();
  plan.addBytes('ciego/GUIA.md', guideBytes);
  const keyTargets = {};
  const summaryRows = [];
  const templateRows = [];
  let candidateTotal = 0;
  let truncatedBlocks = 0;
  let truncatedTypeCandidates = 0;

  for (let index = 1; index <= selectedRows.length; index += 1) {
    const row = selectedRows[index - 1];
    const targetId = targetIdOf(row.filePath, row.qualifiedName);
    const targetIdentity = identityKey(row.filePath, row.qualifiedName);
    const targetGroup = (groupsByIdentity.get(targetIdentity) ?? []).find((group) => group.kind === row.kind);
    if (!targetGroup || !['METHOD', 'FUNCTION'].includes(row.kind)) {
      throw new Oe2DataError(`el target ${targetId} no está en el volcado como METHOD o FUNCTION`);
    }
    if (!targetGroup.complete) throw new Oe2DataError(`el target ${targetId} tiene partes incompletas en el volcado`);

    const closure = symbolClosure(targetGroup, typeIndex);
    if (closure.join(';') !== row.closureTypes) {
      throw new Oe2DataError(`${targetId}: el cierre recalculado no coincide con sample.csv (volcado o sample alterados)`);
    }
    const comparison = comparisons.get(targetIdentity);
    if (!comparison) throw new Oe2DataError(`falta la comparación de retrieval del target ${targetId}`);

    const built = buildTargetPool({ target: targetGroup, comparison, typeIndex, groupsByIdentity, closure });
    const shuffled = shuffleForTarget(built.pool, seed, targetId);
    const candidates = shuffled.map((entry, position) => ({
      candidateId: `${targetId}-${pad2(position + 1)}`,
      entry,
      filePath: entry.filePath,
      qualifiedName: entry.qualifiedName,
      kind: entry.group.kind,
      code: entry.group.content,
    }));
    candidateTotal += candidates.length;
    const overflow = (code) => code.length > options.maxChars;
    truncatedBlocks += candidates.filter((candidate) => overflow(candidate.code)).length + (overflow(targetGroup.content) ? 1 : 0);
    truncatedTypeCandidates += candidates.filter((candidate) => overflow(candidate.code) && TYPE_KINDS.includes(candidate.kind)).length;

    const sheetPath = `ciego/hojas/T${pad2(index)}.md`;
    plan.addText(sheetPath, renderSheet({
      index,
      targetId,
      target: {
        filePath: row.filePath,
        qualifiedName: row.qualifiedName,
        kind: targetGroup.kind,
        code: targetGroup.content,
      },
      candidates,
      maxChars: options.maxChars,
      guideSha256,
    }));

    const keyCandidates = {};
    for (const candidate of candidates) {
      templateRows.push({ candidate_id: candidate.candidateId, target_id: targetId });
      keyCandidates[candidate.candidateId] = {
        filePath: candidate.filePath,
        qualifiedName: candidate.qualifiedName,
        kind: candidate.kind,
        inClosure: candidate.entry.inClosure,
        SE: candidate.entry.SE,
        SEM: candidate.entry.SEM,
      };
    }
    keyTargets[targetId] = { sheet: sheetPath, order: index, candidates: keyCandidates };
    summaryRows.push({ targetId, role: row.role, ...built.counts });
  }

  plan.addText('ciego/annotation-template.csv', toCsv(TEMPLATE_COLUMNS, templateRows.map((row) => ({
    ...row,
    anotador_A_decision: '',
    anotador_A_criterio: '',
    anotador_B_decision: '',
    anotador_B_criterio: '',
    adjudicacion: '',
    adjudicacion_criterio: '',
  }))));
  plan.addText('pool-summary.csv', toCsv(POOL_SUMMARY_COLUMNS, summaryRows));
  plan.addText('clave/key.json', stableStringify({
    schemaVersion: 1,
    seedSha256: sha256Hex(seed),
    targets: keyTargets,
  }));

  const blindTerms = guideBlindTerms(guideBytes.toString('utf8'));
  const written = await writeOe2Package(outDir, plan, 'pool', {
    chunksJsonlSha256: dumpSha256,
    sampleSha256: sha256Hex(sampleText),
    seedSha256: sha256Hex(seed),
    guide: { path: 'ciego/GUIA.md', sha256: guideSha256, bytes: guideBytes.length },
    rolesSelected: roles ?? 'todos',
    targetsInSample: sampleRows.length,
    maxChars: options.maxChars,
    targets: selectedRows.length,
    candidates: candidateTotal,
    truncatedBlocks,
    truncatedTypeCandidates,
    blindDirectory: 'ciego',
    keyDirectory: 'clave',
  });
  const lines = [
    `Targets: ${selectedRows.length} de ${sampleRows.length} del sample (roles: ${roles === null ? 'todos' : roles.join(', ')}). Candidatos en pool: ${candidateTotal}.`,
    `Guía copiada a ciego/GUIA.md (SHA-256 ${guideSha256}, ${guideBytes.length} bytes).`,
  ];
  if (blindTerms.length > 0) {
    lines.push(`AVISO: la guía contiene términos de procedencia (${blindTerms.join(', ')}); revísala antes de distribuirla. La tool no la modifica.`);
  }
  const missingRoles = rolesWithoutRows(roles ?? [], sampleRows);
  if (missingRoles.length > 0) {
    lines.push(`AVISO: --roles pide ${missingRoles.join(', ')} y el sample no tiene filas de ese rol; no se procesan.`);
  }
  lines.push('Distribuye solo la carpeta ciego/ a los anotadores; clave/ queda aparte.', `Archivos escritos: ${written.length}.`);
  return { exitCode: 0, lines, outDir };
}

