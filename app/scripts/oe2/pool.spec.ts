// WI-CORE-107: pruebas del subcomando `pool` con fixtures sintéticos: unión y deduplicación, exclusión del target,
// ceguera de las hojas y de la plantilla, determinismo por semilla y fallos (configuración, faltantes, cierre).
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSample } from './sample.mjs';
import { runPool, truncateCode, shuffleForTarget, loadComparisons, verifyFrozenConfig } from './pool.mjs';
import { chunk } from './fixtures.mjs';
import { parseCsv, compareCodeUnits } from './io-primitives.mjs';
import { escapeRegExp } from './product-copies.mjs';
import { CONFIG_SE, CONFIG_SEM, comparisonDocument, syntheticChunks, toJsonl } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..');
let scratch: string;

const CONVERT = { filePath: 'src/Domain/Converter.php', qualifiedName: 'App\\Domain\\Converter.convert' };
const APPLY = { filePath: 'src/Domain/Rate.php', qualifiedName: 'App\\Domain\\Rate.apply' };
const FORMAT = { filePath: 'src/Util/format.php', qualifiedName: 'App\\Util\\format' };

/** Candidatos de SE/SEM para el target `convert`: incluye duplicados de símbolo, el target y un solo modo. */
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

/** Sintético con el mismo cuerpo de SE/SEM para `apply` y `format` (menos candidatos). */
const APPLY_SPECS = [
  { chunkId: 'a-01', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money.amount', semantic: 0.5, structural: null },
  { chunkId: 'a-02', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money', semantic: 0.4, structural: 'SAME_NAMESPACE' },
];
const FORMAT_SPECS = [
  { chunkId: 'f-01', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money.amount', semantic: 0.3, structural: null },
];

const TOKENS = /\bSEM?\b|\brank\b|\bscore\b|origen|relaci[oó]n|estructural|structural|semantic|combined|IMPORTS|IMPORTED_BY|SAME_NAMESPACE|FULLY_QUALIFIED|DECLARING|seleccionad|selected/i;
const NUMBERS = ['0.9137', '0.8123', '0.7041', '0.6052', '0.2019', '0.1011', '0.9583', '0.5', '0.4', '0.3'];

async function writeResults(dir: string, documents: unknown[]) {
  await mkdir(dir, { recursive: true });
  for (const document of documents as Array<{ retrievalComparisonId: string }>) {
    await writeFile(path.join(dir, `${document.retrievalComparisonId}.json`), JSON.stringify(document));
  }
}

interface PipelineOptions {
  seedSpecs?: boolean;
  convertSpecs?: unknown[];
  mutate?: (document: { modes: Array<{ mode: string; candidates: Array<{ symbolQualifiedName: string | null }> }> }) => void;
  extraChunks?: unknown[];
}

async function buildPipeline(name: string, { seedSpecs = true, convertSpecs = CONVERT_SPECS, mutate, extraChunks = [] }: PipelineOptions = {}) {
  const dir = path.join(scratch, name);
  await mkdir(dir, { recursive: true });
  const dump = path.join(dir, 'chunks.jsonl');
  await writeFile(dump, toJsonl([...syntheticChunks(), ...extraChunks] as never));
  const sampleOut = path.join(dir, 'sample');
  await runSample({
    options: { dump, seed: 'muestra-pool', calibration: 0, official: 3, reserve: 0, repo: 'money', out: sampleOut, allowOutInRepo: false },
    cwd: dir,
    repoRoot: REPO_ROOT,
  });
  const results = path.join(dir, 'results');
  const convertDocument = comparisonDocument({ id: 'cmp-convert', symbol: { kind: 'METHOD', ...CONVERT }, specs: convertSpecs as never });
  if (mutate) mutate(convertDocument as never);
  const documents = seedSpecs
    ? [
        convertDocument,
        comparisonDocument({ id: 'cmp-apply', symbol: { kind: 'METHOD', ...APPLY }, specs: APPLY_SPECS }),
        comparisonDocument({ id: 'cmp-format', symbol: { kind: 'FUNCTION', ...FORMAT }, specs: FORMAT_SPECS }),
      ]
    : [];
  await writeResults(results, documents);
  return { dir, dump, sample: path.join(sampleOut, 'sample.csv'), results };
}

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'oe2-pool-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function poolOptions(pipeline: { dump: string; sample: string; results: string }, out: string, seed = 'semilla-pool', maxChars = 6000) {
  return { dump: pipeline.dump, sample: pipeline.sample, results: pipeline.results, seed, maxChars, out, allowOutInRepo: false };
}

describe('pool: salidas y unión', () => {
  it('escribe hojas ciegas, plantilla, clave aparte y resumen agregado', async () => {
    const pipeline = await buildPipeline('basic');
    const out = path.join(pipeline.dir, 'pool');
    const result = await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    expect(result.exitCode).toBe(0);
    const blind = await readdir(path.join(out, 'ciego', 'hojas'));
    expect(blind.sort()).toEqual(['T01.md', 'T02.md', 'T03.md']);
    const files = await readdir(out);
    expect(files).toEqual(expect.arrayContaining(['ciego', 'clave', 'pool-summary.csv', 'manifest.json']));
  });

  it('une SE y SEM sin duplicar símbolos, excluye el propio target e incluye el cierre', async () => {
    const pipeline = await buildPipeline('union');
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const key = JSON.parse(await readFile(path.join(out, 'clave', 'key.json'), 'utf8'));
    const target = Object.entries(key.targets).find(([id]) => id.endsWith('App\\Domain\\Converter.convert')) as [string, { candidates: Record<string, { qualifiedName: string; SE: unknown; SEM: unknown; inClosure: boolean }> }];
    const candidates = Object.values(target[1].candidates);
    const names = candidates.map((item) => item.qualifiedName);
    expect(names).not.toContain('App\\Domain\\Converter.convert');
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => name === 'App\\Domain\\Rate.apply')).toHaveLength(1);
    const rate = candidates.find((item) => item.qualifiedName === 'App\\Domain\\Rate');
    expect(rate).toMatchObject({ inClosure: true, SE: null, SEM: null });
    const money = candidates.find((item) => item.qualifiedName === 'App\\Domain\\Money');
    expect(money).toMatchObject({ inClosure: true });
    expect(money?.SE).not.toBeNull();
    expect(money?.SEM).not.toBeNull();
  });

  it('el resumen cuenta símbolos distintos y solapes', async () => {
    const pipeline = await buildPipeline('summary');
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const summary = parseCsv(await readFile(path.join(out, 'pool-summary.csv'), 'utf8'));
    const convert = summary.rows.find((row) => row.targetId.endsWith('App\\Domain\\Converter.convert'));
    expect(convert).toMatchObject({
      nSE10: '6', nSEM10: '5', nClosure: '2', nUnion: '7', nSEandSEM: '5', nSEandClosure: '1', nSEMandClosure: '1', nSinIdentidad: '0',
    });
  });
});

