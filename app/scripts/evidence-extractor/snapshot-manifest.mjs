// WI-CORE-105 (C3): manifiesto del snapshot que recibió el Sandbox. Función pura: recibe los bytes del ZIP
// (`project-versions/<projectVersionId>/snapshot.zip`) y devuelve la lista de archivos con tamaño y SHA-256. Es la
// verdad de «lo que ve el Sandbox», para que la baseline externa se calcule sobre el mismo conjunto (Piloto v2).
//
// Forma del resultado:
//   - ZIP legible: `{ schema: 'snapshot-manifest', schemaVersion: 1, projectVersionId, key, zipBytes, zipSha256,
//     entryCount, totalUncompressedBytes, entries: [{ path, bytes, sha256 }], byExtension: { php: n, … },
//     skipped: [{ path, reason }] }`. NO lleva campo `ok`: el fallo se distingue por `ok === false`.
//   - ZIP no legible: `{ ok: false, reason: 'invalid_zip' }` (nunca lanza).
// Defensas (sin descomprimir lo que no se pueda confiar):
//   - `unsafe_path`: ruta vacía, absoluta, con `\`, con NUL, con unidad de Windows o con un segmento `.`, `..` o vacío.
//     No se lista como entrada ni se descomprime.
//   - `too_large`: tamaño declarado > 16 MiB. Se lista con `sha256: null` y no se descomprime.
//   - `total_too_large`: si la suma de tamaños declarados supera 256 MiB, se detiene el recorrido (en orden de ruta) y
//     las entradas restantes quedan declaradas, sin listarse ni descomprimirse.
//   - `duplicate_path`: una ruta repetida en el ZIP; solo se considera la primera.
//   - `unreadable`: la entrada falla al descomprimirse (CRC o tamaño incoherente); se lista con `sha256: null`.
// Las entradas de directorio no cuentan. `entries` va ordenado por ruta (orden por defecto de JS): resultado determinista.
import path from 'node:path';
import AdmZip from 'adm-zip';
import { sha256Hex } from './util.mjs';

export const SNAPSHOT_MANIFEST_SCHEMA = 'snapshot-manifest';
export const SNAPSHOT_MANIFEST_SCHEMA_VERSION = 1;
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const NO_EXTENSION_LABEL = '(sin extensión)';

/** Ruta relativa segura de un ZIP: sin raíz, sin unidad, sin `\`, sin NUL y sin segmentos `.`, `..` o vacíos. */
export function isSafeArchivePath(entryPath) {
  if (typeof entryPath !== 'string' || entryPath.length === 0) return false;
  if (entryPath.startsWith('/') || entryPath.includes('\\') || entryPath.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(entryPath)) return false;
  return entryPath.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Resultado de fallo de `buildSnapshotManifest` (no lanza nunca). */
export function isSnapshotManifestError(result) {
  return result !== null && typeof result === 'object' && result.ok === false;
}

function extensionOf(entryPath) {
  const extension = path.posix.extname(entryPath).slice(1).toLowerCase();
  return extension.length > 0 ? extension : NO_EXTENSION_LABEL;
}

export function buildSnapshotManifest(zipBytes, { projectVersionId, key }) {
  let zip;
  let rawEntries;
  try {
    zip = new AdmZip(Buffer.from(zipBytes));
    rawEntries = zip.getEntries();
  } catch {
    return { ok: false, reason: 'invalid_zip' };
  }

  const skipped = [];
  const candidates = [];
  const seen = new Set();
  for (const entry of rawEntries) {
    if (entry.isDirectory) continue;
    const entryPath = entry.entryName;
    if (!isSafeArchivePath(entryPath)) {
      skipped.push({ path: typeof entryPath === 'string' ? entryPath : '', reason: 'unsafe_path' });
      continue;
    }
    if (seen.has(entryPath)) {
      skipped.push({ path: entryPath, reason: 'duplicate_path' });
      continue;
    }
    seen.add(entryPath);
    candidates.push(entry);
  }
  candidates.sort((a, b) => (a.entryName < b.entryName ? -1 : a.entryName > b.entryName ? 1 : 0));

  const entries = [];
  let totalUncompressedBytes = 0;
  let stopped = false;
  for (const entry of candidates) {
    const entryPath = entry.entryName;
    if (stopped) {
      skipped.push({ path: entryPath, reason: 'total_too_large' });
      continue;
    }
    const declared = Number(entry.header.size);
    if (!Number.isFinite(declared) || declared < 0 || totalUncompressedBytes + declared > MAX_TOTAL_BYTES) {
      stopped = true;
      skipped.push({ path: entryPath, reason: 'total_too_large' });
      continue;
    }
    totalUncompressedBytes += declared;
    if (declared > MAX_ENTRY_BYTES) {
      entries.push({ path: entryPath, bytes: declared, sha256: null });
      skipped.push({ path: entryPath, reason: 'too_large' });
      continue;
    }
    let data;
    try {
      data = entry.getData();
    } catch {
      data = null;
    }
    if (data === null || data.length > MAX_ENTRY_BYTES) {
      entries.push({ path: entryPath, bytes: declared, sha256: null });
      skipped.push({ path: entryPath, reason: data === null ? 'unreadable' : 'too_large' });
      continue;
    }
    entries.push({ path: entryPath, bytes: data.length, sha256: sha256Hex(data) });
  }

  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));

  const counts = new Map();
  for (const entry of entries) {
    const extension = extensionOf(entry.path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  const byExtension = Object.fromEntries([...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));

  return {
    schema: SNAPSHOT_MANIFEST_SCHEMA,
    schemaVersion: SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    projectVersionId,
    key,
    zipBytes: zipBytes.length,
    zipSha256: sha256Hex(zipBytes),
    entryCount: entries.length,
    totalUncompressedBytes,
    entries,
    byExtension,
    skipped,
  };
}
