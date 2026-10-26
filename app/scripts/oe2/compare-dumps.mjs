// WI-CORE-107: subcomando `compare-dumps`. Compara dos volcados de chunks por (filePath, symbolKind, symbolName,
// parentSymbolName, partIndex) y contentSha256. Sirve para comprobar que el PR de soporte no cambió ningún chunk.
// Un mismo identificador repetido en un volcado se compara por ocurrencia (orden estable por contentSha256).
import path from 'node:path';
import { compareCodeUnits, readChunksFile } from './io-primitives.mjs';
import { PackagePlan, resolveOe2OutputDir, writeOe2Package } from './output.mjs';

const LIST_LIMIT = 50;

/** Clave de identidad de un chunk del volcado, incluida la ocurrencia dentro de su grupo. */
function keyEntries(chunks) {
  const groups = new Map();
  for (const chunk of chunks) {
    const base = JSON.stringify([chunk.filePath, chunk.symbolKind, chunk.symbolName, chunk.parentSymbolName, chunk.partIndex]);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(chunk);
  }
  const entries = new Map();
  for (const [base, list] of groups) {
    list.sort((a, b) => compareCodeUnits(a.contentSha256, b.contentSha256));
    list.forEach((chunk, occurrence) => {
      entries.set(`${base}#${occurrence}`, chunk);
    });
  }
  return entries;
}

/**
 * Compara dos listas de chunks. Devuelve recuentos y listas de iguales, distintos, solo en A y solo en B (identidad y
 * hash). `identical` es true solo si no hay diferencias de ningún tipo.
 */
export function compareChunkSets(chunksA, chunksB) {
  const a = keyEntries(chunksA);
  const b = keyEntries(chunksB);
  const equal = [];
  const different = [];
  const onlyA = [];
  const onlyB = [];
  for (const [key, chunk] of a) {
    if (!b.has(key)) {
      onlyA.push(key);
      continue;
    }
    const other = b.get(key);
    if (other.contentSha256 === chunk.contentSha256) equal.push(key);
    else different.push({ key, sha256A: chunk.contentSha256, sha256B: other.contentSha256 });
  }
  for (const key of b.keys()) {
    if (!a.has(key)) onlyB.push(key);
  }
  const sort = (list) => [...list].sort(compareCodeUnits);
  const sortedDifferent = [...different].sort((x, y) => compareCodeUnits(x.key, y.key));
  return {
    identical: onlyA.length === 0 && onlyB.length === 0 && sortedDifferent.length === 0,
    counts: {
      chunksA: chunksA.length,
      chunksB: chunksB.length,
      equal: equal.length,
      different: different.length,
      onlyA: onlyA.length,
      onlyB: onlyB.length,
    },
    equal: sort(equal),
    different: sortedDifferent,
    onlyA: sort(onlyA),
    onlyB: sort(onlyB),
  };
}

/** Subcomando `compare-dumps`. Sale con 1 si hay diferencias; `--out` es opcional. */
export async function runCompareDumps({ options, cwd, repoRoot }) {
  const outDir = options.out ? await resolveOe2OutputDir(options, { cwd, repoRoot }) : null;
  const first = await readChunksFile(options.a);
  const second = await readChunksFile(options.b);
  const result = compareChunkSets(first.chunks, second.chunks);
  const lines = [
    `Chunks A: ${result.counts.chunksA}; B: ${result.counts.chunksB}.`,
    `Iguales: ${result.counts.equal}. Distintos: ${result.counts.different}. Solo en A: ${result.counts.onlyA}. Solo en B: ${result.counts.onlyB}.`,
    result.identical ? 'Resultado: los volúmenes son idénticos.' : 'Resultado: hay diferencias.',
  ];
  for (const key of result.onlyA.slice(0, LIST_LIMIT)) lines.push(`solo en A: ${key}`);
  for (const key of result.onlyB.slice(0, LIST_LIMIT)) lines.push(`solo en B: ${key}`);
  for (const difference of result.different.slice(0, LIST_LIMIT)) lines.push(`distinto: ${difference.key}`);

  if (outDir !== null) {
    const plan = new PackagePlan();
    plan.addJson('comparacion.json', {
      schemaVersion: 1,
      a: path.basename(options.a),
      aSha256: first.sha256,
      b: path.basename(options.b),
      bSha256: second.sha256,
      ...result,
    });
    await writeOe2Package(outDir, plan, 'compare-dumps', { identical: result.identical });
  }
  return { exitCode: result.identical ? 0 : 1, lines, outDir };
}
