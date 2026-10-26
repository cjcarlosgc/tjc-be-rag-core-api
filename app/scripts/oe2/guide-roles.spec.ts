// WI-CORE-108: pruebas de `pool --guide` (copia de bytes, puntero neutro en la hoja, ceguera, uso incorrecto),
// de `--roles` en `pool` y `score` (filtro, numeración, llave y plantilla coherentes, errores de uso) y de los
// avisos de términos de procedencia en la guía. Fixtures sintéticos; sin base de datos.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseOe2Arguments } from './args.mjs';
import { UsageError } from '../evidence-extractor/options.mjs';
import { guideBlindTerms, runPool } from './pool.mjs';
import { runScore } from './score.mjs';
import { parseCsv } from './io-primitives.mjs';
import { runCli } from '../oe2.mjs';
import { APPLY, CONVERT, FORMAT, NEUTRAL_GUIDE, REPO_ROOT, buildWi108Pipeline, readUtf8 } from './wi108-fixtures.mjs';

let scratch: string;

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const TOKENS = /\bSEM?\b|\brank\b|\bscore\b|origen|relaci[oó]n|estructural|structural|semantic|combined|IMPORTS|IMPORTED_BY|SAME_NAMESPACE|FULLY_QUALIFIED|DECLARING|seleccionad|selected/i;
const NUMBERS = ['0.9137', '0.8123', '0.7041', '0.6052', '0.2019', '0.1011', '0.9583', '0.5', '0.4', '0.3'];
const CMP_BY_TARGET: Record<string, string> = {
  [`${CONVERT.filePath}::${CONVERT.qualifiedName}`]: 'cmp-convert',
  [`${APPLY.filePath}::${APPLY.qualifiedName}`]: 'cmp-apply',
  [`${FORMAT.filePath}::${FORMAT.qualifiedName}`]: 'cmp-format',
};

interface Pipeline { dir: string; dump: string; sample: string; results: string; guide: string }

function poolOpts(p: Pipeline, out: string, extra: Record<string, unknown> = {}) {
  return { dump: p.dump, sample: p.sample, results: p.results, seed: 'semilla-108', maxChars: 6000, guide: p.guide, out, allowOutInRepo: false, roles: null, ...extra };
}

async function sampleTargets(p: Pipeline) {
  const rows = parseCsv(await readUtf8(p.sample)).rows;
  return rows.map((row) => ({ role: row.role, order: Number(row.order), targetId: `${row.filePath}::${row.qualifiedName}` }));
}

async function sheetTargets(out: string) {
  const names = (await readdir(path.join(out, 'ciego', 'hojas'))).sort();
  const texts = await Promise.all(names.map((name) => readUtf8(path.join(out, 'ciego', 'hojas', name))));
  return texts.map((text) => /^Target: (.+)$/m.exec(text)?.[1] ?? null);
}

