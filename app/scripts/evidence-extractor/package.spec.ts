// WI-CORE-094: estructura del paquete, manifiesto con SHA-256 reproducibles, validación de la carpeta de salida y
// escritura sin sobrescribir. Usa directorios temporales del sistema operativo solo en las pruebas que escriben.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PackagePlan, finalizePackage, resolveOutputDir, writePackageFiles, assertSafePackagePath } from './package.mjs';
import { sha256Hex } from './util.mjs';
import { UsageError } from './options.mjs';

let scratch: string;
let repoRoot: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'extract-evidence-test-'));
  repoRoot = path.join(scratch, 'repo');
  await mkdir(path.join(repoRoot, 'app', 'scripts'), { recursive: true });
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function buildPlan() {
  const plan = new PackagePlan();
  plan.addText('experiment.json', '{"a":1}\n');
  plan.addBytes('tests/RAG/1-1.php', Buffer.from('<?php\n', 'utf8'));
  plan.addText('repetitions.csv', 'a,b\n1,2\n');
  plan.absence('prompt completo', 'no persistido', 'global');
  plan.truncation('testContent RAG/1/1', 'truncado', 'tests/RAG/1-1.php');
  return plan;
}

describe('PackagePlan y finalizePackage', () => {
  it('lista cada archivo con su tamaño y SHA-256 y genera hashes.txt en formato sha256sum', () => {
    const plan = buildPlan();
    const entries = finalizePackage(plan, (files) => ({ files, absences: plan.absences, truncations: plan.truncations }));
    const paths = entries.map((entry) => entry.path);
    expect(paths).toEqual(['experiment.json', 'hashes.txt', 'manifest.json', 'manifest.sha256', 'repetitions.csv', 'tests/RAG/1-1.php']);

    const hashes = entries.find((entry) => entry.path === 'hashes.txt')!.bytes.toString('utf8');
    expect(hashes).toContain(`${sha256Hex(Buffer.from('{"a":1}\n', 'utf8'))}  experiment.json\n`);
    expect(hashes).not.toContain('manifest.json');
    expect(hashes).not.toContain('hashes.txt');
  });

  it('el manifiesto describe los archivos con los hashes reales y no se lista a sí mismo', () => {
    const plan = buildPlan();
    const entries = finalizePackage(plan, (files) => ({ files, absences: plan.absences }));
    const manifest = JSON.parse(entries.find((entry) => entry.path === 'manifest.json')!.bytes.toString('utf8'));
    const byPath = new Map(entries.map((entry) => [entry.path, entry.bytes]));
    for (const file of manifest.files) {
      expect(file.path).not.toBe('manifest.json');
      expect(file.bytes).toBe(byPath.get(file.path)!.length);
      expect(file.sha256).toBe(sha256Hex(byPath.get(file.path)!));
    }
    expect(manifest.absences).toEqual([{ item: 'prompt completo', reason: 'no persistido', scope: 'global' }]);
  });

  it('dos paquetes con el mismo contenido producen los mismos hashes de archivo', () => {
    const first = finalizePackage(buildPlan(), (files) => ({ files }));
    const second = finalizePackage(buildPlan(), (files) => ({ files }));
    const hashOf = (entries: { path: string; bytes: Buffer }[], name: string) =>
      sha256Hex(entries.find((entry) => entry.path === name)!.bytes);
    for (const name of ['experiment.json', 'repetitions.csv', 'tests/RAG/1-1.php', 'hashes.txt']) {
      expect(hashOf(first, name)).toBe(hashOf(second, name));
    }
  });

  it('rechaza rutas inseguras y archivos duplicados', () => {
    const plan = new PackagePlan();
    expect(() => plan.addText('../fuera.txt', 'x')).toThrow();
    expect(() => plan.addText('/abs.txt', 'x')).toThrow();
    plan.addText('a.txt', 'x');
    expect(() => plan.addText('a.txt', 'y')).toThrow(/duplicado/);
    expect(() => assertSafePackagePath('tests/../x')).toThrow();
  });
});

