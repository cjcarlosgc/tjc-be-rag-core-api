// WI-CORE-105 (D-v2-6): reglas ENV_SUSPECT. Casos que SÍ marcan y casos que NO deben marcar. Son solo informativas.
import { describe, expect, it } from 'vitest';
import { REPETITION_CSV_COLUMNS } from './experiment.mjs';
import { detectEnvSuspect } from './env-suspect.mjs';

describe('detectEnvSuspect: casos que SÍ marcan', () => {
  it('ENV-01: archivo bajo /app/ no encontrado en TEST_RUNTIME', () => {
    expect(
      detectEnvSuspect({
        failureType: 'TEST_RUNTIME',
        errorSummary: 'file_get_contents(/app/examples/rbac_model.conf): Failed to open stream: No such file or directory',
      }),
    ).toEqual(['ENV-01']);
  });

  it('ENV-01 también en COMPILATION, sin distinguir mayúsculas y con la ruta entre comillas', () => {
    expect(
      detectEnvSuspect({ failureType: 'COMPILATION', errorSummary: 'require(): FAILED TO OPEN STREAM for "/app/tests/fixtures/x.json"' }),
    ).toEqual(['ENV-01']);
    expect(detectEnvSuspect({ failureType: 'COMPILATION', errorSummary: "No such file or directory: '/app/src/x.php'" })).toEqual(['ENV-01']);
  });

  it('ENV-03: límite de memoria', () => {
    expect(detectEnvSuspect({ failureType: 'TEST_RUNTIME', errorSummary: 'Allowed memory size of 134217728 bytes exhausted' })).toEqual(['ENV-03']);
    expect(detectEnvSuspect({ failureType: 'DEPENDENCY_INSTALL', errorSummary: 'check memory_limit in php.ini' })).toEqual(['ENV-03']);
  });

  it('ENV-04: red o resolución de nombres', () => {
    for (const text of ['curl error 6 while downloading', 'Could not resolve host: repo.packagist.org', 'Connection timed out after 30000 ms', 'connection refused']) {
      expect(detectEnvSuspect({ failureType: 'DEPENDENCY_INSTALL', errorSummary: text }), text).toEqual(['ENV-04']);
    }
  });

  it('puede marcar varias reglas, en orden ENV-01, ENV-03, ENV-04', () => {
    expect(
      detectEnvSuspect({
        failureType: 'TEST_RUNTIME',
        errorSummary: 'Failed to open stream /app/x.conf; Allowed memory size exhausted; curl error 28',
      }),
    ).toEqual(['ENV-01', 'ENV-03', 'ENV-04']);
  });
});

describe('detectEnvSuspect: casos que NO deben marcar', () => {
  it('runner results file is empty (también lo produce un Fatal error de la estrategia)', () => {
    expect(
      detectEnvSuspect({
        failureType: 'TEST_RUNTIME',
        errorSummary: 'runner results file is empty (exitCode=2) … Fatal error: Class Foo\\BarTest contains 2 abstract methods and must therefore be declared abstract',
      }),
    ).toEqual([]);
  });

  it('Class "…" not found (puede ser una clase inventada por la estrategia)', () => {
    expect(detectEnvSuspect({ failureType: 'TEST_RUNTIME', errorSummary: 'Class "Brick\\Money\\AutoContext" not found' })).toEqual([]);
  });

  it('Call to private Money::__construct()', () => {
    expect(detectEnvSuspect({ failureType: 'TEST_RUNTIME', errorSummary: 'Call to private Money::__construct() from scope MoneyTest' })).toEqual([]);
  });

  it('ENV-01 exige el tipo de fallo, la ruta bajo /app/ y el texto de archivo no encontrado', () => {
    const text = 'file_get_contents(/app/examples/x.conf): Failed to open stream: No such file or directory';
    expect(detectEnvSuspect({ failureType: 'ASSERTION', errorSummary: text })).toEqual([]);
    expect(detectEnvSuspect({ failureType: 'NONE', errorSummary: text })).toEqual([]);
    expect(detectEnvSuspect({ failureType: 'TEST_RUNTIME', errorSummary: 'Failed to open stream: No such file or directory' })).toEqual([]);
    expect(detectEnvSuspect({ failureType: 'TEST_RUNTIME', errorSummary: 'Failed to open stream: /var/app/x.conf' })).toEqual([]);
    expect(detectEnvSuspect({ failureType: 'TEST_RUNTIME', errorSummary: 'file not readable: /app/x.conf' })).toEqual([]);
  });

  it('entradas vacías o ausentes no marcan ni lanzan', () => {
    expect(detectEnvSuspect({ failureType: 'TEST_RUNTIME', errorSummary: null })).toEqual([]);
    expect(detectEnvSuspect({ failureType: null, errorSummary: undefined })).toEqual([]);
    expect(detectEnvSuspect()).toEqual([]);
  });
});

describe('columna envSuspect de repetitions.csv', () => {
  it('es la última columna', () => {
    expect(REPETITION_CSV_COLUMNS.at(-1)).toBe('envSuspect');
    expect(REPETITION_CSV_COLUMNS.at(-2)).toBe('verificacion');
  });
});
