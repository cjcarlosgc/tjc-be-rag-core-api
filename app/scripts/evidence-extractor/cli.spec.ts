// WI-CORE-094 (SEC-04b): prueba de la CLI como proceso. Un marcador en DATABASE_URL y en la clave de Storage no debe
// aparecer en stdout ni stderr, ni en éxito ni en error. Usa un puerto cerrado: no hay ninguna base real.
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../extract-evidence.mjs', import.meta.url));
const URL_MARKER = 'MARKERPASS-7f3a';
const KEY_MARKER = 'sb_secret_MARKERKEY-9c1d';
const UNREACHABLE_URL = `postgresql://marker-user:${URL_MARKER}@127.0.0.1:1/marker-db?schema=public`;

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'extract-evidence-cli-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe('CLI extract-evidence (proceso real, sin base)', () => {
  it('--help imprime la ayuda, sale con 0 y no muestra ningún secreto del entorno', () => {
    const result = run(['--help'], { DATABASE_URL: UNREACHABLE_URL, SUPABASE_SECRET_KEY: KEY_MARKER });
    expect(result.status).toBe(0);
    expect(result.output).toContain('Uso');
    expect(result.output).not.toContain(URL_MARKER);
    expect(result.output).not.toContain(KEY_MARKER);
  });

  it('argumentos inválidos salen con 2 y no repiten valores del entorno', () => {
    const result = run(['--out'], { DATABASE_URL: UNREACHABLE_URL, SUPABASE_SECRET_KEY: KEY_MARKER });
    expect(result.status).toBe(2);
    expect(result.output).not.toContain(URL_MARKER);
    expect(result.output).not.toContain(KEY_MARKER);
  });

  it('un argumento desconocido no se repite en la salida', () => {
    const result = run(['--out', path.join(scratch, 'x'), '--analysis-run', 'run-1', `--${URL_MARKER}`], {
      DATABASE_URL: UNREACHABLE_URL,
    });
    expect(result.status).toBe(2);
    expect(result.output).not.toContain(URL_MARKER);
  });

  it('con una base inalcanzable sale con 1 y ni la URL, ni el usuario, ni la contraseña aparecen', () => {
    const out = path.join(scratch, `salida-${Date.now()}`);
    const result = run(['--out', out, '--analysis-run', '3f2c0a10-0000-4000-8000-000000000001'], {
      DATABASE_URL: UNREACHABLE_URL,
      SUPABASE_URL: 'https://marker-proyecto.example.test',
      SUPABASE_SECRET_KEY: KEY_MARKER,
      SUPABASE_STORAGE_BUCKET: 'marker-bucket',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('Error');
    expect(result.output).not.toContain(URL_MARKER);
    expect(result.output).not.toContain('marker-user');
    expect(result.output).not.toContain(KEY_MARKER);
  });

  it('sin DATABASE_URL sale con 1 y no imprime ningún valor', () => {
    const result = run(['--out', path.join(scratch, 'y'), '--analysis-run', 'run-1'], { SUPABASE_SECRET_KEY: KEY_MARKER });
    expect(result.status).toBe(1);
    expect(result.output).toContain('DATABASE_URL');
    expect(result.output).not.toContain(KEY_MARKER);
  });
});
