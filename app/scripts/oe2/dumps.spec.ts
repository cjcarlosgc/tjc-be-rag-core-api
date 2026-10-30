// WI-CORE-107: pruebas de los volcados desde base (`dump-chunks`, `dump-results`) con un doble del driver de PostgreSQL.
// Ninguna prueba toca una base real. Se comprueban la secuencia de solo lectura, el orden, la forma exacta de la
// respuesta de comparación y los errores.
import { readFile, readdir, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OE2_CODE_CHUNKS,
  OE2_COMPARISON_BY_ID,
  OE2_COMPARISON_RESULTS,
  OE2_COMPARISONS_BY_RUN,
  PROJECT_VERSION,
  approvedSqlTexts,
} from '../evidence-extractor/queries.mjs';
import { assertReadOnlySql } from '../evidence-extractor/sql-guard.mjs';
import { runDumpChunks, normalizeChunkRows } from './dump-chunks.mjs';
import { runDumpResults, buildComparisonResponse } from './dump-results.mjs';
import { parseChunksJsonl } from './io-primitives.mjs';
import { createDriverDouble, resultSet, chunk } from './fixtures.mjs';
import { Oe2ConfigError } from './db.mjs';
import { sha256Hex } from '../evidence-extractor/util.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DB_URL = 'postgresql://lector:CLAVE-DE-PRUEBA@db.invalid/dev';
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'oe2-dumps-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const PROJECT_VERSION_COLUMNS = ['projectVersionId', 'projectId', 'commitSha', 'status', 'language', 'projectName'];
const CHUNK_COLUMNS = [
  'filePath', 'symbolKind', 'symbolName', 'parentSymbolName', 'startLine', 'endLine', 'partIndex', 'partsTotal',
  'importsUsed', 'tokenCount', 'content',
];
const COMPARISON_COLUMNS = ['id', 'analysisRunId', 'projectVersionId', 'symbol', 'status', 'completedAt'];
const RESULT_COLUMNS = ['id', 'comparisonId', 'mode', 'config', 'candidates', 'metrics'];

describe('consultas OE2 en el registro de solo lectura', () => {
  it('pasan la guardia y están en la lista blanca del extractor', () => {
    for (const definition of [OE2_CODE_CHUNKS, OE2_COMPARISONS_BY_RUN, OE2_COMPARISON_BY_ID, OE2_COMPARISON_RESULTS]) {
      expect(() => assertReadOnlySql(definition.sql), definition.id).not.toThrow();
      expect(approvedSqlTexts().has(definition.sql), definition.id).toBe(true);
    }
  });
});