function streams() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: { write: (text: string) => out.push(text) },
    stderr: { write: (text: string) => err.push(text) },
  };
}

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'oe2-wi108-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('pool --guide: copia de bytes y puntero neutro', () => {
  it('copia la guía byte a byte (CRLF y bytes no UTF-8) y registra SHA-256 y tamaño en el manifiesto', async () => {
    const bytes = Buffer.concat([Buffer.from('# Guía\r\n'), Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28]), Buffer.from('\r\nR1\r\n')]);
    const guideBin = path.join(scratch, 'guia-binaria.md');
    await writeFile(guideBin, bytes);
    const p = await buildWi108Pipeline(scratch, 'guide-bytes');
    const out = path.join(p.dir, 'pool');
    await runPool({ options: poolOpts(p, out, { guide: guideBin }), cwd: p.dir, repoRoot: REPO_ROOT });

    expect((await readFile(path.join(out, 'ciego', 'GUIA.md'))).equals(bytes)).toBe(true);
    const manifest = JSON.parse(await readUtf8(path.join(out, 'manifest.json')));
    expect(manifest.guide).toEqual({ path: 'ciego/GUIA.md', sha256: sha(bytes), bytes: bytes.length });
    expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'ciego/GUIA.md', sha256: sha(bytes), bytes: bytes.length })]));
  });

  it('la hoja usa el puntero neutro con el SHA-256 de la guía y no contiene la frase antigua', async () => {
    const p = await buildWi108Pipeline(scratch, 'guide-pointer');
    const out = path.join(p.dir, 'pool');
    await runPool({ options: poolOpts(p, out), cwd: p.dir, repoRoot: REPO_ROOT });
    const guideHash = sha(await readFile(p.guide));
    const sheet = await readUtf8(path.join(out, 'ciego', 'hojas', 'T01.md'));
    expect(sheet).toContain(`Para cada candidato, registra tu decisión y el criterio según la guía \`ciego/GUIA.md\` (SHA-256 ${guideHash}). Usa solo esta hoja y la guía.`);
    // Golden de la cabecera de la hoja (la hoja vive en ciego/hojas/ y la guía en ciego/).
    expect(sheet.split('\n').slice(0, 7)).toEqual([
      '# Hoja ciega T01',
      '',
      `Para cada candidato, registra tu decisión y el criterio según la guía \`ciego/GUIA.md\` (SHA-256 ${guideHash}). Usa solo esta hoja y la guía.`,
      '',
      `Target: ${(await sampleTargets(p))[0].targetId}`,
      expect.stringMatching(/^- Archivo: /) as unknown as string,
      expect.stringMatching(/^- Símbolo: /) as unknown as string,
    ]);
    expect(sheet).not.toContain('necesario para entender');
    expect(sheet).not.toContain('sí o no');
    expect(sheet).not.toContain('protocolo que aplique');
  });

  it('la ceguera se mantiene con una guía de prueba: hojas y plantilla sin modo, rank, score, relación ni valores', async () => {
    const p = await buildWi108Pipeline(scratch, 'guide-blind', { guideText: NEUTRAL_GUIDE });
    const out = path.join(p.dir, 'pool');
    await runPool({ options: poolOpts(p, out), cwd: p.dir, repoRoot: REPO_ROOT });
    const names = await readdir(path.join(out, 'ciego', 'hojas'));
    const texts = await Promise.all([
      ...names.map((name) => readUtf8(path.join(out, 'ciego', 'hojas', name))),
      readUtf8(path.join(out, 'ciego', 'annotation-template.csv')),
    ]);
    for (const text of texts) {
      expect(text.match(TOKENS)?.[0] ?? null).toBeNull();
      for (const value of NUMBERS) expect(text.includes(value), value).toBe(false);
    }
  });

  it('sin --guide es un uso incorrecto (código 2) en la CLI y en el parseo', async () => {
    expect(() => parseOe2Arguments(['pool', '--dump', 'c', '--sample', 's.csv', '--results', 'r', '--seed', 's', '--out', '/x']))
      .toThrow(/falta --guide/);
    const io = streams();
    const code = await runCli(['pool', '--dump', 'c', '--sample', 's.csv', '--results', 'r', '--seed', 's', '--out', '/x'], {
      stdout: io.stdout,
      stderr: io.stderr,
      env: {},
    });
    expect(code).toBe(2);
    expect(io.err.join('')).toContain('Error de uso');
  });

  it('una guía vacía aborta sin escribir nada', async () => {
    const empty = path.join(scratch, 'guia-vacia.md');
    await writeFile(empty, '');
    const p = await buildWi108Pipeline(scratch, 'guide-empty');
    const out = path.join(p.dir, 'pool');
    await expect(runPool({ options: poolOpts(p, out, { guide: empty }), cwd: p.dir, repoRoot: REPO_ROOT })).rejects.toThrow(/vacía/);
    await expect(readdir(out)).rejects.toThrow();
  });

  it('avisa (sin modificar la guía) si contiene términos de procedencia; una guía neutra no avisa', async () => {
    const leaky = path.join(scratch, 'guia-filtrada.md');
    await writeFile(leaky, 'R1: el candidato tiene relación estructural (IMPORTS) con el target; rank alto.\n');
    const p = await buildWi108Pipeline(scratch, 'guide-leaky');
    const outLeaky = path.join(p.dir, 'pool-leaky');
    const leakyResult = await runPool({ options: poolOpts(p, outLeaky, { guide: leaky }), cwd: p.dir, repoRoot: REPO_ROOT });
    expect(leakyResult.lines.join('\n')).toContain('AVISO');
    expect(leakyResult.lines.join('\n')).toContain('IMPORTS');
    expect((await readFile(path.join(outLeaky, 'ciego', 'GUIA.md'))).equals(await readFile(leaky))).toBe(true);

    const outNeutral = path.join(p.dir, 'pool-neutral');
    const neutralResult = await runPool({ options: poolOpts(p, outNeutral), cwd: p.dir, repoRoot: REPO_ROOT });
    expect(neutralResult.lines.join('\n')).not.toContain('AVISO');
  });

  it('guideBlindTerms detecta SE/SEM en mayúsculas, rank y estructural, pero no «se» ni «relación» en general', () => {
    expect(guideBlindTerms('El SEM y el rank; también IMPORTS')).toEqual(['IMPORTS', 'SEM', 'rank']);
    expect(guideBlindTerms('Si se da una relación entre el target y el candidato, anótalo.')).toEqual([]);
  });
});

