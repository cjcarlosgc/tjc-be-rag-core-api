// WI-CORE-107: primitivas puras del CLI OE2 (CSV de lectura, PRNG determinista, ordenación por unidades de código,
// lectura de volcados JSONL con verificación de hash). Sin E/S salvo `readChunksFile`, que solo lee un archivo.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sha256Hex } from '../evidence-extractor/util.mjs';

export class Oe2DataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Oe2DataError';
  }
}

/**
 * Lector CSV RFC 4180 (inverso de `toCsv` del extractor): campos entre comillas con `""`, saltos de línea dentro de
 * comillas, CRLF o LF. Devuelve `{ header, rows }` con filas como objetos. Lanza `Oe2DataError` si la forma no encaja.
 */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      if (field.length > 0) throw new Oe2DataError('CSV: comilla fuera de lugar');
      inQuotes = true;
      i += 1;
    } else if (char === ',') {
      record.push(field);
      field = '';
      i += 1;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }
  if (inQuotes) throw new Oe2DataError('CSV: comillas sin cerrar');
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  if (records.length === 0) throw new Oe2DataError('CSV vacío');
  const [header, ...body] = records;
  const rows = body.map((cells, index) => {
    if (cells.length !== header.length) {
      throw new Oe2DataError(`CSV: la fila ${index + 2} tiene ${cells.length} columnas y la cabecera ${header.length}`);
    }
    const row = {};
    header.forEach((name, column) => {
      row[name] = cells[column];
    });
    return row;
  });
  return { header, rows };
}

/** Comparación por unidades de código UTF-16 (sin collation locale): -1, 0 o 1. */
export function compareCodeUnits(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Semilla de 32 bits: primeros 4 bytes, big-endian, de SHA-256 del texto en UTF-8. */
export function seedStateFromText(seedText) {
  return createHash('sha256').update(seedText, 'utf8').digest().readUInt32BE(0);
}

/**
 * PRNG mulberry32 con estado inicial `state` (uint32). Devuelve una función que produce la salida CRUDA de 32 bits
 * (entero sin signo). El valor en [0, 1) es `raw / 2^32`. Algoritmo: `state = (state + 0x6D2B79F5) | 0`; luego
 * mezcla con `Math.imul` y la salida es `(t ^ (t >>> 14)) >>> 0`.
 */
export function createMulberry32(state) {
  let current = state >>> 0;
  return function nextRaw() {
    current = (current + 0x6d2b79f5) | 0;
    let t = current;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Barajado de Fisher–Yates descendente (`i = n-1..1`, `j = floor(rand() * (i + 1))`), in place. */
export function shuffleInPlace(items, nextRaw) {
  for (let i = items.length - 1; i >= 1; i -= 1) {
    const j = Math.floor((nextRaw() / 4294967296) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Hexadecimal de 8 dígitos de un entero sin signo de 32 bits. */
export function hex32(value) {
  return value.toString(16).padStart(8, '0');
}

/** Dos dígitos con relleno a la izquierda (para `candidate_id` y ids de hoja). */
export function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Clave de identidad de un símbolo en el volcado: (filePath, symbolKind, symbolName, parentSymbolName). Los nulos se
 * conservan en la clave (JSON), así que no colisionan con cadenas vacías.
 */
export function symbolGroupKey(chunk) {
  return JSON.stringify([chunk.filePath, chunk.symbolKind, chunk.symbolName, chunk.parentSymbolName]);
}

/** Identidad de análisis `(filePath, symbolQualifiedName)` (la misma de las métricas del producto). */
export function identityKey(filePath, symbolQualifiedName) {
  return `${filePath}\u0000${symbolQualifiedName}`;
}

/** Valida una ruta relativa segura de proyecto: sin absolutas, sin `..` y sin segmentos vacíos. */
export function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) throw new Oe2DataError('ruta vacía en el sample');
  if (relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath) || relativePath.includes('\\')) {
    throw new Oe2DataError('ruta no relativa o con separadores no válidos en el sample');
  }
  for (const segment of relativePath.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Oe2DataError('ruta insegura en el sample (vacía, "." o "..")');
    }
  }
  return relativePath;
}

/** Campos obligatorios de cada línea de `chunks.jsonl` (ver `dump-chunks`). */
const CHUNK_REQUIRED = ['filePath', 'symbolKind', 'partIndex', 'partsTotal', 'content', 'contentSha256'];

/**
 * Parsea el texto de un volcado `chunks.jsonl`. Verifica que `contentSha256` coincide con el contenido: un volcado
 * alterado a mano no se acepta. Lanza `Oe2DataError` con el número de línea.
 */
export function parseChunksJsonl(text) {
  const chunks = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line.length === 0) return;
    let chunk;
    try {
      chunk = JSON.parse(line);
    } catch {
      throw new Oe2DataError(`chunks.jsonl línea ${index + 1}: JSON no válido`);
    }
    for (const field of CHUNK_REQUIRED) {
      if (!(field in chunk)) throw new Oe2DataError(`chunks.jsonl línea ${index + 1}: falta ${field}`);
    }
    if (sha256Hex(chunk.content) !== chunk.contentSha256) {
      throw new Oe2DataError(`chunks.jsonl línea ${index + 1}: contentSha256 no coincide con el contenido`);
    }
    chunks.push(chunk);
  });
  return chunks;
}

/** Lee y parsea un volcado de chunks desde disco. */
export async function readChunksFile(filePath) {
  const bytes = await readFile(filePath);
  return { chunks: parseChunksJsonl(bytes.toString('utf8')), sha256: sha256Hex(bytes) };
}

/** Lee un archivo de texto UTF-8 desde disco. */
export async function readText(filePath) {
  return (await readFile(filePath)).toString('utf8');
}