describe('pool: ceguera', () => {
  it('ni las hojas ni la plantilla contienen modo, rank, score, relación ni origen, ni los valores de score', async () => {
    const pipeline = await buildPipeline('blind');
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const sheets = await readdir(path.join(out, 'ciego', 'hojas'));
    const texts = await Promise.all([
      ...sheets.map((name) => readFile(path.join(out, 'ciego', 'hojas', name), 'utf8')),
      readFile(path.join(out, 'ciego', 'annotation-template.csv'), 'utf8'),
    ]);
    for (const text of texts) {
      expect(text.match(TOKENS)?.[0] ?? null).toBeNull();
      for (const value of NUMBERS) expect(text.includes(value), value).toBe(false);
    }
  });

  it('la plantilla tiene una fila por candidato con decisiones vacías', async () => {
    const pipeline = await buildPipeline('template');
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const template = parseCsv(await readFile(path.join(out, 'ciego', 'annotation-template.csv'), 'utf8'));
    expect(template.header).toEqual([
      'candidate_id', 'target_id', 'anotador_A_decision', 'anotador_A_criterio',
      'anotador_B_decision', 'anotador_B_criterio', 'adjudicacion', 'adjudicacion_criterio',
    ]);
    expect(template.rows.every((row) => row.anotador_A_decision === '' && row.adjudicacion === '')).toBe(true);
    const key = JSON.parse(await readFile(path.join(out, 'clave', 'key.json'), 'utf8'));
    const keyIds = Object.values(key.targets).flatMap((target) => Object.keys((target as { candidates: object }).candidates));
    expect(template.rows.map((row) => row.candidate_id).sort()).toEqual(keyIds.sort());
  });

  it('la clave sí lleva el origen: rank, score, relación y pertenencia al cierre', async () => {
    const pipeline = await buildPipeline('key');
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const key = JSON.parse(await readFile(path.join(out, 'clave', 'key.json'), 'utf8'));
    const entries = Object.values(key.targets).flatMap((target) => Object.values((target as { candidates: Record<string, { SE: unknown }> }).candidates));
    const withSe = entries.find((entry) => (entry as { SE: unknown }).SE !== null) as { SE: { rank: number; semanticScore: number; structuralRelation: unknown; combinedScore: number | null } };
    expect(typeof withSe.SE.rank).toBe('number');
    expect(typeof withSe.SE.semanticScore === 'number' || withSe.SE.semanticScore === null).toBe(true);
    expect('structuralRelation' in withSe.SE && 'combinedScore' in withSe.SE).toBe(true);
  });
});

