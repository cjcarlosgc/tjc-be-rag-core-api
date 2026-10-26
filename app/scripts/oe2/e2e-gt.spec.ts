// WI-CORE-108: extremo a extremo sobre fixtures sintéticos: `pool` (con --guide) → plantilla adjudicada (rellenada en
// la prueba, con variantes de escritura) → `build-gt` → `score`, que debe aceptar el gt.json con su --gt-sha256.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toCsv } from '../evidence-extractor/util.mjs';
import { parseCsv } from './io-primitives.mjs';
import { TEMPLATE_COLUMNS, runPool } from './pool.mjs';
import { runBuildGt } from './build-gt.mjs';
import { runScore } from './score.mjs';
import { APPLY, CONVERT, FORMAT, REPO_ROOT, buildWi108Pipeline, readUtf8 } from './wi108-fixtures.mjs';

const RELEVANT_NAMES = new Set(['App\\Domain\\Rate.apply', 'App\\Other\\Thing', 'App\\Domain\\Money']);
const id = (target: { filePath: string; qualifiedName: string }) => `${target.filePath}::${target.qualifiedName}`;
const CONVERT_ID = id(CONVERT);
const APPLY_ID = id(APPLY);
const FORMAT_ID = id(FORMAT);
let pipelineDir: string;

interface KeyCandidate { qualifiedName: string }
interface KeyTarget { candidates: Record<string, KeyCandidate> }

