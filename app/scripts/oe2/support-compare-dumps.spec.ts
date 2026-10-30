// WI-CORE-107: pruebas de `support-files` (el checkout no cambia; `?>`; rutas seguras) y de `compare-dumps`
// (iguales, solo A, solo B, distintos; código de salida). Fixtures sintéticos en carpetas temporales.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSupportContent, runSupportFiles, supportFilesFromSample, SUPPORT_MARKER } from './support-files.mjs';
import { compareChunkSets, runCompareDumps } from './compare-dumps.mjs';
import { chunk, toJsonl } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..');
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'oe2-support-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('buildSupportContent', () => {
  it('añade la marca tras el último carácter, con salto final', () => {
    const { text } = buildSupportContent('<?php\nclass A {}\n', 'a.php');
    expect(text).toBe(`<?php\nclass A {}\n${SUPPORT_MARKER}\n`);
  });

  it('añade el salto que falta antes de la marca si el archivo no termina en salto', () => {
    expect(buildSupportContent('class A {}', 'a.php').text).toBe(`class A {}\n${SUPPORT_MARKER}\n`);
  });

  it('respeta CRLF del propio archivo y funciona con un archivo vacío', () => {
    expect(buildSupportContent('class A {}\r\n', 'a.php').text).toBe(`class A {}\r\n${SUPPORT_MARKER}\r\n`);
    expect(buildSupportContent('', 'empty.php').text).toBe(`${SUPPORT_MARKER}\n`);
  });

  it('rechaza ?> porque cerraría el modo PHP', () => {
    expect(() => buildSupportContent('<?php\nclass A {} ?>\n', 'a.php')).toThrow(/"\?>"/);
  });

  it('avisa si el archivo no termina en } ni en ;', () => {
    expect(buildSupportContent('class A {} // fin', 'a.php').warnings).toEqual(['el archivo no termina en "}" ni en ";"']);
    expect(buildSupportContent('class A {}\n', 'a.php').warnings).toEqual([]);
  });
});

describe('supportFilesFromSample', () => {
  it('toma las rutas únicas del sample y rechaza rutas no seguras', () => {
    const csv = 'role,order,repo,filePath,qualifiedName,kind,closureSize,closureTypes\n'
      + 'oficial,1,m,src/B.php,X.b,METHOD,1,A\noficial,2,m,src/A.php,X.a,METHOD,0,\noficial,3,m,src/B.php,X.c,METHOD,0,\n';
    expect(supportFilesFromSample(csv)).toEqual(['src/A.php', 'src/B.php']);
    expect(() => supportFilesFromSample('role,order,repo,filePath,qualifiedName,kind,closureSize,closureTypes\nx,1,m,../evil.php,X,METHOD,0,\n'))
      .toThrow(/insegura/);
  });
});

