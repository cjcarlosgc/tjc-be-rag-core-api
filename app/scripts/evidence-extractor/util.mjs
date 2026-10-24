// WI-CORE-094: utilidades puras del extractor (hash, JSON canónico, CSV, saneado de mensajes).
// Sin E/S ni dependencias del producto: se prueban con fixtures.
import { createHash } from 'node:crypto';

/** SHA-256 hexadecimal (minúsculas) de una cadena UTF-8 o de un Buffer. */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Serialización canónica idéntica a la del producto (`canonicalJson` de `src/experiments/repetition-artifact.ts`):
 * claves de objeto en orden lexicográfico, recursivamente y sin espacios. Se usa para recalcular los hashes
 * persistidos de `runnerReport` y `sandboxEvidence`.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map((item) => sortKeysDeep(item));
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}

/**
 * Escritura determinista de JSON para los archivos del paquete: claves ordenadas, indentación fija y salto final.
 * Pasa antes por JSON (aplica `toJSON`, por ejemplo a las fechas, y descarta `undefined`).
 */
export function stableStringify(value) {
  return `${JSON.stringify(sortKeysDeep(JSON.parse(JSON.stringify(value ?? null))), null, 2)}\n`;
}

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (typeof value === 'string') {
    // Evita que una celda de texto se interprete como fórmula al abrir el CSV en una hoja de cálculo.
    text = CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV UTF-8 con cabecera fija, escapes RFC 4180 y saltos de línea LF. Las filas siguen el orden recibido. */
export function toCsv(columns, rows) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','));
  return `${lines.join('\n')}\n`;
}

/**
 * Valores que nunca deben aparecer en una salida: las variables completas y, por separado, usuario, contraseña
 * (en bruto y decodificada) y host de `DATABASE_URL` y `SUPABASE_URL`. Ordenados de más largo a más corto.
 */
export function sensitiveValuesFrom(env) {
  const values = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.length > 0) values.add(value);
  };
  for (const key of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY']) add(env[key]);
  for (const key of ['DATABASE_URL', 'SUPABASE_URL']) {
    try {
      const parsed = new URL(env[key]);
      add(parsed.username);
      add(parsed.password);
      add(parsed.hostname);
      add(decodeURIComponent(parsed.username));
      add(decodeURIComponent(parsed.password));
    } catch {
      // Valor malformado: ya está cubierto por la variante completa.
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** Sustituye en un texto cualquier aparición literal de los valores sensibles (los más largos primero). */
export function scrubSecrets(text, secrets) {
  let scrubbed = String(text ?? '');
  const ordered = [...secrets].filter((secret) => typeof secret === 'string' && secret.length > 0).sort((a, b) => b.length - a.length);
  for (const secret of ordered) scrubbed = scrubbed.split(secret).join('[REDACTED]');
  return scrubbed;
}

/**
 * Nombre de archivo seguro derivado de un nombre libre (símbolo, ruta): solo ASCII seguro, sin secuencias `..`,
 * sin punto inicial y como máximo 80 caracteres. Nunca lanza: un nombre vacío queda como `sin-nombre`.
 */
export function fileStem(name) {
  const cleaned = String(name ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '')
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : 'sin-nombre';
}

/** Comprueba que un segmento de ruta del paquete es seguro (sin separadores, sin `..`). */
export function assertSafeSegment(segment) {
  if (typeof segment !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment) || segment.includes('..')) {
    throw new Error('segmento de ruta del paquete no válido');
  }
  return segment;
}

/** Texto de la forma `<n> <singular|plural>` para mensajes en español. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
