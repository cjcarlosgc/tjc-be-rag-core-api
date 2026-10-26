// WI-CORE-105 (C3): baseline sobre el conjunto del snapshot, con un checkout temporal REAL (sin git ni red).
import { spawnSync } from 'node:child_process';
import nodeFs, { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatBaselineSummary,
  parseBaselineArguments,
  runBaselineWorkspace,
  validateSnapshotManifest,
} from './baseline-workspace.mjs';
import { UsageError } from './options.mjs';
import { sha256Hex } from './util.mjs';

const SCRIPT = fileURLToPath(new URL('../baseline-workspace.mjs', import.meta.url));
const SECRET_MARKER = 'CONTENIDO-SECRETO-NO-IMPRIMIR';

let scratch: string;
let repoRoot: string;
let counter = 0;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'baseline-workspace-'));
  repoRoot = path.join(scratch, 'repo');
  await mkdir(path.join(repoRoot, 'app'), { recursive: true });
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

type Files = Record<string, string>;

async function newCase(files: Files) {
  counter += 1;
  const base = path.join(scratch, `case-${counter}`);
  const checkout = path.join(base, 'checkout');
  await mkdir(checkout, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(checkout, name)), { recursive: true });
    await writeFile(path.join(checkout, name), content);
  }
  return { base, checkout, out: path.join(base, 'out'), manifestPath: path.join(base, 'snapshot-manifest.json') };
}

function entryFor(name: string, content: string) {
  return { path: name, bytes: Buffer.byteLength(content), sha256: sha256Hex(Buffer.from(content)) };
}

async function writeManifest(file: string, entries: unknown[], overrides: Record<string, unknown> = {}) {
  await writeFile(file, JSON.stringify({ schema: 'snapshot-manifest', schemaVersion: 1, entries, ...overrides }));
}

async function run(c: { checkout: string; out: string; manifestPath: string }, extra: Partial<{ allowOutInRepo: boolean; fs: unknown; out: string; checkout: string }> = {}) {
  return runBaselineWorkspace({
    options: { help: false, checkout: extra.checkout ?? c.checkout, manifest: c.manifestPath, out: extra.out ?? c.out, allowOutInRepo: extra.allowOutInRepo ?? false },
    cwd: scratch,
    repoRoot,
    ...(extra.fs ? { fs: extra.fs as typeof nodeFs } : {}),
  });
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await listFiles(path.join(dir, entry.name), relative)));
    else found.push(relative);
  }
  return found.sort();
}

