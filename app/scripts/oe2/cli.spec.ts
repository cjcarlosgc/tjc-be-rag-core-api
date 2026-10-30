// WI-CORE-107: pruebas del CLI `scripts/oe2.mjs`: códigos de salida (0/1/2), ayuda, configuración sin valores impresos,
// saneado de secretos en los errores y ejecución como proceso real sin base de datos.
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../oe2.mjs';
import { createDriverDouble } from './fixtures.mjs';
import { toJsonl, chunk } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, '..', 'oe2.mjs');
const SECRET = 'MARCA-SECRETA-7f3a';
const DB_URL = `postgresql://lector:${SECRET}@db.invalid:5432/dev?schema=public`;
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'oe2-cli-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

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

describe('runCli: códigos de salida y ayuda', () => {
  it('sin subcomando muestra la ayuda y sale con 0', async () => {
    const io = streams();
    const code = await runCli([], { stdout: io.stdout, stderr: io.stderr, env: {} });
    expect(code).toBe(0);
    expect(io.out.join('')).toContain('dump-chunks');
    expect(io.out.join('')).toContain('build-gt');
    expect(io.out.join('')).toContain('--guide');
    expect(io.out.join('')).toContain('Códigos de salida');
  });

  it('un uso incorrecto sale con 2 y no ejecuta nada', async () => {
    const io = streams();
    expect(await runCli(['sample', '--out'], { stdout: io.stdout, stderr: io.stderr, env: {} })).toBe(2);
    expect(await runCli(['nope'], { stdout: io.stdout, stderr: io.stderr, env: {} })).toBe(2);
    expect(io.err.join('')).toContain('Error de uso');
  });

  it('compare-dumps con diferencias sale con 1 e informa el resultado', async () => {
    const a = path.join(scratch, 'cli-a.jsonl');
    const b = path.join(scratch, 'cli-b.jsonl');
    await writeFile(a, toJsonl([chunk({ filePath: 'a.php', symbolKind: 'FUNCTION', symbolName: 'A\\f', content: 'x' })]));
    await writeFile(b, toJsonl([chunk({ filePath: 'a.php', symbolKind: 'FUNCTION', symbolName: 'A\\f', content: 'y' })]));
    const io = streams();
    const code = await runCli(['compare-dumps', '--a', a, '--b', b], { stdout: io.stdout, stderr: io.stderr, env: {} });
    expect(code).toBe(1);
    expect(io.out.join('')).toContain('hay diferencias');
  });

  it('un fallo de ejecución sale con 1 con mensaje, sin pila', async () => {
    const io = streams();
    const code = await runCli(['compare-dumps', '--a', path.join(scratch, 'no-existe.jsonl'), '--b', path.join(scratch, 'no-existe-2.jsonl')], {
      stdout: io.stdout,
      stderr: io.stderr,
      env: {},
    });
    expect(code).toBe(1);
    expect(io.err.join('')).toMatch(/^Error: /);
    expect(io.err.join('')).not.toContain('at ');
  });
});

describe('runCli: configuración y secretos', () => {
  it('sin DATABASE_URL, dump-chunks sale con 1 y menciona el nombre de la variable, no un valor', async () => {
    const io = streams();
    const code = await runCli(['dump-chunks', '--project-version', 'pv-1', '--out', path.join(scratch, 'cli-noenv')], {
      stdout: io.stdout,
      stderr: io.stderr,
      env: {},
    });
    expect(code).toBe(1);
    expect(io.err.join('')).toContain('DATABASE_URL');
  });

  it('un error de la base que arrastra la URL sale saneado: ni la contraseña ni la URL aparecen', async () => {
    const io = streams();
    const failing = createDriverDouble(() => {
      throw new Error(`fallo al conectar con ${DB_URL}`);
    });
    const code = await runCli(['dump-chunks', '--project-version', 'pv-1', '--out', path.join(scratch, 'cli-secret')], {
      stdout: io.stdout,
      stderr: io.stderr,
      env: { DATABASE_URL: DB_URL },
      openDriver: failing.openDriver as never,
    });
    expect(code).toBe(1);
    const text = `${io.out.join('')}${io.err.join('')}`;
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(DB_URL);
    expect(text).toContain('[REDACTED]');
  });
});

describe('proceso real (sin base de datos)', () => {
  it('node scripts/oe2.mjs sin argumentos imprime la ayuda y sale con 0', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 60_000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Subcomandos');
  });

  it('un uso incorrecto como proceso sale con 2 sin repetir el valor recibido', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'score', '--gt-sha256', `${SECRET}-no-hex`], {
      env: { PATH: process.env.PATH ?? '', DATABASE_URL: DB_URL },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain(SECRET);
  });
});