describe('extremo a extremo: pool → plantilla → build-gt → score', () => {
  beforeAll(async () => {
    pipelineDir = await mkdtemp(path.join(os.tmpdir(), 'oe2-e2e-'));
  });

  afterAll(async () => {
    await rm(pipelineDir, { recursive: true, force: true });
  });

  it('el GT construido por build-gt es aceptado por score con su --gt-sha256 y produce la puntuación esperada', async () => {
    const p = await buildWi108Pipeline(pipelineDir, 'e2e', { sampleOptions: { calibration: 0, official: 3, reserve: 0 }, seed: 'e2e-108' });
    const poolDir = path.join(p.dir, 'pool');
    await runPool({ options: { dump: p.dump, sample: p.sample, results: p.results, seed: 'e2e-108', maxChars: 6000, guide: p.guide, out: poolDir, allowOutInRepo: false, roles: null }, cwd: p.dir, repoRoot: REPO_ROOT });

    // Rellena la plantilla como lo haría un anotador: decisiones con variantes de escritura ("  RELEVANTE ").
    const keyJson = JSON.parse(await readUtf8(path.join(poolDir, 'clave', 'key.json'))) as { targets: Record<string, KeyTarget> };
    const nameOf = new Map<string, string>();
    for (const target of Object.values(keyJson.targets)) {
      for (const [candidateId, candidate] of Object.entries(target.candidates)) nameOf.set(candidateId, candidate.qualifiedName);
    }
    const rows = parseCsv(await readUtf8(path.join(poolDir, 'ciego', 'annotation-template.csv'))).rows;
    const filled = rows.map((row) => {
      const relevant = row.target_id !== FORMAT_ID && RELEVANT_NAMES.has(nameOf.get(row.candidate_id) ?? '');
      return {
        ...row,
        adjudicacion: relevant ? '  RELEVANTE ' : 'no relevante',
        adjudicacion_criterio: relevant ? 'R1' : '',
      };
    });
    const templatePath = path.join(p.dir, 'adjudicada.csv');
    await writeFile(templatePath, toCsv(TEMPLATE_COLUMNS, filled));

    const gtDir = path.join(p.dir, 'gt');
    const built = await runBuildGt({
      options: { template: templatePath, key: path.join(poolDir, 'clave', 'key.json'), sample: p.sample, sheets: path.join(poolDir, 'ciego', 'hojas'), roles: ['oficial'], out: gtDir, allowOutInRepo: false },
      cwd: p.dir,
      repoRoot: REPO_ROOT,
    });
    expect(built.exitCode).toBe(0);
    expect(built.lines.join('\n')).toContain('Hojas verificadas contra la llave: 3');

    const gtPath = path.join(gtDir, 'gt.json');
    const gtBytes = await readFile(gtPath);
    const gtSha = createHash('sha256').update(gtBytes).digest('hex');
    expect((await readUtf8(path.join(gtDir, 'gt.sha256'))).split(/\s+/)[0]).toBe(gtSha);

    const gt = JSON.parse(gtBytes.toString('utf8')) as Record<string, Array<{ filePath: string; symbolQualifiedName: string }>>;
    expect(Object.keys(gt).sort()).toEqual([CONVERT_ID, APPLY_ID, FORMAT_ID].sort());
    expect(gt[FORMAT_ID]).toEqual([]);
    // La GT de convert contiene exactamente los candidatos marcados como relevantes en la plantilla.
    const expectedConvert = rows
      .filter((row) => row.target_id === CONVERT_ID && RELEVANT_NAMES.has(nameOf.get(row.candidate_id) ?? ''))
      .map((row) => nameOf.get(row.candidate_id) ?? '')
      .sort();
    expect(gt[CONVERT_ID].map((item) => item.symbolQualifiedName).sort()).toEqual(expectedConvert);

    const scoreDir = path.join(p.dir, 'score');
    const scored = await runScore({
      options: { results: p.results, gt: gtPath, gtSha256: gtSha, sample: p.sample, includeCalibration: false, roles: null, out: scoreDir, allowOutInRepo: false },
      cwd: p.dir,
      repoRoot: REPO_ROOT,
    });
    expect(scored.exitCode).toBe(0);
    const scores = JSON.parse(await readUtf8(path.join(scoreDir, 'scores.json'))) as {
      gtSha256: string;
      official: Array<{ targetId: string; estado: string; gtSize: number }>;
    };
    expect(scores.gtSha256).toBe(gtSha);
    expect(scores.official).toHaveLength(3);
    expect(scores.official.find((row) => row.targetId === FORMAT_ID)).toMatchObject({ estado: 'NA', gtSize: 0 });
    expect(scores.official.find((row) => row.targetId === CONVERT_ID)).toMatchObject({ estado: 'puntuado', gtSize: expectedConvert.length });

    // M-1: una llave de OTRA ejecución de pool (otra semilla, mismos ids) con la plantilla y las hojas de esta no pasa.
    const otherDir = path.join(p.dir, 'pool-otra-semilla');
    await runPool({ options: { dump: p.dump, sample: p.sample, results: p.results, seed: 'otra-semilla-108', maxChars: 6000, guide: p.guide, out: otherDir, allowOutInRepo: false, roles: null }, cwd: p.dir, repoRoot: REPO_ROOT });
    await expect(runBuildGt({
      options: { template: templatePath, key: path.join(otherDir, 'clave', 'key.json'), sample: p.sample, sheets: path.join(poolDir, 'ciego', 'hojas'), roles: ['oficial'], out: path.join(p.dir, 'gt-otra'), allowOutInRepo: false },
      cwd: p.dir,
      repoRoot: REPO_ROOT,
    })).rejects.toThrow(/la hoja muestra/);
    expect((await readFile(path.join(otherDir, 'clave', 'key.json'), 'utf8')) === (await readFile(path.join(poolDir, 'clave', 'key.json'), 'utf8'))).toBe(false);

    // Un GT alterado después de construirlo no se puntúa con el hash anterior.
    await writeFile(gtPath, `${gtBytes.toString('utf8')} `);
    await expect(runScore({
      options: { results: p.results, gt: gtPath, gtSha256: gtSha, sample: p.sample, includeCalibration: false, roles: null, out: path.join(p.dir, 'score-bad'), allowOutInRepo: false },
      cwd: p.dir,
      repoRoot: REPO_ROOT,
    })).rejects.toThrow(/SHA-256/);
  });
});
