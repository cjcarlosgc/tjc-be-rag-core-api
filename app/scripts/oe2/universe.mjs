// WI-CORE-107: universo de símbolos y elegibilidad ex ante (D-OE2-5). Sin retrieval ni resultados: solo el volcado de
// chunks. Un símbolo es una entidad METHOD o FUNCTION (sus partes se agrupan); los CONSTRUCTOR quedan fuera.
import { isIgnoredPath, isTestFile, symbolQualifiedNameOf } from './product-copies.mjs';
import { scanFunctionSignature } from './php-signature.mjs';
import { buildTypeIndex, symbolClosure } from './closure.mjs';
import { Oe2DataError, compareCodeUnits, identityKey, symbolGroupKey } from './io-primitives.mjs';

export const SYMBOL_KINDS = Object.freeze(['METHOD', 'FUNCTION']);

/** Concatena las partes de un símbolo en orden de `partIndex`. */
export function joinParts(parts) {
  return [...parts].sort((a, b) => a.partIndex - b.partIndex).map((part) => part.content).join('');
}

/**
 * Agrupa los chunks METHOD/FUNCTION por símbolo. Cada grupo: `{ filePath, kind, symbolName, parentSymbolName,
 * qualifiedName, parts, complete, importsUsed, content }`. `complete` es falso si faltan partes o hay índices
 * repetidos (el contenido no sería el del símbolo completo).
 */
export function groupSymbols(chunks, kinds = SYMBOL_KINDS) {
  const groups = new Map();
  for (const chunk of chunks) {
    if (!kinds.includes(chunk.symbolKind)) continue;
    const key = symbolGroupKey(chunk);
    if (!groups.has(key)) {
      groups.set(key, {
        filePath: chunk.filePath,
        kind: chunk.symbolKind,
        symbolName: chunk.symbolName,
        parentSymbolName: chunk.parentSymbolName,
        qualifiedName: symbolQualifiedNameOf(chunk),
        parts: [],
      });
    }
    groups.get(key).parts.push(chunk);
  }
  return [...groups.values()].map((group) => {
    const parts = [...group.parts].sort((a, b) => a.partIndex - b.partIndex);
    const indices = parts.map((part) => part.partIndex);
    const complete = parts.length > 0
      && parts.every((part) => part.partsTotal === parts.length)
      && indices.every((index, position) => index === position + 1);
    const importsUsed = [...new Set(parts.flatMap((part) => toArray(part.importsUsed)))];
    return {
      ...group,
      parts,
      complete,
      importsUsed,
      content: joinParts(parts),
    };
  });
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Motivos de no elegibilidad, en orden de precedencia (el primero que aplica). */
export const INELIGIBLE_REASONS = Object.freeze({
  TEST_FILE: 'archivo-de-prueba',
  IGNORED_PATH: 'ruta-ignorada',
  NOT_PHP: 'no-php',
  INCOMPLETE: 'partes-incompletas',
  NO_SIGNATURE: 'firma-no-encontrada',
  NO_BODY: 'sin-cuerpo',
  EMPTY_CLOSURE: 'cierre-vacio',
  EXCLUDED: 'excluido-smoke',
});

/**
 * Universo: una fila por símbolo METHOD/FUNCTION con `filePath, qualifiedName, kind, isTest, hasBody, closureSize,
 * eligible, reason` y, además, `closure` (FQCN) y `symbol` (grupo, para el resto de subcomandos). `excluded` es un
 * Set de identidades `identityKey(filePath, qualifiedName)` que no pueden entrar (smoke).
 */
export function buildUniverse(chunks, { excluded = new Set() } = {}) {
  const typeIndex = buildTypeIndex(chunks);
  const groups = groupSymbols(chunks);
  const seen = new Set();
  const rows = groups.map((group) => {
    const identity = identityKey(group.filePath, group.qualifiedName ?? '');
    if (group.qualifiedName === null || group.qualifiedName === undefined) {
      return finalizeRow(group, { isTest: false, hasBody: null, closure: [], reason: 'sin-nombre' });
    }
    if (seen.has(identity)) {
      throw new Oe2DataError('identidad de símbolo duplicada en el volcado (mismo archivo y nombre calificado)');
    }
    seen.add(identity);

    const isTest = isTestFile(group.filePath);
    const ignored = isIgnoredPath(group.filePath);
    const php = /\.php$/i.test(group.filePath);
    const signature = group.complete ? scanFunctionSignature(group.content) : { found: false, hasBody: null };
    const closure = group.complete && signature.hasBody === true
      ? symbolClosure({ ...group, content: group.content }, typeIndex)
      : [];

    let reason = '';
    if (isTest) reason = INELIGIBLE_REASONS.TEST_FILE;
    else if (ignored) reason = INELIGIBLE_REASONS.IGNORED_PATH;
    else if (!php) reason = INELIGIBLE_REASONS.NOT_PHP;
    else if (!group.complete) reason = INELIGIBLE_REASONS.INCOMPLETE;
    else if (!signature.found) reason = INELIGIBLE_REASONS.NO_SIGNATURE;
    else if (signature.hasBody !== true) reason = INELIGIBLE_REASONS.NO_BODY;
    else if (closure.length === 0) reason = INELIGIBLE_REASONS.EMPTY_CLOSURE;
    else if (excluded.has(identity)) reason = INELIGIBLE_REASONS.EXCLUDED;

    return finalizeRow(group, { isTest, hasBody: signature.hasBody, closure, reason });
  });
  rows.sort((a, b) => compareCodeUnits(a.filePath, b.filePath) || compareCodeUnits(a.qualifiedName, b.qualifiedName));
  return { rows, typeIndex, eligible: rows.filter((row) => row.eligible) };
}

function finalizeRow(group, { isTest, hasBody, closure, reason }) {
  return {
    filePath: group.filePath,
    qualifiedName: group.qualifiedName,
    kind: group.kind,
    isTest,
    hasBody,
    closureSize: closure.length,
    eligible: reason === '',
    reason,
    closure,
    symbol: group,
  };
}

/** Columnas de `universe.csv` en el orden fijado por la especificación. */
export const UNIVERSE_COLUMNS = Object.freeze([
  'filePath', 'qualifiedName', 'kind', 'isTest', 'hasBody', 'closureSize', 'eligible', 'reason',
]);

/** Fila de `universe.csv` (sin los campos internos). */
export function universeCsvRow(row) {
  return {
    filePath: row.filePath,
    qualifiedName: row.qualifiedName,
    kind: row.kind,
    isTest: row.isTest,
    hasBody: row.hasBody === null ? '' : row.hasBody,
    closureSize: row.closureSize,
    eligible: row.eligible,
    reason: row.reason,
  };
}
