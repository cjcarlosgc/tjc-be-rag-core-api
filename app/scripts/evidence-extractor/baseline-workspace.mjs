// WI-CORE-105 (C3): baseline sobre el MISMO conjunto de archivos que recibió el Sandbox. Dado un checkout local ya
// hecho (en el HEAD del PR, con `core.autocrlf=false`) y un `snapshot-manifest.json` del extractor, copia a `--out`
// exactamente los archivos del manifiesto cuyo SHA-256 coincide. No usa red ni git: el operador prepara el checkout.
//
// Qué verifica por entrada con `sha256`:
//   - `copied`: el archivo existe en el checkout, es un archivo regular dentro del checkout y su SHA-256 coincide;
//     se copia con los mismos bytes.
//   - `missing`: no existe en el checkout.
//   - `different`: existe pero su tamaño o SHA-256 no coincide, o no es un archivo regular. NO se copia.
//   - `rejected`: la ruta real queda fuera del checkout (p. ej. enlace simbólico que apunta fuera). No se sigue ni se copia.
//   - `skipped`: entrada con `sha256: null` (demasiado grande o ilegible en el snapshot): no hay nada contra qué comparar.
// Manifiesto parcial: si el manifiesto trae `skipped` no vacío, entradas con `sha256: null` o `entries` vacío, la baseline
// NO cubre todo lo que recibió el Sandbox: se copia lo que coincide, se informa el motivo y el código de salida es 1.
// Código de salida 1 si hay `missing`, `different`, `rejected` o manifiesto parcial/vacío; 0 solo si todo coincide.
// La salida solo muestra recuentos y rutas relativas del manifiesto, nunca contenido de archivos.
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from './options.mjs';
import { sha256Hex } from './util.mjs';
import { isSafeArchivePath } from './snapshot-manifest.mjs';

export const BASELINE_HELP_TEXT = `Uso (desde tjc-be-rag-core-api/app):
  node scripts/baseline-workspace.mjs --checkout <dir> --manifest <snapshot-manifest.json> --out <dir>
                                      [--allow-out-in-repo]

Opciones:
  --checkout <dir>       Checkout local del repositorio, ya en el HEAD del PR y con core.autocrlf=false. Obligatoria.
  --manifest <archivo>   snapshot-manifest.json producido por extract-evidence.mjs. Obligatoria.
  --out <dir>            Carpeta de salida: se copian solo los archivos del manifiesto cuyo SHA-256 coincide. Debe estar
                         vacía o no existir, fuera del checkout y (por defecto) fuera del repositorio. Obligatoria.
  --allow-out-in-repo    Permite una --out dentro del repositorio (por defecto se rechaza).
  --help                 Muestra esta ayuda y sale.

No usa red ni git. Códigos de salida: 0 todo coincide; 1 hay faltantes, distintos o rechazados; 2 uso incorrecto.
`;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** Modos de la copia: legible por otros usuarios (p. ej. un contenedor no root que monta la carpeta). */
const COPY_FILE_MODE = 0o644;
const COPY_DIR_MODE = 0o755;
const MAX_LISTED_PROBLEMS = 100;

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`la opción ${flag} necesita un valor`);
  return value;
}

/** Argumentos de la CLI de baseline. Nunca repite un argumento desconocido. */
export function parseBaselineArguments(argv) {
  const options = { help: false, checkout: null, manifest: null, out: null, allowOutInRepo: false };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--checkout':
        index += 1;
        options.checkout = takeValue(argv, index, '--checkout');
        break;
      case '--manifest':
        index += 1;
        options.manifest = takeValue(argv, index, '--manifest');
        break;
      case '--out':
        index += 1;
        options.out = takeValue(argv, index, '--out');
        break;
      case '--allow-out-in-repo':
        options.allowOutInRepo = true;
        break;
      default:
        throw new UsageError('argumento desconocido (ver --help)');
    }
  }
  if (options.help) return options;
  for (const [flag, value] of [['--checkout', options.checkout], ['--manifest', options.manifest], ['--out', options.out]]) {
    if (value === null) throw new UsageError(`falta ${flag}`);
    if (value.trim().length === 0) throw new UsageError(`${flag} no puede estar vacío`);
  }
  return options;
}