describe('runBaselineWorkspace', () => {
  it('copia con los mismos bytes los archivos cuyo SHA-256 coincide y sale con 0', async () => {
    const files = { 'src/Money.php': '<?php\nclass Money {}\n', 'examples/rbac_model.conf': '[request_definition]\r\nr = sub\r\n', 'composer.json': '{}\n' };
    const c = await newCase({ ...files, 'extra-no-listado.txt': 'no va' });
    await writeManifest(c.manifestPath, Object.entries(files).map(([name, content]) => entryFor(name, content)));
    const result = await run(c);
    expect(result.exitCode).toBe(0);
    expect(result.counts).toMatchObject({ entries: 3, copied: 3, missing: 0, different: 0, skipped: 0, rejected: 0 });
    expect(await listFiles(c.out)).toEqual(['composer.json', 'examples/rbac_model.conf', 'src/Money.php']);
    for (const [name, content] of Object.entries(files)) {
      expect((await readFile(path.join(c.out, name))).equals(Buffer.from(content))).toBe(true);
    }
  });

  it('un archivo faltante se cuenta, no se copia y el código de salida es 1', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a'), entryFor('falta.conf', 'x')]);
    const result = await run(c);
    expect(result.exitCode).toBe(1);
    expect(result.counts).toMatchObject({ copied: 1, missing: 1 });
    expect(result.problems).toContainEqual({ path: 'falta.conf', status: 'missing' });
    expect(await listFiles(c.out)).toEqual(['a.php']);
  });

  it('un archivo distinto (mismo tamaño o no) se cuenta, NO se copia y el código de salida es 1', async () => {
    const c = await newCase({ 'a.php': 'AAAA', 'b.php': 'bbb' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'aaaa'), entryFor('b.php', 'bbbbbb')]);
    const result = await run(c);
    expect(result.exitCode).toBe(1);
    expect(result.counts).toMatchObject({ copied: 0, different: 2 });
    expect(await listFiles(c.out)).toEqual([]);
  });

  it('con el mismo tamaño pero distinto contenido compara el SHA-256 y no copia', async () => {
    const c = await newCase({ 'a.php': 'AAAA' });
    await writeManifest(c.manifestPath, [{ path: 'a.php', bytes: 4, sha256: sha256Hex(Buffer.from('aaaa')) }]);
    const result = await run(c);
    expect(result.counts.different).toBe(1);
    expect(result.problems[0].note).toMatch(/SHA-256/);
    expect(await listFiles(c.out)).toEqual([]);
  });

  it('una entrada con sha256 null se omite (aunque exista en el checkout); el manifiesto es parcial y el código es 1', async () => {
    const c = await newCase({ 'a.php': 'a', 'grande.bin': 'x'.repeat(10) });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a'), { path: 'grande.bin', bytes: 99999999, sha256: null }]);
    const result = await run(c);
    expect(result.exitCode).toBe(1);
    expect(result.counts).toMatchObject({ copied: 1, skipped: 1 });
    expect(result.partial).toMatchObject({ isPartial: true, nullSha256: 1, skipped: 0, empty: false });
    expect(await listFiles(c.out)).toEqual(['a.php']);
    const text = formatBaselineSummary(result);
    expect(text).toContain('1 entradas sin sha256');
    expect(text).toContain('⛔ manifiesto parcial o vacío');
    expect(text).not.toContain('✅');
  });

  it('rechaza un enlace simbólico que apunta fuera del checkout y no copia su contenido', async () => {
    const c = await newCase({ 'a.php': 'a' });
    const outside = path.join(c.base, 'fuera.txt');
    await writeFile(outside, SECRET_MARKER);
    await symlink(outside, path.join(c.checkout, 'enlace.txt'));
    await mkdir(path.join(c.base, 'dir-fuera'), { recursive: true });
    await writeFile(path.join(c.base, 'dir-fuera', 'secreto.txt'), SECRET_MARKER);
    await symlink(path.join(c.base, 'dir-fuera'), path.join(c.checkout, 'dir-enlace'));
    await writeManifest(c.manifestPath, [
      entryFor('a.php', 'a'),
      entryFor('enlace.txt', SECRET_MARKER),
      entryFor('dir-enlace/secreto.txt', SECRET_MARKER),
    ]);
    const result = await run(c);
    expect(result.exitCode).toBe(1);
    expect(result.counts).toMatchObject({ copied: 1, rejected: 2 });
    expect(await listFiles(c.out)).toEqual(['a.php']);
    expect(formatBaselineSummary(result)).not.toContain(SECRET_MARKER);
  });

  it('un enlace simbólico que apunta dentro del checkout se resuelve y solo se copia si el hash coincide', async () => {
    const c = await newCase({ 'real.php': 'real' });
    await symlink(path.join(c.checkout, 'real.php'), path.join(c.checkout, 'alias.php'));
    await writeManifest(c.manifestPath, [entryFor('alias.php', 'real'), entryFor('real.php', 'real')]);
    const result = await run(c);
    expect(result.counts.copied).toBe(2);
    expect(await listFiles(c.out)).toEqual(['alias.php', 'real.php']);
  });

  it('un directorio donde el manifiesto espera un archivo cuenta como distinto', async () => {
    const c = await newCase({ 'src/a.php': 'a' });
    await writeManifest(c.manifestPath, [{ path: 'src', bytes: 1, sha256: sha256Hex(Buffer.from('a')) }]);
    const result = await run(c);
    expect(result.counts.different).toBe(1);
  });

  it('el resumen muestra recuentos y rutas, nunca contenido de archivos', async () => {
    const c = await newCase({ 'a.php': SECRET_MARKER, 'b.php': `${SECRET_MARKER}!` });
    await writeManifest(c.manifestPath, [entryFor('a.php', SECRET_MARKER), entryFor('b.php', SECRET_MARKER)]);
    const text = formatBaselineSummary(await run(c));
    expect(text).toContain('copiados (SHA-256 coincide): 1');
    expect(text).toContain('distintos (no se copian):    1');
    expect(text).toContain('b.php');
    expect(text).not.toContain(SECRET_MARKER);
  });

  it('solo escribe dentro de --out y no modifica el checkout', async () => {
    const c = await newCase({ 'a/b.php': 'b' });
    await writeManifest(c.manifestPath, [entryFor('a/b.php', 'b')]);
    const writes: string[] = [];
    const recordingFs = {
      ...nodeFs,
      writeFile: (target: string, ...rest: unknown[]) => {
        writes.push(String(target));
        return (nodeFs.writeFile as (...args: unknown[]) => Promise<void>)(target, ...rest);
      },
    };
    const before = await listFiles(c.checkout);
    await run(c, { fs: recordingFs });
    expect(writes).toEqual([path.join(c.out, 'a', 'b.php')]);
    expect(await listFiles(c.checkout)).toEqual(before);
  });
});