describe('dump-chunks', () => {
  const rows = [
    chunk({ filePath: 'src/b.php', symbolKind: 'METHOD', symbolName: 'm', parentSymbolName: 'B', content: 'function m() {}', importsUsed: ['\\X\\Y'] }),
    chunk({ filePath: 'src/a.php', symbolKind: 'FUNCTION', symbolName: 'A\\f', content: 'function f() {}', partIndex: 2, partsTotal: 2 }),
    chunk({ filePath: 'src/a.php', symbolKind: 'FUNCTION', symbolName: 'A\\f', content: 'function f() {', partIndex: 1, partsTotal: 2 }),
  ];

  function dispatchFor(chunks: unknown[]) {
    return (sql: string) => {
      if (sql === PROJECT_VERSION.sql) {
        return resultSet(PROJECT_VERSION_COLUMNS, [{
          projectVersionId: 'pv-1', projectId: 'proj-1', commitSha: 'a'.repeat(40), status: 'COMPLETED', language: 'PHP', projectName: 'demo',
        }]);
      }
      if (sql === OE2_CODE_CHUNKS.sql) {
        return resultSet(CHUNK_COLUMNS, chunks.map((item) => ({
          ...(item as object),
          importsUsed: (item as { importsUsed: string[] }).importsUsed,
          tokenCount: null,
        })));
      }
      throw new Error(`consulta inesperada en la prueba: ${sql.slice(0, 40)}`);
    };
  }

  it('usa solo la secuencia de solo lectura y escribe chunks.jsonl ordenado con su manifiesto', async () => {
    const double = createDriverDouble(dispatchFor(rows));
    const out = path.join(scratch, 'dump-chunks-1');
    const result = await runDumpChunks({
      options: { projectVersion: 'pv-1', out, allowOutInRepo: false },
      env: { DATABASE_URL: DB_URL },
      cwd: scratch,
      repoRoot: REPO_ROOT,
      openDriver: double.openDriver,
    });
    expect(result.exitCode).toBe(0);
    expect(double.log.map((entry) => entry.kind)).toEqual(['begin', 'executeRaw', 'queryRaw', 'queryRaw', 'executeRaw', 'release', 'dispose']);
    expect(double.log[1]).toMatchObject({ kind: 'executeRaw', sql: 'SET TRANSACTION READ ONLY' });
    expect(double.log.at(-3)).toMatchObject({ kind: 'executeRaw', sql: 'ROLLBACK' });

    const text = await readFile(path.join(out, 'chunks.jsonl'), 'utf8');
    const parsed = parseChunksJsonl(text);
    expect(parsed.map((item) => `${item.filePath}|${item.symbolName}|${item.partIndex}`)).toEqual([
      'src/a.php|A\\f|1', 'src/a.php|A\\f|2', 'src/b.php|m|1',
    ]);
    expect(parsed[2].importsUsed).toEqual(['\\X\\Y']);

    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      subcommand: 'dump-chunks', projectVersionId: 'pv-1', commitSha: 'a'.repeat(40), chunkCount: 3, fileCount: 2,
      chunksJsonlSha256: sha256Hex(text),
    });
    const manifestFile = manifest.files.find((file: { path: string }) => file.path === 'chunks.jsonl');
    expect(manifestFile.sha256).toBe(sha256Hex(text));
  });

  it('no escribe la URL de la base ni la contraseña en ninguna salida', async () => {
    const double = createDriverDouble(dispatchFor(rows));
    const out = path.join(scratch, 'dump-chunks-secrets');
    await runDumpChunks({
      options: { projectVersion: 'pv-1', out, allowOutInRepo: false },
      env: { DATABASE_URL: DB_URL },
      cwd: scratch,
      repoRoot: REPO_ROOT,
      openDriver: double.openDriver,
    });
    for (const name of await readdir(out)) {
      expect(await readFile(path.join(out, name), 'utf8'), name).not.toContain('CLAVE-DE-PRUEBA');
    }
  });

  it('una versión inexistente aborta', async () => {
    const double = createDriverDouble(() => resultSet(PROJECT_VERSION_COLUMNS, []));
    await expect(runDumpChunks({
      options: { projectVersion: 'nope', out: path.join(scratch, 'dump-chunks-missing'), allowOutInRepo: false },
      env: { DATABASE_URL: DB_URL },
      cwd: scratch,
      repoRoot: REPO_ROOT,
      openDriver: double.openDriver,
    })).rejects.toThrow(/no existe/);
  });

  it('sin DATABASE_URL falla con error de configuración que no imprime valores', async () => {
    await expect(runDumpChunks({
      options: { projectVersion: 'pv-1', out: path.join(scratch, 'dump-chunks-noenv'), allowOutInRepo: false },
      env: {},
      cwd: scratch,
      repoRoot: REPO_ROOT,
      openDriver: createDriverDouble(dispatchFor(rows)).openDriver,
    })).rejects.toBeInstanceOf(Oe2ConfigError);
  });

  it('normalizeChunkRows calcula contentSha256 y rechaza importsUsed con forma inesperada', () => {
    const normalized = normalizeChunkRows([{ ...rows[0], importsUsed: null }]);
    expect(normalized[0].importsUsed).toEqual([]);
    expect(normalized[0].contentSha256).toBe(sha256Hex(rows[0].content));
    expect(() => normalizeChunkRows([{ ...rows[0], importsUsed: 'x' }])).toThrow(/importsUsed/);
  });
});

