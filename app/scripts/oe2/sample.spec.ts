// WI-CORE-107: pruebas de universo, elegibilidad, cierre de profundidad 1 y sorteo (`sample`) con fixtures sintéticos.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildUniverse } from './universe.mjs';
import { buildTypeIndex, symbolClosure } from './closure.mjs';
import { createMulberry32, hex32, parseCsv, seedStateFromText } from './io-primitives.mjs';
import { drawSample, readExclusions, runSample } from './sample.mjs';
import { chunk, EXPECTED_REASONS, syntheticChunks, toJsonl } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..');
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'oe2-sample-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function byId(rows: Array<{ filePath: string; qualifiedName: string }>) {
  return new Map(rows.map((row) => [`${row.filePath}::${row.qualifiedName}`, row]));
}

describe('universo y elegibilidad (D-OE2-5)', () => {
  it('asigna el motivo esperado a cada símbolo del volcado sintético', () => {
    const universe = buildUniverse(syntheticChunks());
    const rows = byId(universe.rows as never);
    for (const [id, reason] of Object.entries(EXPECTED_REASONS)) {
      const row = rows.get(id) as unknown as { reason: string; eligible: boolean } | undefined;
      expect(row, id).toBeDefined();
      expect(row?.reason, id).toBe(reason);
      expect(row?.eligible, id).toBe(reason === '');
    }
    expect(universe.rows).toHaveLength(Object.keys(EXPECTED_REASONS).length);
  });

  it('ordena el universo y los elegibles por (filePath, qualifiedName) con unidades de código', () => {
    const universe = buildUniverse(syntheticChunks());
    const keys = universe.rows.map((row) => `${row.filePath}\u0000${row.qualifiedName}`);
    expect(keys).toEqual([...keys].sort());
    const eligibleKeys = universe.eligible.map((row) => `${row.filePath}\u0000${row.qualifiedName}`);
    expect(eligibleKeys).toEqual([...eligibleKeys].sort());
    expect(universe.eligible.map((row) => row.qualifiedName)).toEqual([
      'App\\Domain\\Converter.convert', 'App\\Domain\\Rate.apply', 'App\\Util\\format',
    ]);
  });

  it('excluye CONSTRUCTOR y tipos del universo (solo METHOD y FUNCTION)', () => {
    const universe = buildUniverse(syntheticChunks());
    expect(universe.rows.some((row) => row.qualifiedName.endsWith('.constructor'))).toBe(false);
    expect(universe.rows.every((row) => row.kind === 'METHOD' || row.kind === 'FUNCTION')).toBe(true);
  });

  it('el archivo que no es PHP queda fuera con su motivo', () => {
    const universe = buildUniverse([
      chunk({ filePath: 'src/a.ts', symbolKind: 'FUNCTION', symbolName: 'a', content: 'function a(): void {}' }),
    ]);
    expect(universe.rows[0]).toMatchObject({ eligible: false, reason: 'no-php' });
  });

  it('el smoke excluido queda con motivo excluido-smoke', () => {
    const universe = buildUniverse(syntheticChunks(), {
      excluded: new Set([`src/Domain/Rate.php\u0000App\\Domain\\Rate.apply`]),
    });
    const apply = universe.rows.find((row) => row.qualifiedName === 'App\\Domain\\Rate.apply');
    expect(apply).toMatchObject({ eligible: false, reason: 'excluido-smoke' });
  });

  it('dos símbolos con la misma identidad son un error del volcado', () => {
    const duplicate = [
      chunk({ filePath: 'src/x.php', symbolKind: 'FUNCTION', symbolName: 'App.f', content: 'function f() {}' }),
      chunk({ filePath: 'src/x.php', symbolKind: 'METHOD', symbolName: 'f', parentSymbolName: 'App', content: 'function f() {}' }),
    ];
    expect(() => buildUniverse(duplicate)).toThrow(/duplicada/);
  });
});