describe('manifiesto parcial o vacío (H1)', () => {
  it('con skipped no vacío copia lo que coincide, informa recuentos y motivos y sale con 1', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a')], {
      skipped: [{ path: 'x', reason: 'unsafe_path' }, { path: 'y', reason: 'unsafe_path' }, { path: 'z', reason: 'total_too_large' }],
    });
    const result = await run(c);
    expect(result.exitCode).toBe(1);
    expect(result.counts.copied).toBe(1);
    expect(await listFiles(c.out)).toEqual(['a.php']);
    expect(result.partial).toMatchObject({ isPartial: true, skipped: 3, skippedReasons: { total_too_large: 1, unsafe_path: 2 } });
    const text = formatBaselineSummary(result);
    expect(text).toContain('3 omitidas en el manifiesto (total_too_large: 1, unsafe_path: 2)');
    expect(text).toContain('⛔ manifiesto parcial o vacío: la baseline no cubre todo lo que recibió el Sandbox');
    expect(text).not.toContain('✅');
  });

  it('con entries vacío es ⛔ y sale con 1', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, []);
    const result = await run(c);
    expect(result.exitCode).toBe(1);
    expect(result.partial).toMatchObject({ isPartial: true, empty: true });
    expect(formatBaselineSummary(result)).toContain('entries vacío');
    expect(await listFiles(c.out)).toEqual([]);
  });

  it('un manifiesto completo (skipped vacío, todo con sha256) y coincidente sale con 0 y ✅', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a')], { skipped: [] });
    const result = await run(c);
    expect(result.exitCode).toBe(0);
    expect(result.partial.isPartial).toBe(false);
    expect(formatBaselineSummary(result)).toContain('✅ todo coincide con el manifiesto completo');
  });

  it('parcial y con distintos a la vez: el mensaje lo menciona', async () => {
    const c = await newCase({ 'a.php': 'AAAA' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'aaaa')], { skipped: [{ path: 'x', reason: 'too_large' }] });
    const text = formatBaselineSummary(await run(c));
    expect(text).toContain('Además hay faltantes, distintos o rechazados');
  });

  it('rechaza un skipped que no es una lista', async () => {
    const c = await newCase({});
    await writeManifest(c.manifestPath, [], { skipped: 'no' });
    await expect(run(c)).rejects.toThrow(/skipped/);
  });

  it('el resumen no imprime rutas de skipped, solo motivos seguros', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a')], { skipped: [{ path: SECRET_MARKER, reason: `${SECRET_MARKER} con espacios` }] });
    const text = formatBaselineSummary(await run(c));
    expect(text).not.toContain(SECRET_MARKER);
    expect(text).toContain('(sin motivo): 1');
  });
});