describe('--roles: parseo', () => {
  it('acepta roles en orden canónico, sin duplicados; sin valor significa todos', () => {
    const base = ['pool', '--dump', 'c', '--sample', 's.csv', '--results', 'r', '--seed', 's', '--guide', 'g.md', '--out', '/x'];
    expect(parseOe2Arguments(base).options.roles).toBeNull();
    expect(parseOe2Arguments([...base, '--roles', 'reserva,calibracion,oficial,oficial']).options.roles).toEqual(['calibracion', 'oficial', 'reserva']);
    expect(parseOe2Arguments([...base, '--roles', 'oficial']).options.roles).toEqual(['oficial']);
  });

  it('rol desconocido, selección vacía o elemento vacío son errores de uso que no repiten el valor', () => {
    const base = ['score', '--results', 'r', '--gt', 'g.json', '--gt-sha256', 'a'.repeat(64), '--sample', 's.csv', '--out', '/x'];
    expect(() => parseOe2Arguments([...base, '--roles', 'OFICIAL-SECRETO'])).toThrow(UsageError);
    expect(() => parseOe2Arguments([...base, '--roles', ''])).toThrow(/vacío/);
    expect(() => parseOe2Arguments([...base, '--roles', 'oficial,,reserva'])).toThrow(/vacío/);
    try {
      parseOe2Arguments([...base, '--roles', 'OFICIAL-SECRETO']);
    } catch (error) {
      expect((error as Error).message).not.toContain('OFICIAL-SECRETO');
    }
  });

  it('build-gt usa «oficial» por defecto', () => {
    const parsed = parseOe2Arguments(['build-gt', '--template', 't.csv', '--key', 'k.json', '--sample', 's.csv', '--sheets', 'hojas', '--out', '/x']);
    expect(parsed.options.roles).toEqual(['oficial']);
    expect(parsed.options.sheets).toBe('hojas');
  });

  it('build-gt sin --sheets es un uso incorrecto (M-1)', () => {
    expect(() => parseOe2Arguments(['build-gt', '--template', 't.csv', '--key', 'k.json', '--sample', 's.csv', '--out', '/x']))
      .toThrow(/falta --sheets/);
    const io = streams();
    const code = runCli(['build-gt', '--template', 't.csv', '--key', 'k.json', '--sample', 's.csv', '--out', '/x'], {
      stdout: io.stdout,
      stderr: io.stderr,
      env: {},
    });
    return expect(code).resolves.toBe(2);
  });
});

