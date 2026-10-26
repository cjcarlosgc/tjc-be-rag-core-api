// WI-CORE-107: listado de archivos JSON de una carpeta de volcados (sin `manifest.json`), en orden de nombre.
import { readdir } from 'node:fs/promises';
import { Oe2DataError } from './io-primitives.mjs';

/** Nombres de los `.json` de una carpeta, ordenados por unidades de código. Ignora `manifest.json`. */
export async function listJsonFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new Oe2DataError('la carpeta de resultados no existe o no se puede leer');
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'manifest.json')
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