describe('resolveOutputDir', () => {
  it('rechaza una carpeta de salida dentro del repositorio salvo que se permita', async () => {
    const inside = path.join(repoRoot, 'evidencia');
    await expect(resolveOutputDir(inside, { cwd: repoRoot, repoRoot, allowOutInRepo: false })).rejects.toThrow(UsageError);
    await expect(resolveOutputDir(inside, { cwd: repoRoot, repoRoot, allowOutInRepo: true })).resolves.toBe(inside);
  });

  it('rechaza una carpeta de salida dentro del repositorio aunque se llegue por un enlace simbólico', async () => {
    const link = path.join(scratch, 'enlace-al-repo');
    await import('node:fs/promises').then((fs) => fs.symlink(repoRoot, link));
    await expect(resolveOutputDir(path.join(link, 'salida'), { cwd: scratch, repoRoot, allowOutInRepo: false })).rejects.toThrow(
      /dentro del repositorio/,
    );
  });

  it('acepta una carpeta nueva o vacía fuera del repositorio y rechaza una no vacía', async () => {
    const fresh = path.join(scratch, 'paquete-nuevo');
    await expect(resolveOutputDir(fresh, { cwd: scratch, repoRoot, allowOutInRepo: false })).resolves.toBe(fresh);
    const empty = path.join(scratch, 'vacia');
    await mkdir(empty);
    await expect(resolveOutputDir(empty, { cwd: scratch, repoRoot, allowOutInRepo: false })).resolves.toBe(empty);
    const filled = path.join(scratch, 'llena');
    await mkdir(filled);
    await writeFile(path.join(filled, 'x.txt'), 'x');
    await expect(resolveOutputDir(filled, { cwd: scratch, repoRoot, allowOutInRepo: false })).rejects.toThrow(/no está vacía/);
  });

  it('rechaza una ruta que existe y no es carpeta', async () => {
    const file = path.join(scratch, 'archivo.txt');
    await writeFile(file, 'x');
    await expect(resolveOutputDir(file, { cwd: scratch, repoRoot, allowOutInRepo: false })).rejects.toThrow(/no es una carpeta/);
  });
});

describe('writePackageFiles', () => {
  it('escribe el paquete completo y no sobrescribe archivos existentes', async () => {
    const plan = buildPlan();
    const entries = finalizePackage(plan, (files) => ({ files }));
    const target = path.join(scratch, 'escritura');
    await writePackageFiles(target, entries);
    expect((await readFile(path.join(target, 'tests', 'RAG', '1-1.php'))).toString('utf8')).toBe('<?php\n');
    expect((await readdir(target)).sort()).toEqual(['experiment.json', 'hashes.txt', 'manifest.json', 'manifest.sha256', 'repetitions.csv', 'tests']);
    await expect(writePackageFiles(target, entries)).rejects.toThrow();
  });
});

describe('permisos y sello del manifiesto (SEC-03, DOC-01)', () => {
  it('archivos 0600 y carpetas 0700, aunque la umask sea permisiva', async () => {
    const { statSync } = await import('node:fs');
    const plan = buildPlan();
    const entries = finalizePackage(plan, (files) => ({ files }));
    const target = path.join(scratch, 'permisos', 'anidado');
    await writePackageFiles(target, entries);
    for (const entry of entries) {
      const mode = statSync(path.join(target, ...entry.path.split('/'))).mode & 0o777;
      expect(mode & 0o077, entry.path).toBe(0);
      expect(mode, entry.path).toBe(0o600);
    }
    for (const dir of [target, path.join(target, 'tests'), path.join(target, 'tests', 'RAG')]) {
      expect(statSync(dir).mode & 0o077, dir).toBe(0);
    }
  });

  it('manifest.sha256 sella los bytes de manifest.json y no se lista a sí mismo', () => {
    const plan = buildPlan();
    const entries = finalizePackage(plan, (files) => ({ files }));
    const manifest = entries.find((entry) => entry.path === 'manifest.json')!.bytes;
    const seal = entries.find((entry) => entry.path === 'manifest.sha256')!.bytes.toString('utf8');
    expect(seal).toBe(`${sha256Hex(manifest)}  manifest.json\n`);
    const parsed = JSON.parse(manifest.toString('utf8'));
    expect(parsed.files.map((file: { path: string }) => file.path)).not.toContain('manifest.sha256');
    expect(parsed.files.map((file: { path: string }) => file.path)).not.toContain('manifest.json');
  });
});