describe('cierre estático de profundidad 1', () => {
  const typeIndex = buildTypeIndex(syntheticChunks());

  it('convert cierra sobre Money (mismo namespace y por import) y Rate (FQCN con \\)', () => {
    const convert = buildUniverse(syntheticChunks()).rows.find((row) => row.qualifiedName === 'App\\Domain\\Converter.convert');
    expect(convert?.closure).toEqual(['App\\Domain\\Money', 'App\\Domain\\Rate']);
  });

  it('apply cierra sobre Money (mismo namespace) y App\\Other\\Thing (import)', () => {
    const apply = buildUniverse(syntheticChunks()).rows.find((row) => row.qualifiedName === 'App\\Domain\\Rate.apply');
    expect(apply?.closure).toEqual(['App\\Domain\\Money', 'App\\Other\\Thing']);
  });

  it('excluye la clase declarante aunque el contenido la mencione', () => {
    const closure = symbolClosure({
      kind: 'METHOD',
      parentSymbolName: 'App\\Domain\\Money',
      importsUsed: [],
      content: 'public function f(Money $m): Money { return new \\App\\Domain\\Money(); }',
    }, typeIndex);
    expect(closure).not.toContain('App\\Domain\\Money');
  });

  it('un import con \\ inicial cuenta igual que sin él (regla a)', () => {
    const closure = symbolClosure({
      kind: 'FUNCTION',
      symbolName: 'App\\Util\\g',
      importsUsed: ['\\App\\Other\\Thing'],
      content: 'function g() { return 1; }',
    }, typeIndex);
    expect(closure).toEqual(['App\\Other\\Thing']);
  });

  it('una mención de nombre corto en otro namespace no cuenta (regla b)', () => {
    const closure = symbolClosure({
      kind: 'FUNCTION',
      symbolName: 'App\\Util\\g',
      importsUsed: [],
      content: 'function g(Money $m) { return $m; }',
    }, typeIndex);
    expect(closure).toEqual([]);
  });

  it('\\FQCN seguido de identificador no coincide: \\App\\Domain\\MoneyBag no cuenta como Money (regla c)', () => {
    const closure = symbolClosure({
      kind: 'FUNCTION',
      symbolName: 'App\\Util\\g',
      importsUsed: [],
      content: 'function g() { return new \\App\\Domain\\MoneyBag(); }',
    }, typeIndex);
    expect(closure).toEqual([]);
  });
});