describe('dump-results', () => {
  const completedAt = new Date('2026-10-26T10:00:00.000Z');
  const comparisons = [
    { id: 'cmp-1', analysisRunId: 'run-1', projectVersionId: 'pv-1', symbol: { kind: 'METHOD', qualifiedName: 'X.f', filePath: 'src/x.php', language: 'PHP', changeKind: 'ADDED' }, status: 'COMPLETED', completedAt },
    { id: 'cmp-2', analysisRunId: 'run-1', projectVersionId: 'pv-1', symbol: { kind: 'FUNCTION', qualifiedName: 'Y\\g', filePath: 'src/y.php', language: 'PHP', changeKind: 'ADDED' }, status: 'FAILED', completedAt: null },
    { id: 'cmp-3', analysisRunId: 'run-1', projectVersionId: 'pv-1', symbol: { kind: 'FUNCTION', qualifiedName: 'Z\\h', filePath: 'src/z.php', language: 'PHP', changeKind: 'ADDED' }, status: 'COMPLETED', completedAt: '2026-10-26T11:00:00.000Z' },
  ];
  const candidate = (rank: number, chunkId: string) => ({
    rank, chunkId, filePath: 'src/x.php', symbolQualifiedName: `S${rank}`, semanticScore: 0.5, structuralRelation: null,
    combinedScore: 0.35, selected: rank <= 10, extraInternal: 'no debe salir',
  });
  const modeRows = (id: string) => [
    { id: `${id}-se`, comparisonId: id, mode: 'SE', config: { semanticTopK: 20, finalTopK: 10, semanticWeight: 0.7, structuralWeight: 0.3, embeddingModel: 'm' }, candidates: [candidate(1, 'k1')], metrics: null },
    { id: `${id}-sem`, comparisonId: id, mode: 'SEM', config: { semanticTopK: 20, finalTopK: 10, semanticWeight: null, structuralWeight: null, embeddingModel: 'm' }, candidates: [candidate(1, 'k1')], metrics: null },
  ];

  const dispatch = (sql: string, args: string[]) => {
    if (sql === OE2_COMPARISONS_BY_RUN.sql) return resultSet(COMPARISON_COLUMNS, comparisons.filter((row) => row.analysisRunId === args[0]));
    if (sql === OE2_COMPARISON_BY_ID.sql) return resultSet(COMPARISON_COLUMNS, comparisons.filter((row) => row.id === args[0]));
    if (sql === OE2_COMPARISON_RESULTS.sql) return resultSet(RESULT_COLUMNS, modeRows(args[0]));
    throw new Error('consulta inesperada');
  };

  it('vuelca solo las COMPLETED con la forma de la respuesta y lista las demás como omitidas', async () => {
    const double = createDriverDouble(dispatch);
    const out = path.join(scratch, 'dump-results-run');
    const result = await runDumpResults({
      options: { analysisRun: 'run-1', out, allowOutInRepo: false },
      env: { DATABASE_URL: DB_URL },
      cwd: scratch,
      repoRoot: REPO_ROOT,
      openDriver: double.openDriver,
    });
    expect(result.exitCode).toBe(0);
    const jsonFiles = (await readdir(out)).filter((name) => name.endsWith('.json') && name !== 'manifest.json').sort();
    expect(jsonFiles).toEqual(['cmp-1.json', 'cmp-3.json']);
    const response = JSON.parse(await readFile(path.join(out, 'cmp-1.json'), 'utf8'));
    expect(Object.keys(response).sort()).toEqual(['analysisRunId', 'completedAt', 'modes', 'projectVersionId', 'retrievalComparisonId', 'symbol']);
    expect(response.modes.map((mode: { mode: string }) => mode.mode)).toEqual(['SE', 'SEM']);
    expect(Object.keys(response.modes[0]).sort()).toEqual(['candidates', 'config', 'metrics', 'mode', 'retrievalId']);
    expect(Object.keys(response.modes[0].candidates[0]).sort()).toEqual([
      'chunkId', 'combinedScore', 'filePath', 'rank', 'selected', 'semanticScore', 'structuralRelation', 'symbolQualifiedName',
    ]);
    expect(response.completedAt).toBe('2026-10-26T10:00:00.000Z');
    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
    expect(manifest.omitted).toEqual([{ retrievalComparisonId: 'cmp-2', status: 'FAILED' }]);
    expect(manifest.requestedComparisons).toBe(3);
  });

  it('una comparación por id inexistente aborta', async () => {
    const double = createDriverDouble(dispatch);
    await expect(runDumpResults({
      options: { comparisons: ['no-existe'], out: path.join(scratch, 'dump-results-missing'), allowOutInRepo: false },
      env: { DATABASE_URL: DB_URL },
      cwd: scratch,
      repoRoot: REPO_ROOT,
      openDriver: double.openDriver,
    })).rejects.toThrow(/no encontrada/);
  });

  it('una comparación COMPLETED sin exactamente SE y SEM aborta', () => {
    const rows = [modeRows('cmp-x')[0]];
    expect(() => buildComparisonResponse(comparisons[0], rows as never)).toThrow(/SE y SEM/);
  });

  it('los modos se ordenan a SE y SEM aunque lleguen en otro orden', () => {
    const response = buildComparisonResponse(comparisons[0], [...modeRows('cmp-1')].reverse() as never);
    expect(response.modes.map((mode) => mode.mode)).toEqual(['SE', 'SEM']);
  });
});