describe('--roles en pool', () => {
  it('sin --roles procesa todas las filas; con --roles solo las pedidas, numeradas T01… en el orden del sample', async () => {
    const p = await buildWi108Pipeline(scratch, 'roles-pool', { sampleOptions: { calibration: 1, official: 1, reserve: 1 } });
    const targets = await sampleTargets(p);
    expect(targets.map((t) => t.role).sort()).toEqual(['calibracion', 'oficial', 'reserva']);

    const all = path.join(p.dir, 'pool-all');
    await runPool({ options: poolOpts(p, all), cwd: p.dir, repoRoot: REPO_ROOT });
    expect(await sheetTargets(all)).toEqual(targets.slice().sort((a, b) => a.order - b.order).map((t) => t.targetId));

    const oficial = path.join(p.dir, 'pool-oficial');
    const result = await runPool({ options: poolOpts(p, oficial, { roles: ['oficial'] }), cwd: p.dir, repoRoot: REPO_ROOT });
    const oficialId = targets.find((t) => t.role === 'oficial')?.targetId;
    expect(await sheetTargets(oficial)).toEqual([oficialId]);
    expect(await readdir(path.join(oficial, 'ciego', 'hojas'))).toEqual(['T01.md']);
    expect(result.lines.join('\n')).toContain('1 de 3');

    const key = JSON.parse(await readUtf8(path.join(oficial, 'clave', 'key.json')));
    expect(Object.keys(key.targets)).toEqual([oficialId]);
    expect(key.targets[oficialId].sheet).toBe('ciego/hojas/T01.md');
    const template = parseCsv(await readUtf8(path.join(oficial, 'ciego', 'annotation-template.csv')));
    expect(template.rows.every((row) => row.target_id === oficialId)).toBe(true);
    const keyIds = Object.keys(key.targets[oficialId].candidates).sort();
    expect(template.rows.map((row) => row.candidate_id).sort()).toEqual(keyIds);
    const summary = parseCsv(await readUtf8(path.join(oficial, 'pool-summary.csv')));
    expect(summary.rows.map((row) => row.role)).toEqual(['oficial']);
    const manifest = JSON.parse(await readUtf8(path.join(oficial, 'manifest.json')));
    expect(manifest).toMatchObject({ rolesSelected: ['oficial'], targets: 1, targetsInSample: 3 });
  });

  it('el orden de numeración sigue el sample tras filtrar: oficial,reserva → T01 oficial, T02 reserva', async () => {
    const p = await buildWi108Pipeline(scratch, 'roles-order', { sampleOptions: { calibration: 1, official: 1, reserve: 1 } });
    const targets = await sampleTargets(p);
    const out = path.join(p.dir, 'pool');
    await runPool({ options: poolOpts(p, out, { roles: ['oficial', 'reserva'] }), cwd: p.dir, repoRoot: REPO_ROOT });
    const expected = targets.filter((t) => t.role !== 'calibracion').sort((a, b) => a.order - b.order).map((t) => t.targetId);
    expect(await sheetTargets(out)).toEqual(expected);
    expect(await readdir(path.join(out, 'ciego', 'hojas'))).toEqual(['T01.md', 'T02.md']);
  });

  it('las filas de reserva excluidas no necesitan comparación; incluidas, sí', async () => {
    const p = await buildWi108Pipeline(scratch, 'roles-no-cmp', { sampleOptions: { calibration: 1, official: 1, reserve: 1 } });
    const targets = await sampleTargets(p);
    const reserve = targets.find((t) => t.role === 'reserva');
    await unlink(path.join(p.results, `${CMP_BY_TARGET[reserve!.targetId]}.json`));

    await expect(runPool({ options: poolOpts(p, path.join(p.dir, 'o-all')), cwd: p.dir, repoRoot: REPO_ROOT }))
      .rejects.toThrow(/falta la comparación/);
    const out = path.join(p.dir, 'o-sin-reserva');
    const result = await runPool({ options: poolOpts(p, out, { roles: ['calibracion', 'oficial'] }), cwd: p.dir, repoRoot: REPO_ROOT });
    expect(result.exitCode).toBe(0);
    expect(await readdir(path.join(out, 'ciego', 'hojas'))).toEqual(['T01.md', 'T02.md']);
  });

  it('una selección sin filas en el sample es un uso incorrecto (2)', async () => {
    const p = await buildWi108Pipeline(scratch, 'roles-absent', { sampleOptions: { calibration: 0, official: 3, reserve: 0 } });
    await expect(runPool({ options: poolOpts(p, path.join(p.dir, 'o'), { roles: ['calibracion'] }), cwd: p.dir, repoRoot: REPO_ROOT }))
      .rejects.toBeInstanceOf(UsageError);
    const io = streams();
    const code = await runCli(['pool', '--dump', p.dump, '--sample', p.sample, '--results', p.results, '--seed', 's', '--guide', p.guide,
      '--roles', 'reserva', '--out', path.join(p.dir, 'o-cli')], { stdout: io.stdout, stderr: io.stderr, env: {}, root: REPO_ROOT });
    expect(code).toBe(2);
  });
});