describe('sorteo (drawSample) y semilla', () => {
  const manyEligible = Array.from({ length: 30 }, (_, index) => {
    const name = `App\\Gen\\fn${String(index).padStart(2, '0')}`;
    return chunk({
      filePath: `src/Gen/fn${String(index).padStart(2, '0')}.php`,
      symbolKind: 'FUNCTION',
      symbolName: name,
      content: `function fn${index}(\\App\\Domain\\Money $m): int\n{\n    return ${index};\n}\n`,
    });
  });
  const eligible = buildUniverse([...syntheticChunks(), ...manyEligible]).eligible;

  it('la misma semilla produce el mismo sorteo; otra semilla, otro orden', () => {
    const first = drawSample(eligible, { seed: 'seed-1', calibration: 3, official: 12, reserve: 3 });
    const again = drawSample(eligible, { seed: 'seed-1', calibration: 3, official: 12, reserve: 3 });
    const other = drawSample(eligible, { seed: 'seed-2', calibration: 3, official: 12, reserve: 3 });
    const keys = (drawn: typeof first) => drawn.rows.map((item) => `${item.row.filePath}::${item.row.qualifiedName}`);
    expect(keys(first)).toEqual(keys(again));
    expect(keys(other)).not.toEqual(keys(first));
  });

  it('asigna roles por posición: calibración, luego oficiales, luego reserva, con orden 1..N', () => {
    const drawn = drawSample(eligible, { seed: 'seed-1', calibration: 3, official: 12, reserve: 3 });
    expect(drawn.rows.map((item) => item.role)).toEqual([
      ...Array(3).fill('calibracion'), ...Array(12).fill('oficial'), ...Array(3).fill('reserva'),
    ]);
    expect(drawn.rows.map((item) => item.order)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
    expect(drawn.warnings).toEqual([]);
  });

  it('con menos elegibles usa todos sin relajar criterios y lo advierte', () => {
    const drawn = drawSample(eligible.slice(0, 4), { seed: 's', calibration: 3, official: 12, reserve: 3 });
    expect(drawn.rows).toHaveLength(4);
    expect(drawn.warnings[0]).toMatch(/solo 4 elegibles/);
  });

  it('documenta las cinco primeras salidas crudas del generador en hexadecimal', () => {
    const drawn = drawSample(eligible, { seed: 'seed-1', calibration: 1, official: 1, reserve: 1 });
    const generator = createMulberry32(seedStateFromText('seed-1'));
    const expected = Array.from({ length: 5 }, () => hex32(generator()));
    expect(drawn.firstRawHex).toEqual(expected);
    expect(drawn.firstRawHex.every((value) => /^[0-9a-f]{8}$/.test(value))).toBe(true);
  });

  it('la semilla es SHA-256 del texto: el estado coincide con sus primeros 32 bits big-endian', () => {
    const digest = createHash('sha256').update('seed-1', 'utf8').digest();
    expect(seedStateFromText('seed-1')).toBe(digest.readUInt32BE(0));
  });
});

describe('readExclusions', () => {
  it('lee filePath::qualifiedName, ignora vacías y comentarios, y rechaza líneas sin formato', async () => {
    const file = path.join(scratch, 'excluir.txt');
    await writeFile(file, '# smoke\nsrc/a.php::App\\A.f\n\nsrc/b.php::App\\B.g\n');
    const excluded = await readExclusions(file);
    expect(excluded.size).toBe(2);
    const bad = path.join(scratch, 'malo.txt');
    await writeFile(bad, 'sin separador\n');
    await expect(readExclusions(bad)).rejects.toThrow(/formato/);
  });
});

describe('runSample (salidas en disco)', () => {
  it('escribe universe.csv, eligible.csv, sample.csv, sample.json, README y el manifiesto con hashes', async () => {
    const dump = path.join(scratch, 'chunks-run.jsonl');
    await writeFile(dump, toJsonl(syntheticChunks()));
    const out = path.join(scratch, 'sample-out');
    const exclude = path.join(scratch, 'excl-run.txt');
    await writeFile(exclude, 'src/Domain/Rate.php::App\\Domain\\Rate.apply\n');
    const result = await runSample({
      options: {
        dump, seed: 'semilla-oe2', calibration: 1, official: 1, reserve: 1, exclude, repo: 'money', out, allowOutInRepo: false,
      },
      cwd: scratch,
      repoRoot: REPO_ROOT,
    });
    expect(result.exitCode).toBe(0);
    const files = (await readdir(out)).sort();
    expect(files).toEqual(expect.arrayContaining([
      'universe.csv', 'eligible.csv', 'sample.csv', 'sample.json', 'README.txt', 'manifest.json', 'hashes.txt', 'manifest.sha256',
    ]));
    const sampleCsv = parseCsv(await readFile(path.join(out, 'sample.csv'), 'utf8'));
    expect(sampleCsv.header).toEqual(['role', 'order', 'repo', 'filePath', 'qualifiedName', 'kind', 'closureSize', 'closureTypes']);
    expect(sampleCsv.rows.every((row) => row.repo === 'money')).toBe(true);
    expect(sampleCsv.rows.map((row) => `${row.filePath}::${row.qualifiedName}`)).not.toContain('src/Domain/Rate.php::App\\Domain\\Rate.apply');
    const universeCsv = parseCsv(await readFile(path.join(out, 'universe.csv'), 'utf8'));
    expect(universeCsv.rows.find((row) => row.qualifiedName === 'App\\Domain\\Rate.apply')?.reason).toBe('excluido-smoke');
    const sampleJson = JSON.parse(await readFile(path.join(out, 'sample.json'), 'utf8'));
    expect(sampleJson.firstRawOutputsHex).toHaveLength(5);
    expect(sampleJson.inputs.chunksJsonlSha256).toBe(createHash('sha256').update(await readFile(dump)).digest('hex'));
    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
    for (const entry of manifest.files) {
      const bytes = await readFile(path.join(out, entry.path));
      expect(createHash('sha256').update(bytes).digest('hex'), entry.path).toBe(entry.sha256);
    }
  });

  it('rechaza una salida no vacía y una salida dentro del repositorio sin permiso', async () => {
    const dump = path.join(scratch, 'chunks-run.jsonl');
    const busy = path.join(scratch, 'busy');
    await mkdir(busy, { recursive: true });
    await writeFile(path.join(busy, 'algo.txt'), 'x');
    await expect(runSample({
      options: { dump, seed: 's', calibration: 1, official: 1, reserve: 1, out: busy, allowOutInRepo: false },
      cwd: scratch,
      repoRoot: REPO_ROOT,
    })).rejects.toThrow(/no está vacía/);
    await expect(runSample({
      options: { dump, seed: 's', calibration: 1, official: 1, reserve: 1, out: path.join(REPO_ROOT, 'tmp-oe2-x'), allowOutInRepo: false },
      cwd: scratch,
      repoRoot: REPO_ROOT,
    })).rejects.toThrow(/dentro del repositorio/);
  });
});

// M-2: golden del sorteo y del orden por unidades de código. Los órdenes esperados están fijados a mano; se calcularon
// con una implementación independiente (Python: mulberry32 sobre SHA-256 big-endian y Fisher–Yates descendente).
describe('golden del sorteo y de la ordenación por unidades de código (M-2)', () => {
  const FILES = ['src/Beta.php', 'src/Zeta.php', 'src/alpha.php', 'src/beta.php', 'src/Émile.php'];

  function goldenChunks() {
    const money = chunk({ filePath: 'src/Domain/Money.php', symbolKind: 'CLASS', symbolName: 'App\\Domain\\Money', content: 'final class Money {}\n' });
    const functions = FILES.map((filePath, index) => chunk({
      filePath,
      symbolKind: 'FUNCTION',
      symbolName: `App\\Gold${index}\\f`,
      content: 'function f(\\App\\Domain\\Money $m): int\n{\n    return 1;\n}\n',
    }));
    return [money, ...functions];
  }

  it('los elegibles se ordenan por unidades de código, que difiere de localeCompare', () => {
    const universe = buildUniverse(goldenChunks());
    const codeUnitOrder = ['src/Beta.php', 'src/Zeta.php', 'src/alpha.php', 'src/beta.php', 'src/Émile.php'];
    expect(universe.eligible.map((row) => row.filePath)).toEqual(codeUnitOrder);
    const localeOrder = [...FILES].sort((a, b) => a.localeCompare(b));
    expect(localeOrder).not.toEqual(codeUnitOrder);
  });

  it('el sorteo descendente con semilla fija produce el orden fijado a mano', () => {
    const drawn = drawSample(buildUniverse(goldenChunks()).eligible, { seed: 'golden-muestra', calibration: 5, official: 0, reserve: 0 });
    expect(drawn.rows.map((item) => item.row.filePath)).toEqual(['src/alpha.php', 'src/Émile.php', 'src/Beta.php', 'src/beta.php', 'src/Zeta.php']);
  });

  it('el barajado ascendente daría otro orden (la prueba distingue el algoritmo)', () => {
    const items = ['src/Beta.php', 'src/Zeta.php', 'src/alpha.php', 'src/beta.php', 'src/Émile.php'];
    const forward = [...items];
    const generator = createMulberry32(seedStateFromText('golden-muestra'));
    const n = forward.length;
    for (let i = 0; i < n - 1; i += 1) {
      const j = i + Math.floor((generator() / 4294967296) * (n - i));
      [forward[i], forward[j]] = [forward[j], forward[i]];
    }
    expect(forward).toEqual(['src/Zeta.php', 'src/Émile.php', 'src/alpha.php', 'src/Beta.php', 'src/beta.php']);
    const descending = drawSample(buildUniverse(goldenChunks()).eligible, { seed: 'golden-muestra', calibration: 5, official: 0, reserve: 0 });
    expect(descending.rows.map((item) => item.row.filePath)).not.toEqual(forward);
  });
});
