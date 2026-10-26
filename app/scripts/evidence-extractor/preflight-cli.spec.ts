// WI-CORE-105: CLI oe5-preflight como proceso. Solo loopback con un puerto cerrado: no hay red real.
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../oe5-preflight.mjs', import.meta.url));
const MARKER = 'MARCADOR-CREDENCIAL-7f3a';

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'oe5-preflight-cli-'));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function run(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe('CLI oe5-preflight (proceso real)', () => {
  it('--help sale con 0', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.output).toContain('before');
    expect(result.output).toContain('after');
  });

  it('sin subcomando, con una URL con credenciales o con un argumento desconocido sale con 2 sin repetir el valor', () => {
    expect(run([]).status).toBe(2);
    const credentials = run(['before', '--core-url', `https://user:${MARKER}@core.example.test`]);
    expect(credentials.status).toBe(2);
    expect(credentials.output).not.toContain(MARKER);
    const unknown = run(['before', '--core-url', 'https://core.example.test', `--${MARKER}`]);
    expect(unknown.status).toBe(2);
    expect(unknown.output).not.toContain(MARKER);
  });

  it('before contra un puerto cerrado de loopback sale con 1 y muestra ⛔', () => {
    const result = run(['before', '--core-url', 'http://127.0.0.1:1', '--timeout-ms', '5000']);
    expect(result.status).toBe(1);
    expect(result.output).toContain('⛔');
    expect(result.output).toContain('Core');
  });

  it('after con un --json dentro del paquete sale con 2 y no escribe nada', async () => {
    const dir = path.join(scratch, 'paquete');
    await mkdir(dir, { recursive: true });
    const result = run(['after', '--package', dir, '--json', path.join(dir, 'informe.json')]);
    expect(result.status).toBe(2);
    expect(await readdir(dir)).toEqual([]);
  });

  it('after con un paquete vacío sale con 1 (faltan repeticiones y archivos)', async () => {
    const dir = path.join(scratch, 'vacio');
    await mkdir(dir, { recursive: true });
    const result = run(['after', '--package', dir]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('⛔');
    expect(await readdir(dir)).toEqual([]);
  });

  it('after con un paquete inexistente sale con 2', () => {
    expect(run(['after', '--package', path.join(scratch, 'no-existe')]).status).toBe(2);
  });
});