/** Texto de la hoja del target indicado dentro de un paquete de `pool` (busca por la línea «Target:»). */
async function sheetTextOf(out: string, targetId: string) {
  const dir = path.join(out, 'ciego', 'hojas');
  const names = (await readdir(dir)).sort();
  const texts = await Promise.all(names.map((name) => readUtf8(path.join(dir, name))));
  const found = texts.filter((text) => text.includes(`\nTarget: ${targetId}\n`));
  expect(found, `una hoja para ${targetId}`).toHaveLength(1);
  return found[0];
}

describe('--roles no cambia el orden de candidatos ni sus candidate_id (M-2)', () => {
  it('por target: hoja (salvo el número T<nn>) y filas de la plantilla idénticas con y sin --roles', async () => {
    const p = await buildWi108Pipeline(scratch, 'order-roles', { sampleOptions: { calibration: 1, official: 1, reserve: 1 } });
    const targets = await sampleTargets(p);
    const full = path.join(p.dir, 'pool-full');
    await runPool({ options: poolOpts(p, full), cwd: p.dir, repoRoot: REPO_ROOT });
    const fullTemplate = parseCsv(await readUtf8(path.join(full, 'ciego', 'annotation-template.csv'))).rows;

    for (const target of targets) {
      const out = path.join(p.dir, `pool-${target.role}`);
      await runPool({ options: poolOpts(p, out, { roles: [target.role] }), cwd: p.dir, repoRoot: REPO_ROOT });
      // La hoja de un target no depende de la selección: solo cambia la primera línea (número T<nn>).
      const withRoles = (await sheetTextOf(out, target.targetId)).split('\n').slice(1).join('\n');
      const withoutRoles = (await sheetTextOf(full, target.targetId)).split('\n').slice(1).join('\n');
      expect(withRoles, target.targetId).toBe(withoutRoles);
      const idsWith = parseCsv(await readUtf8(path.join(out, 'ciego', 'annotation-template.csv'))).rows.map((row) => row.candidate_id);
      const idsWithout = fullTemplate.filter((row) => row.target_id === target.targetId).map((row) => row.candidate_id);
      expect(idsWith, target.targetId).toEqual(idsWithout);
      expect(idsWith.length).toBeGreaterThan(0);
    }
  });
});

describe('--roles: roles pedidos sin filas en el sample (aviso, código 0 si queda alguna fila)', () => {
  it('pool avisa por stdout y procesa las filas que sí existen', async () => {
    const p = await buildWi108Pipeline(scratch, 'warn-pool', { sampleOptions: { calibration: 0, official: 3, reserve: 0 } });
    const out = path.join(p.dir, 'pool');
    const result = await runPool({ options: poolOpts(p, out, { roles: ['oficial', 'reserva'] }), cwd: p.dir, repoRoot: REPO_ROOT });
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain('AVISO: --roles pide reserva y el sample no tiene filas de ese rol');
    expect(await readdir(path.join(out, 'ciego', 'hojas'))).toHaveLength(3);
  });

  it('score avisa y puntúa lo que hay (sin cambiar el código de salida)', async () => {
    const p = await buildWi108Pipeline(scratch, 'warn-score', { sampleOptions: { calibration: 0, official: 3, reserve: 0 } });
    const gt = path.join(p.dir, 'gt.json');
    const gtBytes = Buffer.from('{}');
    await writeFile(gt, gtBytes);
    const out = path.join(p.dir, 'score');
    const result = await runScore({ options: { results: p.results, gt, gtSha256: sha(gtBytes), sample: p.sample, includeCalibration: false, roles: ['oficial', 'reserva'], out, allowOutInRepo: false }, cwd: p.dir, repoRoot: REPO_ROOT });
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain('AVISO: --roles pide reserva');
  });
});