describe('rutas con segmento "." y colisiones (H3)', () => {
  it('x.php y ./x.php en el mismo manifiesto: uso inválido, sin EEXIST y sin crear --out', async () => {
    const c = await newCase({ 'x.php': 'x' });
    await writeManifest(c.manifestPath, [entryFor('x.php', 'x'), entryFor('./x.php', 'x')]);
    await expect(run(c)).rejects.toThrow(UsageError);
    await expect(readdir(c.out)).rejects.toThrow();
  });

  it.each(['./x.php', 'a/./b.php', 'a/.'])('rechaza la ruta %s del manifiesto', (name) => {
    expect(() => validateSnapshotManifest({ schema: 'snapshot-manifest', schemaVersion: 1, entries: [{ path: name, sha256: 'a'.repeat(64) }] })).toThrow(UsageError);
  });

  it('una colisión de escritura (EEXIST) se registra, no aborta y el código es 1; wx nunca sobrescribe', async () => {
    const c = await newCase({ 'a.php': 'a', 'b.php': 'b' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a'), entryFor('b.php', 'b')]);
    let writes = 0;
    const collidingFs = {
      ...nodeFs,
      writeFile: (target: string, data: unknown, options: unknown) => {
        writes += 1;
        if (writes === 2) throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
        return (nodeFs.writeFile as (...args: unknown[]) => Promise<void>)(target, data, options);
      },
    };
    const result = await run(c, { fs: collidingFs });
    expect(result.exitCode).toBe(1);
    expect(result.counts).toMatchObject({ copied: 1, rejected: 1 });
    expect(result.problems[0]).toMatchObject({ path: 'b.php', status: 'rejected' });
    expect(result.problems[0].note).toMatch(/colisión/);
    expect(await listFiles(c.out)).toEqual(['a.php']);
  });
});

describe('garantías de lectura y escritura (H5)', () => {
  it('compara el tamaño con el del manifiesto ANTES de leer el archivo del checkout', async () => {
    const c = await newCase({ 'a.php': 'AAAAAAAA', 'b.php': 'bbbb' });
    await writeManifest(c.manifestPath, [{ path: 'a.php', bytes: 4, sha256: sha256Hex(Buffer.from('aaaa')) }, entryFor('b.php', 'bbbb')]);
    const reads: string[] = [];
    const spyFs = {
      ...nodeFs,
      readFile: (target: string, ...rest: unknown[]) => {
        reads.push(String(target));
        return (nodeFs.readFile as (...args: unknown[]) => Promise<unknown>)(target, ...rest);
      },
    };
    const result = await run(c, { fs: spyFs });
    expect(result.problems).toContainEqual({ path: 'a.php', status: 'different', note: 'el tamaño no coincide con el manifiesto' });
    expect(reads.filter((file) => file.endsWith(`${path.sep}a.php`))).toEqual([]);
    expect(reads.filter((file) => file.endsWith(`${path.sep}b.php`))).toHaveLength(1);
  });

  it('escribe con la bandera wx y modos 0644 (archivos) y 0755 (carpetas)', async () => {
    const c = await newCase({ 'src/a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('src/a.php', 'a')]);
    const writes: { flag?: string; mode?: number }[] = [];
    const mkdirs: { mode?: number }[] = [];
    const spyFs = {
      ...nodeFs,
      writeFile: (target: string, data: unknown, options: { flag?: string; mode?: number }) => {
        writes.push(options);
        return (nodeFs.writeFile as (...args: unknown[]) => Promise<void>)(target, data, options);
      },
      mkdir: (target: string, options: { mode?: number }) => {
        mkdirs.push(options);
        return (nodeFs.mkdir as (...args: unknown[]) => Promise<unknown>)(target, options);
      },
    };
    await run(c, { fs: spyFs });
    expect(writes).toEqual([{ flag: 'wx', mode: 0o644 }]);
    expect(mkdirs.length).toBeGreaterThan(0);
    expect(mkdirs.every((options) => options.mode === 0o755)).toBe(true);
    // Con el sistema de archivos real: modo efectivo = modo pedido filtrado por el umask del proceso.
    const umask = process.umask();
    expect((await stat(path.join(c.out, 'src', 'a.php'))).mode & 0o777).toBe(0o644 & ~umask);
    expect((await stat(path.join(c.out, 'src'))).mode & 0o777).toBe(0o755 & ~umask);
  });
});

describe('validación del manifiesto', () => {
  const base = { schema: 'snapshot-manifest', schemaVersion: 1 };
  const goodSha = 'a'.repeat(64);

  it.each([
    ['no es un objeto', []],
    ['schema distinto', { ...base, schema: 'otro', entries: [] }],
    ['schemaVersion distinta', { ...base, schemaVersion: 2, entries: [] }],
    ['sin entries', { ...base }],
    ['ruta con ..', { ...base, entries: [{ path: '../x.php', sha256: goodSha }] }],
    ['ruta absoluta', { ...base, entries: [{ path: '/etc/passwd', sha256: goodSha }] }],
    ['ruta con barra invertida', { ...base, entries: [{ path: 'a\\b.php', sha256: goodSha }] }],
    ['ruta vacía', { ...base, entries: [{ path: '', sha256: goodSha }] }],
    ['sha256 corto', { ...base, entries: [{ path: 'a.php', sha256: 'abc' }] }],
    ['sha256 en mayúsculas', { ...base, entries: [{ path: 'a.php', sha256: 'A'.repeat(64) }] }],
    ['sha256 ausente', { ...base, entries: [{ path: 'a.php' }] }],
    ['bytes negativo', { ...base, entries: [{ path: 'a.php', bytes: -1, sha256: goodSha }] }],
    ['ruta repetida', { ...base, entries: [{ path: 'a.php', sha256: goodSha }, { path: 'a.php', sha256: goodSha }] }],
    ['entrada que no es objeto', { ...base, entries: ['a.php'] }],
  ])('rechaza un manifiesto: %s', (_name, manifest) => {
    expect(() => validateSnapshotManifest(manifest)).toThrow(UsageError);
  });

  it('acepta entradas con sha256 null y devuelve la lista', () => {
    const entries = validateSnapshotManifest({ ...base, entries: [{ path: 'a.php', bytes: 1, sha256: goodSha }, { path: 'b.bin', bytes: 20_000_000, sha256: null }] });
    expect(entries).toHaveLength(2);
  });

  it('un archivo de manifiesto ilegible o que no es JSON lanza UsageError sin repetir su contenido', async () => {
    const c = await newCase({});
    await writeFile(c.manifestPath, `{ no es json ${SECRET_MARKER}`);
    await expect(run(c)).rejects.toThrow(UsageError);
    await expect(run(c)).rejects.not.toThrow(new RegExp(SECRET_MARKER));
    await rm(c.manifestPath);
    await expect(run(c)).rejects.toThrow(/--manifest/);
  });
});

describe('validación de --checkout y --out', () => {
  it('rechaza un checkout inexistente', async () => {
    const c = await newCase({});
    await writeManifest(c.manifestPath, []);
    await expect(run(c, { checkout: path.join(c.base, 'no-existe') })).rejects.toThrow(/--checkout/);
  });

  it('rechaza una --out que ya existe y no está vacía, sin tocarla', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a')]);
    await mkdir(c.out, { recursive: true });
    await writeFile(path.join(c.out, 'previo.txt'), 'previo');
    await expect(run(c)).rejects.toThrow(/no está vacía/);
    expect(await listFiles(c.out)).toEqual(['previo.txt']);
  });

  it('acepta una --out existente y vacía', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a')]);
    await mkdir(c.out, { recursive: true });
    expect((await run(c)).counts.copied).toBe(1);
  });

  it('rechaza una --out dentro del checkout, igual al checkout o que lo contiene', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a')]);
    await expect(run(c, { out: path.join(c.checkout, 'salida') })).rejects.toThrow(/checkout/);
    await expect(run(c, { out: c.checkout })).rejects.toThrow(/checkout/);
    await expect(run(c, { out: c.base })).rejects.toThrow(/contener el checkout/);
    expect(await listFiles(c.checkout)).toEqual(['a.php']);
  });

  it('rechaza una --out dentro del repositorio salvo --allow-out-in-repo', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a')]);
    const inRepo = path.join(repoRoot, 'baseline-salida');
    await expect(run(c, { out: inRepo })).rejects.toThrow(/dentro del repositorio/);
    await expect(readdir(inRepo)).rejects.toThrow();
    expect((await run(c, { out: inRepo, allowOutInRepo: true })).counts.copied).toBe(1);
  });

  it('rechaza una --out que atraviesa un enlace simbólico hacia el checkout', async () => {
    const c = await newCase({ 'a.php': 'a' });
    await writeManifest(c.manifestPath, [entryFor('a.php', 'a')]);
    const link = path.join(c.base, 'enlace-a-checkout');
    await symlink(c.checkout, link);
    await expect(run(c, { out: path.join(link, 'salida') })).rejects.toThrow(/checkout/);
  });
});

