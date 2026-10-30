// WI-CORE-107: escritura común de los subcomandos. Reutiliza el paquete del extractor: `PackagePlan` acumula los
// archivos en memoria; `finalizePackage` añade `hashes.txt`, `manifest.json` (tamaño y SHA-256 de cada archivo) y
// `manifest.sha256`; `writePackageFiles` escribe con `wx` (no sobrescribe) y permisos restrictivos.
import { PackagePlan, finalizePackage, resolveOutputDir, writePackageFiles } from '../evidence-extractor/package.mjs';

export const OE2_TOOL = Object.freeze({ tool: 'oe2', workItem: 'WI-CORE-107', schemaVersion: 1 });

/** Valida `--out` con las reglas del extractor (vacía o inexistente, fuera del repo salvo `--allow-out-in-repo`). */
export function resolveOe2OutputDir(options, { cwd, repoRoot }) {
  return resolveOutputDir(options.out, { cwd, repoRoot, allowOutInRepo: options.allowOutInRepo === true });
}

/**
 * Cierra el paquete con su manifiesto y lo escribe en `outDir`. `extra` son campos del manifiesto (ids, recuentos,
 * parámetros); se serializan con claves ordenadas. Devuelve las rutas escritas.
 */
export async function writeOe2Package(outDir, plan, subcommand, extra = {}) {
  const entries = finalizePackage(plan, (files) => ({
    ...OE2_TOOL,
    subcommand,
    ...extra,
    files,
  }));
  await writePackageFiles(outDir, entries);
  return entries.map((entry) => entry.path);
}

export { PackagePlan };