describe('--roles en score', () => {
  async function scorePipeline(name: string) {
    const p = await buildWi108Pipeline(scratch, name, { sampleOptions: { calibration: 1, official: 1, reserve: 1 } });
    const targets = await sampleTargets(p);
    const item = { filePath: 'src/Domain/Rate.php', symbolQualifiedName: 'App\\Domain\\Rate.apply' };
    const gtBytes = Buffer.from(JSON.stringify(Object.fromEntries(targets.map((t) => [t.targetId, [item]])), null, 2));
    const gt = path.join(p.dir, 'gt.json');
    await writeFile(gt, gtBytes);
    return { p, targets, gt, gtSha: sha(gtBytes) };
  }

  it('sin --roles puntúa oficiales (regla de WI-CORE-107) y no genera el CSV no reportable', async () => {
    const { p, gt, gtSha, targets } = await scorePipeline('score-default');
    const out = path.join(p.dir, 'score');
    await runScore({ options: { results: p.results, gt, gtSha256: gtSha, sample: p.sample, includeCalibration: false, roles: null, out, allowOutInRepo: false }, cwd: p.dir, repoRoot: REPO_ROOT });
    const oficialId = targets.find((t) => t.role === 'oficial')?.targetId;
    const perTarget = parseCsv(await readUtf8(path.join(out, 'metrics-per-target.csv')));
    expect(perTarget.rows.map((row) => row.targetId)).toEqual([oficialId]);
    const scores = JSON.parse(await readUtf8(path.join(out, 'scores.json')));
    expect(scores.official.map((row: { targetId: string }) => row.targetId)).toEqual([oficialId]);
    expect((await readdir(out)).some((name) => name.includes('NO-REPORTABLE'))).toBe(false);
  });

  it('--roles calibracion sin --include-calibration: no puntúa nada oficial y avisa', async () => {
    const { p, gt, gtSha } = await scorePipeline('score-cal-only');
    const out = path.join(p.dir, 'score');
    const result = await runScore({ options: { results: p.results, gt, gtSha256: gtSha, sample: p.sample, includeCalibration: false, roles: ['calibracion'], out, allowOutInRepo: false }, cwd: p.dir, repoRoot: REPO_ROOT });
    expect(result.lines.join('\n')).toContain('AVISO');
    const scores = JSON.parse(await readUtf8(path.join(out, 'scores.json')));
    expect(scores.official).toEqual([]);
    expect(scores.summary.official).toBe(0);
  });

  it('--roles calibracion con --include-calibration: la calibración va solo al CSV no reportable', async () => {
    const { p, gt, gtSha, targets } = await scorePipeline('score-cal-incl');
    const out = path.join(p.dir, 'score');
    await runScore({ options: { results: p.results, gt, gtSha256: gtSha, sample: p.sample, includeCalibration: true, roles: ['calibracion'], out, allowOutInRepo: false }, cwd: p.dir, repoRoot: REPO_ROOT });
    const noReportable = parseCsv(await readUtf8(path.join(out, 'metrics-calibracion-reserva-NO-REPORTABLE.csv')));
    const calId = targets.find((t) => t.role === 'calibracion')?.targetId;
    expect(noReportable.rows.map((row) => row.targetId)).toEqual([calId]);
    expect(noReportable.rows[0].uso).toContain('NO REPORTABLE');
    const scores = JSON.parse(await readUtf8(path.join(out, 'scores.json')));
    expect(scores.official).toEqual([]);
  });

  it('--roles oficial,reserva con --include-calibration: la reserva va al no reportable y el oficial a scores.json', async () => {
    const { p, gt, gtSha, targets } = await scorePipeline('score-res');
    const out = path.join(p.dir, 'score');
    await runScore({ options: { results: p.results, gt, gtSha256: gtSha, sample: p.sample, includeCalibration: true, roles: ['oficial', 'reserva'], out, allowOutInRepo: false }, cwd: p.dir, repoRoot: REPO_ROOT });
    const noReportable = parseCsv(await readUtf8(path.join(out, 'metrics-calibracion-reserva-NO-REPORTABLE.csv')));
    expect(noReportable.rows.map((row) => row.targetId)).toEqual([targets.find((t) => t.role === 'reserva')?.targetId]);
    const scores = JSON.parse(await readUtf8(path.join(out, 'scores.json')));
    expect(scores.official.map((row: { targetId: string }) => row.targetId)).toEqual([targets.find((t) => t.role === 'oficial')?.targetId]);
  });
});
