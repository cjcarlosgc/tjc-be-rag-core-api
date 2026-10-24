// WI-CORE-094: construcción y escritura del paquete de evidencia. El paquete se arma en memoria (`PackagePlan`) y solo
// se escribe cuando todo se ha leído: si algo falla antes, la carpeta de salida no se toca. Los hashes de los
// archivos se calculan sobre los bytes que se escriben.
import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeSegment, sha256Hex, stableStringify } from './util.mjs';
import { UsageError } from './options.mjs';

export const PACKAGE_SCHEMA_VERSION = 1;
export const EXTRACTOR_INFO = Object.freeze({ name: 'extract-evidence', version: '1.0.0', workItem: 'WI-CORE-094' });

const MANIFEST_PATH = 'manifest.json';
const MANIFEST_SEAL_PATH = 'manifest.sha256';
const HASHES_PATH = 'hashes.txt';

/** Permisos de la evidencia: solo el propietario (archivos 0600, carpetas 0700). */
export const FILE_MODE = 0o600;
export const DIR_MODE = 0o700;

/** Ruta de paquete válida: segmentos seguros separados por `/`, sin rutas absolutas ni `..`. */
export function assertSafePackagePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.startsWith('/')) {
    throw new Error('ruta de paquete no válida');
  }
  for (const segment of relativePath.split('/')) assertSafeSegment(segment);
  return relativePath;
}

/** Acumula los archivos y las ausencias/truncados antes de escribir nada. */
export class PackagePlan {
  constructor() {
    this.files = new Map();
    this.absences = [];
    this.truncations = [];
  }

  has(relativePath) {
    return this.files.has(relativePath);
  }

  addBytes(relativePath, bytes) {
    assertSafePackagePath(relativePath);
    if (this.files.has(relativePath)) throw new Error(`archivo duplicado en el paquete: ${relativePath}`);
    this.files.set(relativePath, Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8'));
  }

  addText(relativePath, text) {
    this.addBytes(relativePath, Buffer.from(String(text), 'utf8'));
  }

  addJson(relativePath, value) {
    this.addText(relativePath, stableStringify(value));
  }

  /** Registra algo que no está persistido o no se pudo obtener (ausencia explícita, nunca relleno). */
  absence(item, reason, scope = null) {
    this.absences.push({ item, reason, ...(scope !== null ? { scope } : {}) });
  }

  /** Registra un contenido recortado (truncado) con el detalle de qué se conserva. */
  truncation(item, detail, file = null) {
    this.truncations.push({ item, detail, ...(file !== null ? { file } : {}) });
  }
}

/**
 * Cierra el paquete: añade `hashes.txt` (formato `sha256sum` de todos los archivos salvo `manifest.json`,
 * `manifest.sha256` y sí mismo), `manifest.json` (lista de archivos con tamaño y SHA-256) y `manifest.sha256`, que
 * sella los bytes de `manifest.json` en formato `sha256sum`. Excepción declarada: ni `manifest.json` ni
 * `manifest.sha256` pueden listar su propio hash; `manifest.sha256` debe sellarse externamente (p. ej. en el
 * handoff) si se quiere probar la integridad del propio manifiesto. Devuelve la lista ordenada `{ path, bytes }`.
 * `buildManifest(files)` recibe `{ path, bytes, sha256 }` de los archivos planeados y devuelve el manifiesto.
 */
export function finalizePackage(plan, buildManifest) {
  const sortedPaths = [...plan.files.keys()].sort();
  const hashLines = sortedPaths.map((relativePath) => `${sha256Hex(plan.files.get(relativePath))}  ${relativePath}\n`);
  plan.addText(HASHES_PATH, hashLines.join(''));

  const describe = (relativePath) => {
    const bytes = plan.files.get(relativePath);
    return { path: relativePath, bytes: bytes.length, sha256: sha256Hex(bytes) };
  };
  const files = [...plan.files.keys()].sort().map(describe);
  const manifest = buildManifest(files);
  plan.addJson(MANIFEST_PATH, manifest);
  plan.addText(MANIFEST_SEAL_PATH, `${sha256Hex(plan.files.get(MANIFEST_PATH))}  ${MANIFEST_PATH}\n`);

  return [...plan.files.keys()].sort().map((relativePath) => ({ path: relativePath, bytes: plan.files.get(relativePath) }));
}

function isInside(child, parent) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/** Resuelve enlaces simbólicos del primer ancestro existente y reconstruye el resto de la ruta. */
async function realpathOfDeepestExisting(absolute) {
  const missing = [];
  let current = absolute;
  for (;;) {
    try {
      const resolved = await realpath(current);
      return path.join(resolved, ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Valida la carpeta de salida: se rechaza dentro del repositorio (salvo `allowOutInRepo`), si existe y no es un
 * directorio, o si existe y no está vacía. Devuelve la ruta absoluta.
 */
export async function resolveOutputDir(out, { cwd, repoRoot, allowOutInRepo }) {
  const absolute = path.resolve(cwd, out);
  const realOut = await realpathOfDeepestExisting(absolute);
  const realRepo = await realpath(repoRoot);
  if (!allowOutInRepo && isInside(realOut, realRepo)) {
    throw new UsageError('--out está dentro del repositorio (usa --allow-out-in-repo si es intencional)');
  }
  try {
    const info = await stat(absolute);
    if (!info.isDirectory()) throw new UsageError('--out existe y no es una carpeta');
    const entries = await readdir(absolute);
    if (entries.length > 0) throw new UsageError('la carpeta de salida ya existe y no está vacía; elige otra');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return absolute;
}

/** Escribe los archivos bajo `outDir`. Usa `wx` para no sobrescribir nada. */
export async function writePackageFiles(outDir, entries) {
  await mkdir(outDir, { recursive: true, mode: DIR_MODE });
  for (const entry of entries) {
    const target = path.join(outDir, ...entry.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true, mode: DIR_MODE });
    await writeFile(target, entry.bytes, { flag: 'wx', mode: FILE_MODE });
  }
}
