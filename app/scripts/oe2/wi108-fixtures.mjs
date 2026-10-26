// WI-CORE-108: fixtures sintéticos compartidos por las pruebas de guía (`--guide`), roles (`--roles`), `build-gt` y
// el extremo a extremo. PHP inventado; sin base de datos ni red. Reutiliza los de WI-CORE-107 (fixtures.mjs).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSample } from './sample.mjs';
import { comparisonDocument, syntheticChunks, toJsonl } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

export const CONVERT = { filePath: 'src/Domain/Converter.php', qualifiedName: 'App\\Domain\\Converter.convert' };
export const APPLY = { filePath: 'src/Domain/Rate.php', qualifiedName: 'App\\Domain\\Rate.apply' };
export const FORMAT = { filePath: 'src/Util/format.php', qualifiedName: 'App\\Util\\format' };

/** Especificaciones de SE/SEM de los tres targets sintéticos (mismas que en `pool.spec.ts`). */
const CONVERT_SPECS = [
  { chunkId: 'c-01', filePath: 'src/Domain/Rate.php', qualifiedName: 'App\\Domain\\Rate.apply', semantic: 0.9137, structural: 'IMPORTS' },
  { chunkId: 'c-02', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money', semantic: 0.8123, structural: 'SAME_NAMESPACE' },
  { chunkId: 'c-03', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money.amount', semantic: 0.7041, structural: null },
  { chunkId: 'c-04', filePath: 'src/Other/Thing.php', qualifiedName: 'App\\Other\\Thing', semantic: null, structural: 'IMPORTS' },
  { chunkId: 'c-05', filePath: 'src/Util/format.php', qualifiedName: 'App\\Util\\format', semantic: 0.6052, structural: null },
  { chunkId: 'c-06', filePath: 'src/Domain/Converter.php', qualifiedName: 'App\\Domain\\Converter.label', semantic: 0.2019, structural: null },
  { chunkId: 'c-07', filePath: 'src/Domain/Rate.php', qualifiedName: 'App\\Domain\\Rate.apply', semantic: 0.1011, structural: null },
  { chunkId: 'c-08', filePath: 'src/Domain/Converter.php', qualifiedName: 'App\\Domain\\Converter.convert', semantic: 0.9583, structural: null },
];
const APPLY_SPECS = [
  { chunkId: 'a-01', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money.amount', semantic: 0.5, structural: null },
  { chunkId: 'a-02', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money', semantic: 0.4, structural: 'SAME_NAMESPACE' },
];
const FORMAT_SPECS = [
  { chunkId: 'f-01', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money.amount', semantic: 0.3, structural: null },
];

/** Documentos de comparación de los tres targets. `omit` quita los de los targets indicados (por nombre corto). */
export function comparisonDocuments({ omit = [] } = {}) {
  const all = [
    comparisonDocument({ id: 'cmp-convert', symbol: { kind: 'METHOD', ...CONVERT }, specs: CONVERT_SPECS }),
    comparisonDocument({ id: 'cmp-apply', symbol: { kind: 'METHOD', ...APPLY }, specs: APPLY_SPECS }),
    comparisonDocument({ id: 'cmp-format', symbol: { kind: 'FUNCTION', ...FORMAT }, specs: FORMAT_SPECS }),
  ];
  return all.filter((document) => !omit.includes(document.retrievalComparisonId));
}

/** Texto de guía de prueba: neutro (sin términos de procedencia). */
export const NEUTRAL_GUIDE = '# Guía de prueba\n\nDecide si cada candidato es relevante y registra el criterio R1…R5.\n';

/**
 * Crea un pipeline sintético en `<root>/<name>`: volcado, sample (con `sampleOptions`), resultados y guía. Devuelve
 * las rutas. `omit`: identificadores de comparación que no se escriben (para probar targets sin comparación).
 */
export async function buildWi108Pipeline(root, name, { sampleOptions = { calibration: 0, official: 3, reserve: 0 }, seed = 'semilla-108', omit = [], guideText = NEUTRAL_GUIDE } = {}) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  const dump = path.join(dir, 'chunks.jsonl');
  await writeFile(dump, toJsonl(syntheticChunks()));
  const sampleOut = path.join(dir, 'sample');
  await runSample({
    options: { dump, seed, ...sampleOptions, repo: 'money', out: sampleOut, allowOutInRepo: false },
    cwd: dir,
    repoRoot: REPO_ROOT,
  });
  const results = path.join(dir, 'results');
  await mkdir(results, { recursive: true });
  for (const document of comparisonDocuments({ omit })) {
    await writeFile(path.join(results, `${document.retrievalComparisonId}.json`), JSON.stringify(document));
  }
  const guide = path.join(dir, 'GUIA.md');
  await writeFile(guide, guideText);
  return { dir, dump, sample: path.join(sampleOut, 'sample.csv'), results, guide };
}

/** Lee un archivo como texto UTF-8. */
export async function readUtf8(file) {
  return (await readFile(file)).toString('utf8');
}