describe('parseBaselineArguments', () => {
  it('lee las tres opciones obligatorias y --allow-out-in-repo', () => {
    expect(parseBaselineArguments(['--checkout', 'c', '--manifest', 'm.json', '--out', 'o', '--allow-out-in-repo'])).toEqual({
      help: false, checkout: 'c', manifest: 'm.json', out: 'o', allowOutInRepo: true,
    });
  });

  it('exige las opciones, sus valores y no repite argumentos desconocidos', () => {
    expect(() => parseBaselineArguments(['--checkout', 'c', '--manifest', 'm'])).toThrow(/falta --out/);
    expect(() => parseBaselineArguments(['--checkout'])).toThrow(/necesita un valor/);
    expect(() => parseBaselineArguments(['--checkout', ' ', '--manifest', 'm', '--out', 'o'])).toThrow(/vacío/);
    expect(() => parseBaselineArguments([`--${SECRET_MARKER}`])).toThrow(/desconocido/);
    expect(() => parseBaselineArguments([`--${SECRET_MARKER}`])).not.toThrow(new RegExp(SECRET_MARKER));
    expect(parseBaselineArguments(['--help']).help).toBe(true);
  });
});

describe('CLI baseline-workspace (proceso real)', () => {
  function cli(args: string[]) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 60_000 });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  it('sale con 0 si todo coincide, con 1 si hay un distinto y con 2 por uso incorrecto', async () => {
    const ok = await newCase({ 'a.php': 'a' });
    await writeManifest(ok.manifestPath, [entryFor('a.php', 'a')]);
    const good = cli(['--checkout', ok.checkout, '--manifest', ok.manifestPath, '--out', ok.out]);
    expect(good.status).toBe(0);
    expect(good.output).toContain('copiados (SHA-256 coincide): 1');

    const bad = await newCase({ 'a.php': 'distinto' });
    await writeManifest(bad.manifestPath, [entryFor('a.php', 'a')]);
    const different = cli(['--checkout', bad.checkout, '--manifest', bad.manifestPath, '--out', bad.out]);
    expect(different.status).toBe(1);
    expect(different.output).toContain('⛔');

    const usage = cli(['--checkout', ok.checkout]);
    expect(usage.status).toBe(2);
    expect(cli(['--help']).status).toBe(0);
  });
});
