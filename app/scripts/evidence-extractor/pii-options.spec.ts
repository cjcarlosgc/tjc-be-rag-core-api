// WI-CORE-094: política de datos personales (anonimizar u omitir por defecto) y lectura de argumentos.
import { describe, expect, it } from 'vitest';
import { PII_SALT, createPiiPolicy, pseudonymize } from './pii.mjs';
import { HELP_TEXT, UsageError, parseArguments } from './options.mjs';

describe('createPiiPolicy', () => {
  it('por defecto anonimiza el login y las refs y omite el título del PR', () => {
    const pii = createPiiPolicy({ includePii: false });
    expect(pii.apply('analysis_runs', 'actorLogin', 'octocat')).toMatch(/^anon-[0-9a-f]{16}$/);
    expect(pii.apply('analysis_runs', 'prTitle', 'Arregla el cobro')).toBeNull();
    expect(pii.apply('analysis_runs', 'headRef', 'feature/x')).toMatch(/^anon-/);
    expect(pii.apply('test_publications', 'companionPullRequestUrl', 'https://github.com/a/b/pull/1')).toMatch(/^anon-/);
    expect(pii.apply('analysis_runs', 'repositoryName', 'acme/pilot')).toBe('acme/pilot');
  });

  it('el seudónimo es estable y no revela el valor original', () => {
    expect(pseudonymize('octocat')).toBe(pseudonymize('octocat'));
    expect(pseudonymize('octocat')).not.toContain('octocat');
    expect(pseudonymize('octocat')).not.toBe(pseudonymize('hubot'));
    expect(PII_SALT).toMatch(/v1$/);
  });

  it('con includePii incluye los valores y lo registra', () => {
    const pii = createPiiPolicy({ includePii: true });
    expect(pii.apply('analysis_runs', 'actorLogin', 'octocat')).toBe('octocat');
    expect(pii.apply('analysis_runs', 'prTitle', 'Título')).toBe('Título');
    const report = pii.report();
    expect(report.mode).toMatch(/incluido/);
    expect(report.decisions.map((decision) => decision.action)).toEqual(['included', 'included']);
  });

  it('registra las decisiones agregadas por campo', () => {
    const pii = createPiiPolicy({ includePii: false });
    pii.apply('analysis_runs', 'actorLogin', 'a');
    pii.apply('analysis_runs', 'actorLogin', 'b');
    pii.apply('analysis_runs', 'prTitle', 'c');
    const decisions = pii.report().decisions;
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'analysis_runs', field: 'actorLogin', action: 'anonymized', count: 2 }),
        expect.objectContaining({ table: 'analysis_runs', field: 'prTitle', action: 'omitted', count: 1 }),
      ]),
    );
  });

  it('no toca campos que no son de la política', () => {
    const pii = createPiiPolicy({ includePii: false });
    expect(pii.apply('analysis_symbols', 'qualifiedName', 'Money.add')).toBe('Money.add');
  });
});

describe('parseArguments', () => {
  it('acepta las opciones válidas', () => {
    const options = parseArguments(['--out', '/tmp/paquete', '--analysis-run', 'run-1', '--experiment', 'exp-1', '--include-pii']);
    expect(options).toMatchObject({
      out: '/tmp/paquete',
      analysisRunId: 'run-1',
      experimentId: 'exp-1',
      includePii: true,
      allowOutInRepo: false,
    });
  });

  it('--help no exige el resto de opciones', () => {
    expect(parseArguments(['--help']).help).toBe(true);
    expect(HELP_TEXT).toContain('--out');
    expect(HELP_TEXT).toContain('DATABASE_URL');
  });

  it.each([
    [['--analysis-run', 'run-1'], /falta --out/],
    [['--out', '/tmp/x'], /indica --analysis-run/],
    [['--out'], /necesita un valor/],
    [['--out', '--analysis-run'], /necesita un valor/],
    [['--out', '/tmp/x', '--analysis-run', 'run 1'], /formato válido/],
    [['--out', '/tmp/x', '--experiment', '../etc'], /formato válido/],
    [['--out', '/tmp/x', '--analysis-run', 'run-1', '--desconocida'], /desconocido/],
  ])('rechaza %j con error de uso', (argv, pattern) => {
    expect(() => parseArguments(argv)).toThrow(UsageError);
    expect(() => parseArguments(argv)).toThrow(pattern);
  });

  it('no repite en el mensaje el argumento desconocido', () => {
    try {
      parseArguments(['--out', '/tmp/x', '--analysis-run', 'run-1', '--postgresql://secreto']);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('secreto');
    }
  });
});

describe('--storage-max-bytes', () => {
  it('por defecto son 5 MiB y acepta un valor explícito dentro del límite', () => {
    expect(parseArguments(['--out', '/x', '--analysis-run', 'r']).storageMaxBytes).toBe(5 * 1024 * 1024);
    expect(parseArguments(['--out', '/x', '--analysis-run', 'r', '--storage-max-bytes', '1024']).storageMaxBytes).toBe(1024);
  });

  it.each([
    [['0'], /entero positivo/],
    [['-1'], /entero positivo/],
    [['1.5'], /entero positivo/],
    [['abc'], /entero positivo/],
    [['67108865'], /no puede superar/],
  ])('rechaza el valor %j', (values, pattern) => {
    expect(() => parseArguments(['--out', '/x', '--analysis-run', 'r', '--storage-max-bytes', ...values])).toThrow(pattern);
  });
});