describe('runSupportFiles', () => {
  async function makeCheckout(name: string, files: Record<string, string>) {
    const root = path.join(scratch, name, 'checkout');
    for (const [relative, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await writeFile(path.join(root, relative), content);
    }
    const sample = path.join(scratch, name, 'sample.csv');
    const rows = Object.keys(files).map((relative, index) => `oficial,${index + 1},m,${relative},X.f${index},METHOD,0,`);
    await writeFile(sample, `role,order,repo,filePath,qualifiedName,kind,closureSize,closureTypes\n${rows.join('\n')}\n`);
    return { root, sample };
  }

  it('escribe las copias con la marca y no modifica el checkout', async () => {
    const original = { 'src/A.php': '<?php\nclass A {}\n', 'src/B.php': 'class B {}' };
    const { root, sample } = await makeCheckout('ok', original);
    const out = path.join(scratch, 'ok', 'out');
    const result = await runSupportFiles({
      options: { sample, checkout: root, out, allowOutInRepo: false },
      cwd: scratch,
      repoRoot: REPO_ROOT,
    });
    expect(result.exitCode).toBe(0);
    expect(await readFile(path.join(out, 'src', 'A.php'), 'utf8')).toBe(`<?php\nclass A {}\n${SUPPORT_MARKER}\n`);
    expect(await readFile(path.join(out, 'src', 'B.php'), 'utf8')).toBe(`class B {}\n${SUPPORT_MARKER}\n`);
    for (const [relative, content] of Object.entries(original)) {
      expect(await readFile(path.join(root, relative), 'utf8')).toBe(content);
    }
    const manifest = JSON.parse(await readFile(path.join(out, 'support-manifest.json'), 'utf8'));
    const record = manifest.files.find((file: { filePath: string }) => file.filePath === 'src/B.php');
    expect(record.sha256Before).toBe(sha(original['src/B.php']));
    expect(record.sha256Supported).toBe(sha(`class B {}\n${SUPPORT_MARKER}\n`));
    expect(record.sha256After).toBe(record.sha256Before);
    expect(record.unchanged).toBe(true);
  });

  it('un archivo con ?> aborta y no deja salida', async () => {
    const { root, sample } = await makeCheckout('bad', { 'src/C.php': '<?php ?>' });
    const out = path.join(scratch, 'bad', 'out');
    await expect(runSupportFiles({ options: { sample, checkout: root, out, allowOutInRepo: false }, cwd: scratch, repoRoot: REPO_ROOT }))
      .rejects.toThrow(/"\?>"/);
    await expect(readdir(out)).rejects.toThrow();
  });

  it('no permite --out dentro del checkout', async () => {
    const { root, sample } = await makeCheckout('inside', { 'src/D.php': 'class D {}\n' });
    await expect(runSupportFiles({
      options: { sample, checkout: root, out: path.join(root, 'salida'), allowOutInRepo: false },
      cwd: scratch,
      repoRoot: REPO_ROOT,
    })).rejects.toThrow(/dentro del checkout/);
  });
});

describe('compareChunkSets', () => {
  const base = [
    chunk({ filePath: 'a.php', symbolKind: 'FUNCTION', symbolName: 'A\\f', content: 'function f() {}' }),
    chunk({ filePath: 'b.php', symbolKind: 'METHOD', symbolName: 'g', parentSymbolName: 'B', content: 'function g() {}' }),
  ];

  it('iguales cuando los dos volcados tienen los mismos hashes', () => {
    const result = compareChunkSets(base, [...base].reverse());
    expect(result.identical).toBe(true);
    expect(result.counts).toMatchObject({ equal: 2, different: 0, onlyA: 0, onlyB: 0 });
  });

  it('detecta contenido distinto, chunks solo en A y solo en B', () => {
    const changed = chunk({ filePath: 'b.php', symbolKind: 'METHOD', symbolName: 'g', parentSymbolName: 'B', content: 'function g() { return 1; }' });
    const extra = chunk({ filePath: 'c.php', symbolKind: 'FUNCTION', symbolName: 'C\\h', content: 'function h() {}' });
    const result = compareChunkSets(base, [base[0], changed, extra]);
    expect(result.identical).toBe(false);
    expect(result.counts).toMatchObject({ equal: 1, different: 1, onlyA: 0, onlyB: 1 });
    expect(result.different[0].key).toMatch(/"b\.php"/);
    const onlyA = compareChunkSets([...base, extra], [base[0]]);
    expect(onlyA.counts.onlyA).toBe(2);
  });

  it('distingue ocurrencias repetidas de la misma clave por hash, sin perderlas', () => {
    const first = chunk({ filePath: 'd.php', symbolKind: 'FUNCTION', symbolName: 'D\\f', content: 'a' });
    const second = chunk({ filePath: 'd.php', symbolKind: 'FUNCTION', symbolName: 'D\\f', content: 'b' });
    expect(compareChunkSets([first, second], [first, second]).identical).toBe(true);
    expect(compareChunkSets([first, second], [first]).counts.onlyA).toBe(1);
  });
});

describe('runCompareDumps', () => {
  it('sale con 0 si son idénticos y con 1 si difieren; escribe el informe si hay --out', async () => {
    const dir = path.join(scratch, 'cmp');
    await mkdir(dir, { recursive: true });
    const a = path.join(dir, 'a.jsonl');
    const b = path.join(dir, 'b.jsonl');
    const c = path.join(dir, 'c.jsonl');
    const one = chunk({ filePath: 'x.php', symbolKind: 'FUNCTION', symbolName: 'X\\f', content: 'function f() {}' });
    const two = chunk({ filePath: 'x.php', symbolKind: 'FUNCTION', symbolName: 'X\\f', content: 'function f() { }' });
    await writeFile(a, toJsonl([one]));
    await writeFile(b, toJsonl([one]));
    await writeFile(c, toJsonl([two]));
    const same = await runCompareDumps({ options: { a, b, out: null, allowOutInRepo: false }, cwd: dir, repoRoot: REPO_ROOT });
    expect(same.exitCode).toBe(0);
    const out = path.join(dir, 'informe');
    const diff = await runCompareDumps({ options: { a, b: c, out, allowOutInRepo: false }, cwd: dir, repoRoot: REPO_ROOT });
    expect(diff.exitCode).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'comparacion.json'), 'utf8'));
    expect(report.identical).toBe(false);
    expect(report.counts.different).toBe(1);
  });
});
