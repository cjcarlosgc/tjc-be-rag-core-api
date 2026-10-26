// WI-CORE-107: subcomando `dump-chunks`. Vuelca los chunks de una ProjectVersion a `chunks.jsonl` (una línea por chunk,
// claves ordenadas, orden determinista en JavaScript) con su `contentSha256`. Solo lectura de la base.
import { PROJECT_VERSION, OE2_CODE_CHUNKS } from '../evidence-extractor/queries.mjs';
import { canonicalJson, sha256Hex } from '../evidence-extractor/util.mjs';
import { Oe2DataError, compareCodeUnits } from './io-primitives.mjs';
import { readOnlySession, toTextArray } from './db.mjs';
import { PackagePlan, resolveOe2OutputDir, writeOe2Package } from './output.mjs';

/** Orden de `chunks.jsonl`: ruta, tipo, nombre, padre, parte, línea de inicio y hash (desempate estable). */
export function compareChunks(a, b) {
  return compareCodeUnits(a.filePath, b.filePath)
    || compareCodeUnits(a.symbolKind, b.symbolKind)
    || compareCodeUnits(a.symbolName ?? '', b.symbolName ?? '')
    || compareCodeUnits(a.parentSymbolName ?? '', b.parentSymbolName ?? '')
    || a.partIndex - b.partIndex
    || a.startLine - b.startLine
    || compareCodeUnits(a.contentSha256, b.contentSha256);
}

/** Convierte las filas de la base en los objetos del volcado (campos de la especificación, con hash del contenido). */
export function normalizeChunkRows(rows) {
  return rows.map((row) => ({
    filePath: row.filePath,
    symbolKind: row.symbolKind,
    symbolName: row.symbolName ?? null,
    parentSymbolName: row.parentSymbolName ?? null,
    startLine: row.startLine,
    endLine: row.endLine,
    partIndex: row.partIndex,
    partsTotal: row.partsTotal,
    importsUsed: toTextArray(row.importsUsed, 'importsUsed'),
    tokenCount: row.tokenCount ?? null,
    contentSha256: sha256Hex(row.content ?? ''),
    content: row.content ?? '',
  })).sort(compareChunks);
}

/** Subcomando `dump-chunks`. */
export async function runDumpChunks({ options, env, cwd, repoRoot, openDriver }) {
  const outDir = await resolveOe2OutputDir(options, { cwd, repoRoot });
  const data = await readOnlySession({
    openDriver,
    env,
    work: async (session) => {
      const [version] = await session.query(PROJECT_VERSION, [options.projectVersion]);
      if (!version) throw new Oe2DataError('la versión de proyecto indicada no existe');
      const rows = await session.query(OE2_CODE_CHUNKS, [options.projectVersion]);
      return { version, rows };
    },
  });
  const chunks = normalizeChunkRows(data.rows);
  const text = chunks.map((chunk) => `${canonicalJson(chunk)}\n`).join('');
  const kinds = {};
  for (const chunk of chunks) kinds[chunk.symbolKind] = (kinds[chunk.symbolKind] ?? 0) + 1;

  const plan = new PackagePlan();
  plan.addText('chunks.jsonl', text);
  const written = await writeOe2Package(outDir, plan, 'dump-chunks', {
    projectVersionId: data.version.projectVersionId,
    projectId: data.version.projectId,
    projectName: data.version.projectName,
    commitSha: data.version.commitSha,
    projectVersionStatus: data.version.status,
    language: data.version.language,
    chunkCount: chunks.length,
    fileCount: new Set(chunks.map((chunk) => chunk.filePath)).size,
    symbolKindCounts: kinds,
    chunksJsonlSha256: sha256Hex(text),
  });
  return {
    exitCode: 0,
    lines: [`Chunks volcados: ${chunks.length}. Archivos de salida: ${written.length}.`],
    outDir,
  };
}