/** Valida el esquema del manifiesto y devuelve sus entradas. Lanza `UsageError` sin repetir contenido del archivo. */
export function validateSnapshotManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new UsageError('el manifiesto no es un objeto JSON');
  }
  if (manifest.schema !== 'snapshot-manifest') throw new UsageError("el manifiesto no tiene schema 'snapshot-manifest'");
  if (manifest.schemaVersion !== 1) throw new UsageError('schemaVersion del manifiesto no soportada (se espera 1)');
  if (!Array.isArray(manifest.entries)) throw new UsageError('el manifiesto no tiene la lista entries');
  if (manifest.skipped !== undefined && !Array.isArray(manifest.skipped)) throw new UsageError('skipped del manifiesto no es una lista');
  const seen = new Set();
  manifest.entries.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new UsageError(`la entrada ${index} del manifiesto no es un objeto`);
    }
    if (!isSafeArchivePath(entry.path)) throw new UsageError(`la entrada ${index} del manifiesto tiene una ruta no segura`);
    if (entry.sha256 !== null && !(typeof entry.sha256 === 'string' && SHA256_PATTERN.test(entry.sha256))) {
      throw new UsageError(`la entrada ${index} del manifiesto tiene un sha256 no válido`);
    }
    if (entry.bytes !== undefined && !(Number.isInteger(entry.bytes) && entry.bytes >= 0)) {
      throw new UsageError(`la entrada ${index} del manifiesto tiene un tamaño no válido`);
    }
    if (seen.has(entry.path)) throw new UsageError(`la entrada ${index} del manifiesto repite una ruta`);
    seen.add(entry.path);
  });
  return manifest.entries;
}

