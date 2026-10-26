// WI-CORE-107: subcomando `support-files`. Prepara la copia de soporte de los archivos con un target: añade la línea
// `// oe2-support` al final del archivo, sin tocar el checkout. El checkout se lee; nunca se escribe ni se modifica.
// La línea va fuera de todo símbolo (al final del archivo, tras su último carácter).
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeRelativePath, Oe2DataError, parseCsv } from './io-primitives.mjs';
import { PackagePlan, writeOe2Package, resolveOe2OutputDir } from './output.mjs';
import { sha256Hex } from '../evidence-extractor/util.mjs';

export const SUPPORT_MARKER = '// oe2-support';

/**
 * Transforma el contenido original en el de soporte. Rechaza `?>` (cerraría el modo PHP y la línea quedaría como
 * HTML). Si el archivo no termina en salto de línea, lo añade antes de la marca; el salto usa el del propio archivo.
 * Devuelve `{ text, eol, warnings }`; `warnings` avisa si el archivo no termina en `}` ni en `;`.
 */
export function buildSupportContent(original, filePath) {
  if (original.includes('?>')) {
    throw new Oe2DataError(`${filePath}: contiene "?>"; no se admite la línea de soporte`);
  }
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const endsWithNewline = original.length === 0 || /\r?\n$/.test(original);
  const prefix = endsWithNewline ? original : `${original}${eol}`;
  const warnings = [];
  const trimmed = original.trimEnd();
  if (trimmed.length > 0 && !/[};]$/.test(trimmed)) {
    warnings.push('el archivo no termina en "}" ni en ";"');
  }
  return { text: `${prefix}${SUPPORT_MARKER}${eol}`, eol, warnings };
}

/** Lee la lista de archivos con target de `sample.csv` (sin duplicados, rutas seguras). */
export function supportFilesFromSample(csvText) {
  const { header, rows } = parseCsv(csvText);
  if (!header.includes('filePath')) throw new Oe2DataError('sample.csv sin columna filePath');
  const files = [...new Set(rows.map((row) => assertSafeRelativePath(row.filePath)))];
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Resuelve una ruta del checkout y comprueba que queda dentro de él (sin salir por `..` ni enlaces de otro árbol). */
async function resolveInside(checkoutRoot, relativePath) {
  const target = path.resolve(checkoutRoot, relativePath);
  if (!target.startsWith(`${checkoutRoot}${path.sep}`)) throw new Oe2DataError('ruta fuera del checkout');
  let real;
  try {
    real = await realpath(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Oe2DataError(`${relativePath}: no existe en el checkout`);
    throw error;
  }
  if (!real.startsWith(`${checkoutRoot}${path.sep}`)) throw new Oe2DataError('ruta resuelta fuera del checkout');
  return target;
}

/** Subcomando `support-files`. */
export async function runSupportFiles({ options, cwd, repoRoot }) {
  const outDir = await resolveOe2OutputDir(options, { cwd, repoRoot });
  const checkoutRoot = await realpath(path.resolve(cwd, options.checkout));
  const realOut = await realpath(path.dirname(outDir)).then((parent) => path.join(parent, path.basename(outDir))).catch(() => outDir);
  if (realOut.startsWith(`${checkoutRoot}${path.sep}`) || realOut === checkoutRoot) {
    throw new Oe2DataError('--out no puede estar dentro del checkout');
  }
  const files = supportFilesFromSample((await readFile(options.sample)).toString('utf8'));

  const plan = new PackagePlan();
  const records = [];
  for (const relativePath of files) {
    const absolute = await resolveInside(checkoutRoot, relativePath);
    const before = await readFile(absolute);
    const original = before.toString('utf8');
    const { text, warnings } = buildSupportContent(original, relativePath);
    const supported = Buffer.from(text, 'utf8');
    plan.addBytes(relativePath, supported);
    const after = await readFile(absolute);
    const sha256Before = sha256Hex(before);
    const sha256After = sha256Hex(after);
    if (sha256Before !== sha256After) throw new Oe2DataError(`${relativePath}: el checkout cambió durante la copia`);
    records.push({
      filePath: relativePath,
      bytesBefore: before.length,
      bytesSupported: supported.length,
      sha256Before,
      sha256Supported: sha256Hex(supported),
      sha256After,
      unchanged: true,
      warnings,
    });
  }
  plan.addJson('support-manifest.json', {
    schemaVersion: 1,
    marker: SUPPORT_MARKER,
    checkoutName: path.basename(checkoutRoot),
    files: records,
  });
  const written = await writeOe2Package(outDir, plan, 'support-files', { supportFileCount: records.length });
  const warned = records.filter((record) => record.warnings.length > 0).length;
  return {
    exitCode: 0,
    lines: [
      `Archivos de soporte: ${records.length}. Con aviso de cierre: ${warned}.`,
      `Checkout intacto: ${records.every((record) => record.unchanged) ? 'sí' : 'no'}.`,
      `Archivos escritos: ${written.length}.`,
    ],
    outDir,
  };
}
