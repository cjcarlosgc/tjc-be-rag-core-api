// WI-CORE-107: pruebas del subcomando `score` con valores calculados a mano sobre fixtures sintéticos.
// Casos: P@k y R@k con k fijo, hits distintos con símbolo en varias partes, menos de 10 candidatos, GT ausente o vacía
// (NA), hash de GT incorrecto, incongruencia de re-ranking, sensibilidad al desempate y calibración no reportable.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSample } from './sample.mjs';
import { parseGroundTruth, reorderSeByFileAndName, runScore, checkCongruence } from './score.mjs';
import { parseCsv } from './io-primitives.mjs';
import { comparisonDocument, syntheticChunks, toJsonl } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..');
let scratch: string;

const CONVERT = { filePath: 'src/Domain/Converter.php', qualifiedName: 'App\\Domain\\Converter.convert' };
const APPLY = { filePath: 'src/Domain/Rate.php', qualifiedName: 'App\\Domain\\Rate.apply' };
const FORMAT = { filePath: 'src/Util/format.php', qualifiedName: 'App\\Util\\format' };

/** SE/SEM de `convert`: A (dos partes, con G) B C D E F. Con el combinado de la fórmula, SE queda A B C E D F G. */
const CONVERT_SPECS = [
  { chunkId: 'k-a', filePath: 'src/Domain/Rate.php', qualifiedName: 'App\\Domain\\Rate.apply', semantic: 0.9, structural: 'IMPORTS' },
  { chunkId: 'k-b', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money', semantic: 0.8, structural: 'SAME_NAMESPACE' },
  { chunkId: 'k-c', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money.amount', semantic: 0.7, structural: null },
  { chunkId: 'k-d', filePath: 'src/Other/Thing.php', qualifiedName: 'App\\Other\\Thing', semantic: null, structural: 'IMPORTS' },
  { chunkId: 'k-e', filePath: 'src/Util/format.php', qualifiedName: 'App\\Util\\format', semantic: 0.6, structural: null },
  { chunkId: 'k-f', filePath: 'src/Domain/Converter.php', qualifiedName: 'App\\Domain\\Converter.label', semantic: 0.2, structural: null },
  { chunkId: 'k-g', filePath: 'src/Domain/Rate.php', qualifiedName: 'App\\Domain\\Rate.apply', semantic: 0.1, structural: null },
];
const APPLY_SPECS = [
  { chunkId: 'p-a', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money.amount', semantic: 0.5, structural: null },
];
const FORMAT_SPECS = [
  { chunkId: 'q-a', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money.amount', semantic: 0.3, structural: null },
];

const GT_FULL = {
  [`${CONVERT.filePath}::${CONVERT.qualifiedName}`]: [
    { filePath: 'src/Domain/Rate.php', symbolQualifiedName: 'App\\Domain\\Rate.apply' },
    { filePath: 'src/Other/Thing.php', symbolQualifiedName: 'App\\Other\\Thing' },
    { filePath: 'src/Util/total.php', symbolQualifiedName: 'App\\Util\\total' },
  ],
  [`${FORMAT.filePath}::${FORMAT.qualifiedName}`]: [],
};

async function writeGt(name: string, gt: unknown) {
  const file = path.join(scratch, name);
  const bytes = Buffer.from(JSON.stringify(gt, null, 2));
  await writeFile(file, bytes);
  return { file, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function buildScorePipeline(name: string, sampleOptions = { calibration: 0, official: 3, reserve: 0 }) {
  const dir = path.join(scratch, name);
  await mkdir(dir, { recursive: true });
  const dump = path.join(dir, 'chunks.jsonl');
  await writeFile(dump, toJsonl(syntheticChunks()));
  const sampleOut = path.join(dir, 'sample');
  await runSample({
    options: { dump, seed: 'muestra-score', ...sampleOptions, repo: 'money', out: sampleOut, allowOutInRepo: false },
    cwd: dir,
    repoRoot: REPO_ROOT,
  });
  const results = path.join(dir, 'results');
  await mkdir(results, { recursive: true });
  const documents = [
    comparisonDocument({ id: 'cmp-convert', symbol: { kind: 'METHOD', ...CONVERT }, specs: CONVERT_SPECS }),
    comparisonDocument({ id: 'cmp-apply', symbol: { kind: 'METHOD', ...APPLY }, specs: APPLY_SPECS }),
    comparisonDocument({ id: 'cmp-format', symbol: { kind: 'FUNCTION', ...FORMAT }, specs: FORMAT_SPECS }),
  ];
  for (const document of documents) {
    await writeFile(path.join(results, `${document.retrievalComparisonId}.json`), JSON.stringify(document));
  }
  return { dir, sample: path.join(sampleOut, 'sample.csv'), results };
}

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'oe2-score-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('parseGroundTruth', () => {
  it('acepta el formato de la especificación y rechaza formas inválidas', () => {
    const gt = parseGroundTruth(JSON.stringify(GT_FULL));
    expect(gt.get(`${CONVERT.filePath}::${CONVERT.qualifiedName}`)).toHaveLength(3);
    expect(() => parseGroundTruth('[]')).toThrow(/objeto/);
    expect(() => parseGroundTruth('{"sin-separador": []}')).toThrow(/archivo::nombre/);
    expect(() => parseGroundTruth('{"a.php::X": {}}')).toThrow(/lista/);
    expect(() => parseGroundTruth('{"a.php::X": [{"filePath": 1}]}')).toThrow(/mal formado/);
    expect(() => parseGroundTruth('no json')).toThrow(/JSON/);
  });
});

describe('sensibilidad al desempate (reorderSeByFileAndName)', () => {
  it('reordena empates de score por (filePath, symbolQualifiedName) y el rank original como último criterio', () => {
    const persisted = [
      { rank: 1, filePath: 'z.php', symbolQualifiedName: 'Z', combinedScore: 0.5, semanticScore: 0.3 },
      { rank: 2, filePath: 'a.php', symbolQualifiedName: 'A', combinedScore: 0.5, semanticScore: 0.3 },
      { rank: 3, filePath: 'b.php', symbolQualifiedName: 'B', combinedScore: 0.6, semanticScore: 0.4 },
      { rank: 4, filePath: 'a.php', symbolQualifiedName: 'A', combinedScore: 0.5, semanticScore: 0.3 },
    ];
    expect(reorderSeByFileAndName(persisted)).toEqual([
      { rank: 1, filePath: 'b.php', symbolQualifiedName: 'B' },
      { rank: 2, filePath: 'a.php', symbolQualifiedName: 'A' },
      { rank: 3, filePath: 'a.php', symbolQualifiedName: 'A' },
      { rank: 4, filePath: 'z.php', symbolQualifiedName: 'Z' },
    ]);
  });
});

describe('congruencia de re-ranking', () => {
  it('no encuentra incongruencias en una comparación coherente', () => {
    const document = comparisonDocument({ id: 'x', symbol: { kind: 'METHOD', ...CONVERT }, specs: CONVERT_SPECS });
    const modes = new Map(document.modes.map((mode) => [mode.mode, mode]));
    expect(checkCongruence(modes, 'x')).toEqual([]);
  });

  it('detecta un rank alterado frente a las puntuaciones persistidas', () => {
    const document = comparisonDocument({ id: 'x', symbol: { kind: 'METHOD', ...CONVERT }, specs: CONVERT_SPECS });
    const se = document.modes[0].candidates;
    [se[0].rank, se[1].rank] = [se[1].rank, se[0].rank];
    const modes = new Map(document.modes.map((mode) => [mode.mode, mode]));
    expect(checkCongruence(modes, 'x').length).toBeGreaterThan(0);
  });
});

describe('runScore: métricas', () => {
  it('P@k y R@k con k fijo, hits distintos y deltas SE menos SEM, con valores calculados a mano', async () => {
    const pipeline = await buildScorePipeline('metrics');
    const gt = await writeGt('gt-metrics.json', GT_FULL);
    const out = path.join(pipeline.dir, 'out');
    const result = await runScore({
      options: { results: pipeline.results, gt: gt.file, gtSha256: gt.sha256, sample: pipeline.sample, includeCalibration: false, out },
      cwd: pipeline.dir,
      repoRoot: REPO_ROOT,
    });
    expect(result.exitCode).toBe(0);
    const rows = parseCsv(await readFile(path.join(out, 'metrics-per-target.csv'), 'utf8')).rows;
    const convert = rows.find((row) => row.targetId.endsWith('App\\Domain\\Converter.convert'));
    expect(convert?.estado).toBe('puntuado');
    expect(Number(convert?.SE_P5)).toBeCloseTo(0.4, 12);
    expect(Number(convert?.SE_R5)).toBeCloseTo(2 / 3, 12);
    expect(Number(convert?.SE_P10)).toBeCloseTo(0.2, 12);
    expect(Number(convert?.SE_R10)).toBeCloseTo(2 / 3, 12);
    expect(Number(convert?.SEM_P5)).toBeCloseTo(0.2, 12);
    expect(Number(convert?.SEM_R5)).toBeCloseTo(1 / 3, 12);
    expect(Number(convert?.SEM_P10)).toBeCloseTo(0.1, 12);
    expect(Number(convert?.SEM_R10)).toBeCloseTo(1 / 3, 12);
    expect(Number(convert?.dP5)).toBeCloseTo(0.2, 12);
    expect(Number(convert?.dR5)).toBeCloseTo(1 / 3, 12);
    expect(Number(convert?.dP10)).toBeCloseTo(0.1, 12);
    expect(Number(convert?.dR10)).toBeCloseTo(1 / 3, 12);
    expect(convert?.gtSize).toBe('3');
  });

  it('un target sin GT o con GT vacía se lista como NA y no se puntúa', async () => {
    const pipeline = await buildScorePipeline('na');
    const gt = await writeGt('gt-na.json', { [`${CONVERT.filePath}::${CONVERT.qualifiedName}`]: GT_FULL[`${CONVERT.filePath}::${CONVERT.qualifiedName}`] });
    const out = path.join(pipeline.dir, 'out');
    await runScore({
      options: { results: pipeline.results, gt: gt.file, gtSha256: gt.sha256, sample: pipeline.sample, includeCalibration: false, out },
      cwd: pipeline.dir,
      repoRoot: REPO_ROOT,
    });
    const rows = parseCsv(await readFile(path.join(out, 'metrics-per-target.csv'), 'utf8')).rows;
    const apply = rows.find((row) => row.targetId.endsWith('App\\Domain\\Rate.apply'));
    const format = rows.find((row) => row.targetId.endsWith('App\\Util\\format'));
    expect(apply?.estado).toBe('NA');
    expect(apply?.SE_P10).toBe('NA');
    expect(format?.estado).toBe('NA');
    const scores = JSON.parse(await readFile(path.join(out, 'scores.json'), 'utf8'));
    expect(scores.summary.scored).toBe(1);
    expect(scores.summary.na).toBe(2);
  });

  it('la sensibilidad se reporta por target y su delta es la diferencia con SE persistido', async () => {
    const pipeline = await buildScorePipeline('sensitivity');
    const gt = await writeGt('gt-sens.json', GT_FULL);
    const out = path.join(pipeline.dir, 'out');
    await runScore({
      options: { results: pipeline.results, gt: gt.file, gtSha256: gt.sha256, sample: pipeline.sample, includeCalibration: false, out },
      cwd: pipeline.dir,
      repoRoot: REPO_ROOT,
    });
    const rows = parseCsv(await readFile(path.join(out, 'metrics-per-target.csv'), 'utf8')).rows;
    const convert = rows.find((row) => row.targetId.endsWith('App\\Domain\\Converter.convert'));
    expect(Number(convert?.sensDelta_P5)).toBeCloseTo(Number(convert?.sens_SE_P5) - Number(convert?.SE_P5), 12);
    expect(Number(convert?.sensDelta_P10)).toBeCloseTo(Number(convert?.sens_SE_P10) - Number(convert?.SE_P10), 12);
  });

  it('un hash de GT distinto aborta sin escribir salida', async () => {
    const pipeline = await buildScorePipeline('bad-hash');
    const gt = await writeGt('gt-bad.json', GT_FULL);
    const out = path.join(pipeline.dir, 'out');
    await expect(runScore({
      options: { results: pipeline.results, gt: gt.file, gtSha256: '0'.repeat(64), sample: pipeline.sample, includeCalibration: false, out },
      cwd: pipeline.dir,
      repoRoot: REPO_ROOT,
    })).rejects.toThrow(/SHA-256 de la GT no coincide/);
    await expect(readdir(out)).rejects.toThrow();
  });

  it('una GT con un target fuera del sample aborta', async () => {
    const pipeline = await buildScorePipeline('extra-target');
    const gt = await writeGt('gt-extra.json', { 'src/x.php::X.y': [] });
    await expect(runScore({
      options: { results: pipeline.results, gt: gt.file, gtSha256: gt.sha256, sample: pipeline.sample, includeCalibration: false, out: path.join(pipeline.dir, 'o') },
      cwd: pipeline.dir,
      repoRoot: REPO_ROOT,
    })).rejects.toThrow(/no está en el sample/);
  });

  it('una incongruencia de re-ranking aborta con código de error', async () => {
    const pipeline = await buildScorePipeline('incongruent');
    const file = path.join(pipeline.results, 'cmp-convert.json');
    const document = JSON.parse(await readFile(file, 'utf8'));
    const se = document.modes[0].candidates;
    [se[0].rank, se[1].rank] = [se[1].rank, se[0].rank];
    await writeFile(file, JSON.stringify(document));
    const gt = await writeGt('gt-inc.json', GT_FULL);
    await expect(runScore({
      options: { results: pipeline.results, gt: gt.file, gtSha256: gt.sha256, sample: pipeline.sample, includeCalibration: false, out: path.join(pipeline.dir, 'o') },
      cwd: pipeline.dir,
      repoRoot: REPO_ROOT,
    })).rejects.toThrow(/incongruencia/);
  });
});

describe('runScore: calibración y reserva separadas', () => {
  it('sin --include-calibration no escribe el archivo no reportable', async () => {
    const pipeline = await buildScorePipeline('no-cal', { calibration: 1, official: 2, reserve: 0 });
    const gt = await writeGt('gt-nocal.json', GT_FULL);
    const out = path.join(pipeline.dir, 'out');
    await runScore({
      options: { results: pipeline.results, gt: gt.file, gtSha256: gt.sha256, sample: pipeline.sample, includeCalibration: false, out },
      cwd: pipeline.dir,
      repoRoot: REPO_ROOT,
    });
    expect((await readdir(out))).not.toContain('metrics-calibracion-reserva-NO-REPORTABLE.csv');
  });

  it('con --include-calibration escribe las no reportables marcadas, aparte', async () => {
    const pipeline = await buildScorePipeline('cal', { calibration: 1, official: 2, reserve: 0 });
    const gt = await writeGt('gt-cal.json', GT_FULL);
    const out = path.join(pipeline.dir, 'out');
    await runScore({
      options: { results: pipeline.results, gt: gt.file, gtSha256: gt.sha256, sample: pipeline.sample, includeCalibration: true, out },
      cwd: pipeline.dir,
      repoRoot: REPO_ROOT,
    });
    const reportable = parseCsv(await readFile(path.join(out, 'metrics-per-target.csv'), 'utf8')).rows;
    const noReportable = parseCsv(await readFile(path.join(out, 'metrics-calibracion-reserva-NO-REPORTABLE.csv'), 'utf8')).rows;
    expect(reportable.every((row) => row.role === 'oficial')).toBe(true);
    expect(noReportable).toHaveLength(1);
    expect(noReportable[0].uso).toMatch(/NO REPORTABLE/);
    expect(noReportable[0].role).not.toBe('oficial');
    // B-1: la calibración y la reserva no aparecen en scores.json (solo en el CSV aparte).
    const scores = JSON.parse(await readFile(path.join(out, 'scores.json'), 'utf8'));
    expect(scores).not.toHaveProperty('noReportable');
    expect(JSON.stringify(scores)).not.toContain(noReportable[0].targetId);
  });
});