function isInside(child, parent) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/** Resuelve enlaces simbólicos del primer ancestro existente y reconstruye el resto de la ruta. */
async function realpathOfDeepestExisting(fs, absolute) {
  const missing = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

async function resolveOut(fs, { out, cwd, repoRoot, allowOutInRepo, checkoutReal }) {
  const absolute = path.resolve(cwd, out);
  const realOut = await realpathOfDeepestExisting(fs, absolute);
  if (isInside(realOut, checkoutReal)) throw new UsageError('--out no puede estar dentro del checkout (ni ser el checkout)');
  if (isInside(checkoutReal, realOut)) throw new UsageError('--out no puede contener el checkout');
  const realRepo = await fs.realpath(repoRoot);
  if (!allowOutInRepo && isInside(realOut, realRepo)) {
    throw new UsageError('--out está dentro del repositorio (usa --allow-out-in-repo si es intencional)');
  }
  try {
    const info = await fs.stat(absolute);
    if (!info.isDirectory()) throw new UsageError('--out existe y no es una carpeta');
    if ((await fs.readdir(absolute)).length > 0) throw new UsageError('la carpeta de salida ya existe y no está vacía; elige otra');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return absolute;
}

/** Motivos (`reason`) de `skipped` con su recuento; solo cadenas cortas y seguras, nunca rutas. */
function skippedReasons(skipped) {
  const counts = new Map();
  for (const item of Array.isArray(skipped) ? skipped : []) {
    const reason = typeof item?.reason === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(item.reason) ? item.reason : '(sin motivo)';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

async function compareEntry(fs, checkoutReal, entry) {
  const target = path.join(checkoutReal, ...entry.path.split('/'));
  if (!isInside(path.resolve(target), checkoutReal)) return { status: 'rejected', note: 'la ruta sale del checkout' };
  let real;
  try {
    real = await fs.realpath(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { status: 'missing' };
    throw error;
  }
  if (!isInside(real, checkoutReal)) return { status: 'rejected', note: 'la ruta real queda fuera del checkout (enlace simbólico)' };
  const info = await fs.stat(real);
  if (!info.isFile()) return { status: 'different', note: 'no es un archivo regular' };
  if (typeof entry.bytes === 'number' && info.size !== entry.bytes) {
    return { status: 'different', note: 'el tamaño no coincide con el manifiesto' };
  }
  const bytes = await fs.readFile(real);
  if (sha256Hex(bytes) !== entry.sha256) return { status: 'different', note: 'el SHA-256 no coincide con el manifiesto' };
  return { status: 'match', bytes };
}

/**
 * Ejecuta la baseline. `deps.fs` es un objeto con la forma de `node:fs/promises` (se inyecta en pruebas). Devuelve
 * `{ outDir, counts, problems, exitCode }`; lanza `UsageError` por argumentos o manifiesto inválidos.
 */
export async function runBaselineWorkspace({ options, cwd, repoRoot, fs = nodeFs }) {
  let manifestText;
  try {
    manifestText = await fs.readFile(path.resolve(cwd, options.manifest), 'utf8');
  } catch {
    throw new UsageError('no se pudo leer el archivo de --manifest');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new UsageError('el manifiesto no es JSON válido');
  }
  const entries = validateSnapshotManifest(manifest);

  let checkoutReal;
  try {
    checkoutReal = await fs.realpath(path.resolve(cwd, options.checkout));
    if (!(await fs.stat(checkoutReal)).isDirectory()) throw new UsageError('--checkout no es una carpeta');
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError('--checkout no existe o no se puede leer');
  }
  const outDir = await resolveOut(fs, {
    out: options.out,
    cwd,
    repoRoot,
    allowOutInRepo: options.allowOutInRepo,
    checkoutReal,
  });
  await fs.mkdir(outDir, { recursive: true, mode: COPY_DIR_MODE });

  const counts = { entries: entries.length, copied: 0, missing: 0, different: 0, skipped: 0, rejected: 0 };
  const problems = [];
  for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (entry.sha256 === null) {
      counts.skipped += 1;
      problems.push({ path: entry.path, status: 'skipped', note: 'sin sha256 en el manifiesto (demasiado grande o ilegible)' });
      continue;
    }
    const result = await compareEntry(fs, checkoutReal, entry);
    if (result.status === 'match') {
      const destination = path.join(outDir, ...entry.path.split('/'));
      try {
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: COPY_DIR_MODE });
        await fs.writeFile(destination, result.bytes, { flag: 'wx', mode: COPY_FILE_MODE });
        counts.copied += 1;
      } catch (error) {
        // `wx` nunca sobrescribe: una colisión (p. ej. rutas que difieren solo en mayúsculas en un sistema de archivos
        // insensible) se registra y la ejecución sigue; el código de salida será 1.
        if (error?.code !== 'EEXIST' && error?.code !== 'ENOTDIR' && error?.code !== 'EISDIR') throw error;
        counts.rejected += 1;
        problems.push({ path: entry.path, status: 'rejected', note: 'colisión de rutas en --out (no se sobrescribe)' });
      }
    } else {
      counts[result.status] += 1;
      problems.push({ path: entry.path, status: result.status, ...(result.note ? { note: result.note } : {}) });
    }
  }
  const nullSha = entries.filter((entry) => entry.sha256 === null).length;
  const manifestSkipped = Array.isArray(manifest.skipped) ? manifest.skipped.length : 0;
  const partial = {
    empty: entries.length === 0,
    skipped: manifestSkipped,
    skippedReasons: skippedReasons(manifest.skipped),
    nullSha256: nullSha,
    isPartial: entries.length === 0 || manifestSkipped > 0 || nullSha > 0,
  };
  const exitCode = counts.missing > 0 || counts.different > 0 || counts.rejected > 0 || partial.isPartial ? 1 : 0;
  return { outDir, counts, problems, partial, exitCode };
}

/** Resumen legible: recuentos y, si los hay, las rutas con problema (hasta un tope). Sin contenido de archivos. */
export function formatBaselineSummary({ outDir, counts, problems, partial, exitCode }) {
  const lines = [
    `Baseline escrita en: ${outDir}`,
    `Entradas del manifiesto: ${counts.entries}`,
    `  copiados (SHA-256 coincide): ${counts.copied}`,
    `  faltantes en el checkout:    ${counts.missing}`,
    `  distintos (no se copian):    ${counts.different}`,
    `  rechazados (fuera del checkout): ${counts.rejected}`,
    `  omitidos (sin sha256):       ${counts.skipped}`,
  ];
  const listed = [...problems.filter((item) => item.status !== 'skipped'), ...problems.filter((item) => item.status === 'skipped')];
  for (const item of listed.slice(0, MAX_LISTED_PROBLEMS)) {
    lines.push(`  - ${item.status}: ${item.path}${item.note ? ` (${item.note})` : ''}`);
  }
  if (listed.length > MAX_LISTED_PROBLEMS) lines.push(`  ... y ${listed.length - MAX_LISTED_PROBLEMS} más`);
  const reasons = Object.entries(partial?.skippedReasons ?? {}).map(([reason, count]) => `${reason}: ${count}`).join(', ');
  if (partial?.isPartial) {
    const parts = [];
    if (partial.empty) parts.push('entries vacío');
    if (partial.skipped > 0) parts.push(`${partial.skipped} omitidas en el manifiesto${reasons ? ` (${reasons})` : ''}`);
    if (partial.nullSha256 > 0) parts.push(`${partial.nullSha256} entradas sin sha256`);
    lines.push(`Manifiesto: ${parts.join('; ')}`);
    const others = counts.missing + counts.different + counts.rejected > 0 ? ' Además hay faltantes, distintos o rechazados.' : '';
    lines.push(`Resultado: ⛔ manifiesto parcial o vacío: la baseline no cubre todo lo que recibió el Sandbox (lo que coincide sí se copió).${others}`);
  } else if (exitCode !== 0) {
    lines.push('Resultado: ⛔ hay faltantes, distintos o rechazados; la baseline no es comparable. Revisa el checkout (HEAD del PR, core.autocrlf=false).');
  } else {
    lines.push('Resultado: ✅ todo coincide con el manifiesto completo.');
  }
  return `${lines.join('\n')}\n`;
}