describe('pool: determinismo y orden', () => {
  it('la misma semilla produce las mismas hojas; otra semilla cambia el orden de candidatos', async () => {
    const pipeline = await buildPipeline('determinism');
    const outA = path.join(pipeline.dir, 'pool-a');
    const outB = path.join(pipeline.dir, 'pool-b');
    const outC = path.join(pipeline.dir, 'pool-c');
    await runPool({ options: poolOptions(pipeline, outA, 'semilla-1'), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    await runPool({ options: poolOptions(pipeline, outB, 'semilla-1'), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    await runPool({ options: poolOptions(pipeline, outC, 'semilla-2'), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const sheets = async (dir: string) => Promise.all(
      (await readdir(path.join(dir, 'ciego', 'hojas'))).sort().map((name) => readFile(path.join(dir, 'ciego', 'hojas', name), 'utf8')),
    );
    expect(await sheets(outA)).toEqual(await sheets(outB));
    expect(await sheets(outC)).not.toEqual(await sheets(outA));
  });

  it('el barajado por target es una permutación determinista', () => {
    const pool = Array.from({ length: 9 }, (_, index) => ({ id: index }));
    const one = shuffleForTarget(pool, 'semilla', 'T::x');
    expect(shuffleForTarget(pool, 'semilla', 'T::x')).toEqual(one);
    expect(one.map((item) => item.id).sort()).toEqual(pool.map((item) => item.id));
  });

  it('el candidate_id sigue el formato <targetId>-<k:02d>', async () => {
    const pipeline = await buildPipeline('ids');
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const template = parseCsv(await readFile(path.join(out, 'ciego', 'annotation-template.csv'), 'utf8'));
    const byTarget = new Map<string, string[]>();
    for (const row of template.rows) {
      const list = byTarget.get(row.target_id) ?? [];
      list.push(row.candidate_id);
      byTarget.set(row.target_id, list);
    }
    for (const [targetId, ids] of byTarget) {
      const pattern = new RegExp(`^${escapeRegExp(targetId)}-(\\d{2})$`);
      const numbers = ids.map((id) => {
        const match = pattern.exec(id);
        expect(match, id).not.toBeNull();
        return Number(match?.[1]);
      });
      // Consecutivos 01..N, sin huecos ni repeticiones, con exactamente dos dígitos.
      expect(numbers).toEqual(Array.from({ length: ids.length }, (_, index) => index + 1));
    }
  });
});

describe('pool: truncado de código', () => {
  it('trunca con un marcador explícito cuando el código supera --max-chars', () => {
    const code = 'x'.repeat(500);
    const truncated = truncateCode(code, 200);
    expect(truncated.startsWith('x'.repeat(200))).toBe(true);
    expect(truncated).toMatch(/código truncado: se muestran 200 de 500 caracteres/);
    expect(truncateCode('corto', 200)).toBe('corto');
  });
});

describe('pool: fallos que no producen salida', () => {
  it('una configuración SE distinta de la congelada aborta', async () => {
    const pipeline = await buildPipeline('bad-config', { seedSpecs: false });
    const bad = comparisonDocument({ id: 'cmp-convert', symbol: { kind: 'METHOD', ...CONVERT }, specs: CONVERT_SPECS });
    (bad.modes[0].config as { semanticTopK: number }).semanticTopK = 10;
    await writeResults(pipeline.results, [bad]);
    await expect(runPool({ options: poolOptions(pipeline, path.join(pipeline.dir, 'o1')), cwd: pipeline.dir, repoRoot: REPO_ROOT }))
      .rejects.toThrow(/configuración SE no coincide/);
  });

  it('falta un target en los resultados: aborta', async () => {
    const pipeline = await buildPipeline('missing', { seedSpecs: false });
    await writeResults(pipeline.results, [
      comparisonDocument({ id: 'cmp-convert', symbol: { kind: 'METHOD', ...CONVERT }, specs: CONVERT_SPECS }),
    ]);
    await expect(runPool({ options: poolOptions(pipeline, path.join(pipeline.dir, 'o2')), cwd: pipeline.dir, repoRoot: REPO_ROOT }))
      .rejects.toThrow(/falta la comparación/);
  });

  it('un modo que falta (solo SE) aborta', async () => {
    const pipeline = await buildPipeline('one-mode', { seedSpecs: false });
    const onlySe = comparisonDocument({ id: 'cmp-convert', symbol: { kind: 'METHOD', ...CONVERT }, specs: CONVERT_SPECS });
    onlySe.modes = onlySe.modes.slice(0, 1);
    await writeResults(pipeline.results, [onlySe]);
    await expect(runPool({ options: poolOptions(pipeline, path.join(pipeline.dir, 'o3')), cwd: pipeline.dir, repoRoot: REPO_ROOT }))
      .rejects.toThrow(/exactamente los modos SE y SEM/);
  });

  it('un cierre que no coincide con sample.csv aborta (volcado o sample alterados)', async () => {
    const pipeline = await buildPipeline('closure');
    const sample = await readFile(pipeline.sample, 'utf8');
    await writeFile(pipeline.sample, sample.replace('App\\Domain\\Money;App\\Domain\\Rate', 'App\\Domain\\Money'));
    await expect(runPool({ options: poolOptions(pipeline, path.join(pipeline.dir, 'o4')), cwd: pipeline.dir, repoRoot: REPO_ROOT }))
      .rejects.toThrow(/cierre recalculado/);
  });

  it('dos comparaciones para el mismo target aborta', async () => {
    const pipeline = await buildPipeline('dup', { seedSpecs: false });
    await writeResults(pipeline.results, [
      comparisonDocument({ id: 'cmp-a', symbol: { kind: 'METHOD', ...CONVERT }, specs: CONVERT_SPECS }),
      comparisonDocument({ id: 'cmp-b', symbol: { kind: 'METHOD', ...CONVERT }, specs: CONVERT_SPECS }),
    ]);
    await expect(loadComparisons(pipeline.results)).rejects.toThrow(/varias comparaciones/);
  });

  it('la verificación de configuración exige pesos 0.7/0.3 en SE y nulos en SEM', () => {
    expect(() => verifyFrozenConfig('SE', { ...CONFIG_SE, structuralWeight: 0.5 }, 'x')).toThrow(/structuralWeight/);
    expect(() => verifyFrozenConfig('SEM', { ...CONFIG_SEM, semanticWeight: 0.7 }, 'x')).toThrow(/semanticWeight/);
    expect(() => verifyFrozenConfig('SE', { ...CONFIG_SE, embeddingModel: undefined }, 'x')).toThrow(/embeddingModel/);
  });

  it('el target no existe en el volcado: aborta', async () => {
    const pipeline = await buildPipeline('no-target');
    const tampered = (await readFile(pipeline.sample, 'utf8')).replace('App\\Util\\format', 'App\\Util\\inventada');
    await writeFile(pipeline.sample, tampered);
    await expect(runPool({ options: poolOptions(pipeline, path.join(pipeline.dir, 'o5')), cwd: pipeline.dir, repoRoot: REPO_ROOT }))
      .rejects.toThrow(/no está en el volcado/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A-1: un CONSTRUCTOR seleccionado en SE o SEM debe resolverse a su código y entrar en el pool.
// ---------------------------------------------------------------------------------------------------------------
const CTOR = { chunkId: 'k-ctor', filePath: 'src/Domain/Money.php', qualifiedName: 'App\\Domain\\Money.constructor', semantic: 0.5, structural: null };
const CTOR_STRUCTURAL_ONLY = { ...CTOR, chunkId: 'k-ctor-s', semantic: null, structural: 'IMPORTS' };
const HOMONYM_METHOD = chunk({
  filePath: 'src/Domain/Money.php', symbolKind: 'METHOD', symbolName: 'constructor',
  parentSymbolName: 'App\\Domain\\Money', startLine: 9,
  content: '    public function constructor(): int\n    {\n        return 1;\n    }\n',
});

function ctorEntry(out: string) {
  return readFile(path.join(out, 'clave', 'key.json'), 'utf8').then((text) => {
    const key = JSON.parse(text) as { targets: Record<string, { sheet: string; candidates: Record<string, { qualifiedName: string; SE: unknown; SEM: unknown; inClosure: boolean; kind: string }> }> };
    const target = Object.entries(key.targets).find(([id]) => id.endsWith('App\\Domain\\Converter.convert'));
    if (!target) throw new Error('target convert ausente');
    const candidates = Object.entries(target[1].candidates);
    return {
      sheet: target[1].sheet,
      candidates,
      find: (name: string) => candidates.find(([, value]) => value.qualifiedName === name),
    };
  });
}

describe('pool: CONSTRUCTOR entre los candidatos (A-1)', () => {
  it('constructor solo en SE: se resuelve, entra en el pool y aparece en la hoja como CONSTRUCTOR', async () => {
    const pipeline = await buildPipeline('ctor-se', { convertSpecs: [...CONVERT_SPECS, CTOR_STRUCTURAL_ONLY] });
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const key = await ctorEntry(out);
    const entry = key.find('App\\Domain\\Money.constructor');
    expect(entry).toBeDefined();
    expect(entry?.[1]).toMatchObject({ kind: 'CONSTRUCTOR', inClosure: false, SEM: null });
    expect(entry?.[1].SE).not.toBeNull();
    const sheet = await readFile(path.join(out, key.sheet), 'utf8');
    expect(sheet).toContain('- Tipo: CONSTRUCTOR');
    expect(sheet).toContain('public function __construct(int $cents)');
  });

  it('constructor solo en SEM: se resuelve y entra en el pool sin aparecer en SE', async () => {
    const pipeline = await buildPipeline('ctor-sem', {
      convertSpecs: [...CONVERT_SPECS, CTOR],
      mutate: (document) => {
        document.modes[0].candidates = document.modes[0].candidates.filter((item) => item.symbolQualifiedName !== 'App\\Domain\\Money.constructor');
      },
    });
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const key = await ctorEntry(out);
    expect(key.find('App\\Domain\\Money.constructor')?.[1]).toMatchObject({ SE: null, SEM: expect.anything() });
  });

  it('constructor en ambos modos: una sola entrada deduplicada', async () => {
    const pipeline = await buildPipeline('ctor-both', { convertSpecs: [...CONVERT_SPECS, CTOR] });
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const key = await ctorEntry(out);
    const matches = key.candidates.filter(([, value]) => value.qualifiedName === 'App\\Domain\\Money.constructor');
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toMatchObject({ kind: 'CONSTRUCTOR', inClosure: false });
    expect(matches[0][1].SE).not.toBeNull();
    expect(matches[0][1].SEM).not.toBeNull();
    const summary = parseCsv(await readFile(path.join(out, 'pool-summary.csv'), 'utf8'));
    expect(summary.rows.find((row) => row.targetId.endsWith('App\\Domain\\Converter.convert'))?.nUnion).toBe('8');
  });

  it('constructor y método homónimo: la hoja usa el de mayor precedencia (METHOD) y cuenta la ambigüedad', async () => {
    const pipeline = await buildPipeline('ctor-homonym', { convertSpecs: [...CONVERT_SPECS, CTOR], extraChunks: [HOMONYM_METHOD] });
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const key = await ctorEntry(out);
    const matches = key.candidates.filter(([, value]) => value.qualifiedName === 'App\\Domain\\Money.constructor');
    expect(matches).toHaveLength(1);
    const sheet = await readFile(path.join(out, key.sheet), 'utf8');
    expect(sheet).toContain('return 1;');
    expect(sheet).not.toContain('public function __construct(int $cents)');
    const summary = parseCsv(await readFile(path.join(out, 'pool-summary.csv'), 'utf8'));
    expect(summary.rows.find((row) => row.targetId.endsWith('App\\Domain\\Converter.convert'))?.ambiguousKinds).toBe('1');
    // El cierre no cambia por la presencia del constructor.
    expect(summary.rows.find((row) => row.targetId.endsWith('App\\Domain\\Converter.convert'))?.nClosure).toBe('2');
  });

  it('el constructor no entra en el universo de sample (sigue excluido)', async () => {
    const pipeline = await buildPipeline('ctor-universe', { convertSpecs: [...CONVERT_SPECS, CTOR] });
    const sample = parseCsv(await readFile(pipeline.sample, 'utf8'));
    expect(sample.rows.some((row) => row.qualifiedName.endsWith('.constructor'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// M-1: el orden de las hojas y los candidate_id no dependen de la procedencia (SE, SEM, cierre).
// ---------------------------------------------------------------------------------------------------------------
describe('pool: independencia de la procedencia (M-1)', () => {
  it('mismo conjunto de candidatos con procedencias distintas: hojas y plantilla idénticas, clave distinta', async () => {
    const withBoth = await buildPipeline('prov-a');
    const onlySe = await buildPipeline('prov-b', {
      mutate: (document) => {
        // Quita de SEM candidatos que siguen en SE: la unión no cambia, la procedencia sí.
        const drop = new Set(['App\\Domain\\Money.amount', 'App\\Domain\\Rate.apply', 'App\\Util\\format']);
        document.modes[1].candidates = document.modes[1].candidates.filter((item) => !drop.has(item.symbolQualifiedName ?? ''));
      },
    });
    const outA = path.join(withBoth.dir, 'pool');
    const outB = path.join(onlySe.dir, 'pool');
    await runPool({ options: poolOptions(withBoth, outA), cwd: withBoth.dir, repoRoot: REPO_ROOT });
    await runPool({ options: poolOptions(onlySe, outB), cwd: onlySe.dir, repoRoot: REPO_ROOT });
    const hojas = async (dir: string) => Promise.all(
      (await readdir(path.join(dir, 'ciego', 'hojas'))).sort().map((name) => readFile(path.join(dir, 'ciego', 'hojas', name), 'utf8')),
    );
    expect(await hojas(outA)).toEqual(await hojas(outB));
    expect(await readFile(path.join(outA, 'ciego', 'annotation-template.csv'), 'utf8'))
      .toBe(await readFile(path.join(outB, 'ciego', 'annotation-template.csv'), 'utf8'));
    const keyA = await readFile(path.join(outA, 'clave', 'key.json'), 'utf8');
    const keyB = await readFile(path.join(outB, 'clave', 'key.json'), 'utf8');
    expect(keyA).not.toEqual(keyB);
  });

  it('el orden de la hoja es la permutación barajada del pool ordenado por (filePath, qualifiedName)', async () => {
    const pipeline = await buildPipeline('golden-pool');
    const out = path.join(pipeline.dir, 'pool');
    await runPool({ options: poolOptions(pipeline, out), cwd: pipeline.dir, repoRoot: REPO_ROOT });
    const key = await ctorEntry(out);
    // Pool del target convert ordenado por (filePath, qualifiedName) (ver GOLDEN_POOL_SORTED).
    const expectedOrder = shuffleForTarget(GOLDEN_POOL_SORTED.map((name) => ({ name })), 'semilla-pool', `${CONVERT.filePath}::${CONVERT.qualifiedName}`).map((item) => item.name);
    expect(expectedOrder).toEqual(GOLDEN_POOL_EXPECTED);
    const sheet = await readFile(path.join(out, key.sheet), 'utf8');
    const headings = [...sheet.matchAll(/^### (.+)\n- Archivo: .+\n- Símbolo: (.+)$/gm)].map((match) => match[2]);
    expect(headings).toEqual(GOLDEN_POOL_EXPECTED);
  });
});

/** Pool de `convert` ordenado por (filePath, qualifiedName) con código de unidades. */
const GOLDEN_POOL_SORTED = ['App\\Domain\\Converter.label', 'App\\Domain\\Money', 'App\\Domain\\Money.amount', 'App\\Domain\\Rate', 'App\\Domain\\Rate.apply', 'App\\Other\\Thing', 'App\\Util\\format'];
/** Orden esperado fijado a mano: calculado de forma independiente (Python, mulberry32 y Fisher–Yates descendente). */
const GOLDEN_POOL_EXPECTED = ['App\\Domain\\Money.amount', 'App\\Domain\\Money', 'App\\Util\\format', 'App\\Domain\\Converter.label', 'App\\Domain\\Rate.apply', 'App\\Domain\\Rate', 'App\\Other\\Thing'];
