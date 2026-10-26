// WI-CORE-105: preflight del Piloto v2. `before` con fetch, reloj y sleep dobles (sin red ni esperas reales);
// `after` sobre un paquete sintético temporal con cada ✅/⚠️/⛔ de las comprobaciones (a)–(g).
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsageError } from './options.mjs';
import {
  buildVtTable,
  effectiveRepetitions,
  healthUrlFor,
  parseCsv,
  parsePreflightArguments,
  runPreflightAfter,
  runPreflightBefore,
} from './preflight.mjs';
import { REPETITION_CSV_COLUMNS } from './experiment.mjs';
import { sha256Hex, toCsv } from './util.mjs';

const CORE = 'https://core.example.test';
const INTEGRATION = 'https://integration.example.test';
const BODY_MARKER = 'CUERPO-DE-RESPUESTA-NO-IMPRIMIR';
const HEADER_MARKER = 'x-cabecera-no-imprimir';
const CODE_MARKER = 'CODIGO-SECRETO-DEL-ERROR';

// ---------------------------------------------------------------------------------------------------------------
// before
// ---------------------------------------------------------------------------------------------------------------

function beforeOptions(extra: string[] = []) {
  return parsePreflightArguments(['before', '--core-url', CORE, ...extra]) as Parameters<typeof runPreflightBefore>[0]['options'];
}

function fakeClock() {
  let current = 1_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
  };
}

function response(status: number) {
  const calls = { text: 0, json: 0, cancelled: 0 };
  return {
    calls,
    value: {
      status,
      headers: { get: () => HEADER_MARKER },
      text: async () => {
        calls.text += 1;
        return BODY_MARKER;
      },
      json: async () => {
        calls.json += 1;
        return { marker: BODY_MARKER };
      },
      body: { cancel: async () => { calls.cancelled += 1; } },
    },
  };
}

describe('preflight before', () => {
  it('consulta <url>/health y devuelve ✅ con 200 sin leer cabeceras ni cuerpo', async () => {
    const reply = response(200);
    const seen: { url: string; init: { method: string; redirect: string } }[] = [];
    const clock = fakeClock();
    const result = await runPreflightBefore({
      options: beforeOptions(['--integration-url', INTEGRATION]),
      fetch: (async (url: string, init: { method: string; redirect: string }) => {
        seen.push({ url, init });
        clock.advance(250);
        return reply.value;
      }) as never,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(result.exitCode).toBe(0);
    expect(seen.map((item) => item.url)).toEqual([`${CORE}/health`, `${INTEGRATION}/health`]);
    expect(seen[0].init).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(result.text).toContain('Core');
    expect(result.text).toContain('Integration');
    expect(result.text).toContain('200');
    expect(result.text).toContain('250');
    expect(result.text).toContain('✅');
    expect(result.text).not.toContain('⛔');
    expect(result.text).not.toContain(BODY_MARKER);
    expect(result.text).not.toContain(HEADER_MARKER);
    expect(reply.calls.text + reply.calls.json).toBe(0);
    expect(reply.calls.cancelled).toBe(2);
  });

  it('503 no es OK: ⛔ y código de salida 1', async () => {
    const reply = response(503);
    const result = await runPreflightBefore({ options: beforeOptions(), fetch: (async () => reply.value) as never, ...fakeClock() });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]).toMatchObject({ httpStatus: 503, ok: false });
    expect(result.text).toContain('503');
    expect(result.text).toContain('⛔');
    expect(result.text).not.toContain(BODY_MARKER);
  });

  it.each([201, 204, 301, 302, 404, 500])('solo el 200 cuenta: %i es ⛔', async (status) => {
    const result = await runPreflightBefore({ options: beforeOptions(), fetch: (async () => response(status).value) as never, ...fakeClock() });
    expect(result.exitCode).toBe(1);
  });

  it('hace el fetch con redirect manual: un 302 cuenta como fallo aunque seguirlo habría dado 200', async () => {
    const inits: { redirect?: string }[] = [];
    const result = await runPreflightBefore({
      options: beforeOptions(),
      fetch: (async (_url: string, init: { redirect?: string }) => {
        inits.push(init);
        // Si se siguiera la redirección, el destino respondería 200; con 'manual' el cliente ve el 302.
        return response(init.redirect === 'manual' ? 302 : 200).value;
      }) as never,
      ...fakeClock(),
    });
    expect(inits).toEqual([expect.objectContaining({ method: 'GET', redirect: 'manual' })]);
    expect(result.results[0]).toMatchObject({ httpStatus: 302, ok: false });
    expect(result.exitCode).toBe(1);
    expect(result.text).toContain('⛔');
  });

  it('si Integration falla y Core responde, el código es 1 y cada servicio tiene su fila', async () => {
    const result = await runPreflightBefore({
      options: beforeOptions(['--integration-url', INTEGRATION]),
      fetch: (async (url: string) => response(url.startsWith(CORE) ? 200 : 502).value) as never,
      ...fakeClock(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.results.map((item: { ok: boolean }) => item.ok)).toEqual([true, false]);
  });

  it('un timeout aborta la petición, se informa como timeout y sale con 1', async () => {
    const fetchNeverEnds = ((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      })) as never;
    const result = await runPreflightBefore({ options: beforeOptions(['--timeout-ms', '20']), fetch: fetchNeverEnds, ...fakeClock() });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]).toMatchObject({ httpStatus: null, ok: false, failure: 'timeout' });
    expect(result.text).toContain('timeout');
  });

  it('un error de red no filtra el texto del error (podría llevar URL o credenciales)', async () => {
    const result = await runPreflightBefore({
      options: beforeOptions(),
      fetch: (async () => {
        throw new Error(`connect ECONNREFUSED https://user:${CODE_MARKER}@core.example.test`);
      }) as never,
      ...fakeClock(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]).toMatchObject({ httpStatus: null, failure: 'red' });
    expect(result.text).not.toContain(CODE_MARKER);
    expect(result.text).toContain('sin respuesta');
  });

  it('sin --wait-ms no reintenta', async () => {
    const clock = fakeClock();
    let calls = 0;
    await runPreflightBefore({ options: beforeOptions(), fetch: (async () => { calls += 1; return response(503).value; }) as never, now: clock.now, sleep: clock.sleep });
    expect(calls).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('con --wait-ms reintenta cada 5 s hasta obtener 200 (arranque en frío)', async () => {
    const clock = fakeClock();
    const statuses = [503, 502, 200];
    let calls = 0;
    const result = await runPreflightBefore({
      options: beforeOptions(['--wait-ms', '60000']),
      fetch: (async () => response(statuses[calls++]).value) as never,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(3);
    expect(clock.sleeps).toEqual([5000, 5000]);
    expect(result.results[0]).toMatchObject({ attempts: 3, ok: true, ms: 10_000 });
  });

  it('con --wait-ms deja de reintentar al agotar el tiempo total y sale con 1', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await runPreflightBefore({
      options: beforeOptions(['--wait-ms', '7000']),
      fetch: (async () => { calls += 1; return response(503).value; }) as never,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(result.exitCode).toBe(1);
    expect(calls).toBe(3);
    expect(clock.sleeps).toEqual([5000, 2000]);
  });
});

describe('preflight before: argumentos y URL', () => {
  it.each([
    ['https://core.example.test', 'https://core.example.test/health'],
    ['https://core.example.test/', 'https://core.example.test/health'],
    ['http://localhost:3000', 'http://localhost:3000/health'],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080/health'],
    ['http://[::1]:8080', 'http://[::1]:8080/health'],
  ])('acepta %s', (input, expected) => {
    expect(healthUrlFor(input, '--core-url')).toBe(expected);
  });

  it.each([
    'http://core.example.test',
    'ftp://core.example.test',
    `https://user:${CODE_MARKER}@core.example.test`,
    `https://${CODE_MARKER}@core.example.test`,
    'https://core.example.test/health',
    'https://core.example.test/api',
    'https://core.example.test/?token=abc',
    'https://core.example.test/#frag',
    'no es una url',
    'http://localhost.example.test',
  ])('rechaza %s sin repetir la URL en el error', (input) => {
    let message = '';
    try {
      healthUrlFor(input, '--core-url');
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(CODE_MARKER);
    expect(message).not.toContain('example.test');
  });

  it('exige --core-url y valida --timeout-ms y --wait-ms', () => {
    expect(() => parsePreflightArguments(['before'])).toThrow(/falta --core-url/);
    expect(() => parsePreflightArguments(['before', '--core-url', CORE, '--timeout-ms', '0'])).toThrow(UsageError);
    expect(() => parsePreflightArguments(['before', '--core-url', CORE, '--timeout-ms', 'abc'])).toThrow(UsageError);
    expect(() => parsePreflightArguments(['before', '--core-url', CORE, '--wait-ms', '-1'])).toThrow(UsageError);
    expect(() => parsePreflightArguments(['before', '--core-url', CORE, '--wait-ms', '99999999'])).toThrow(UsageError);
    expect(() => parsePreflightArguments(['before', '--core-url', CORE, `--${CODE_MARKER}`])).toThrow(/desconocido/);
    const parsed = parsePreflightArguments(['before', '--core-url', CORE]);
    expect(parsed).toMatchObject({ timeoutMs: 40_000, waitMs: 0, integrationUrl: null });
  });

  it('exige subcomando válido', () => {
    expect(() => parsePreflightArguments([])).toThrow(UsageError);
    expect(() => parsePreflightArguments(['otro'])).toThrow(/subcomando/);
    expect(parsePreflightArguments(['--help'])).toEqual({ help: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// after
// ---------------------------------------------------------------------------------------------------------------

type PackageSpec = {
  rows?: Record<string, string | number | boolean>[] | null;
  omitEnvColumn?: boolean;
  hashes?: unknown;
  experiment?: unknown;
  traces?: unknown;
  snapshot?: unknown;
  trace9?: unknown;
};

let scratch: string;
let counter = 0;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'oe5-preflight-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function goodRows() {
  const rows: Record<string, string | number | boolean>[] = [];
  for (const strategy of ['RAG', 'GENERALIST_AGENT']) {
    for (const repetition of [1, 2, 3]) {
      rows.push({ repetitionId: `${strategy}-${repetition}`, strategy, repetition, attempt: 1, state: 'COMPLETED', valid: true, failureType: 'NONE', errorSummary: '', envSuspect: '' });
    }
  }
  return rows;
}

const GOOD_CONFIG = { strategy: 'LAYERED', relevanceThreshold: 0.6, declaringClassMaxTokens: 4000, targetEvidenceMaxTokens: 2000 };

function goodTraces(configuration: Record<string, unknown> = GOOD_CONFIG) {
  return {
    schema: 'context-traces',
    traces: [1, 2, 3].map((repetition) => ({ kind: 'RAG', strategy: 'RAG', repetition, attempt: 1, detail: { configuration, candidates: [] } })).concat([
      { kind: 'AGENT', strategy: 'GENERALIST_AGENT', repetition: 1, attempt: 1, detail: { tools: [] } } as never,
    ]),
  };
}

function goodSnapshot() {
  const entry = (name: string) => ({ path: name, bytes: 1, sha256: 'a'.repeat(64) });
  return {
    schema: 'snapshot-manifest',
    schemaVersion: 1,
    entries: [entry('src/A.php'), entry('composer.json'), entry('composer.lock'), entry('phpunit.xml.dist'), entry('examples/model.conf'), entry('tests/fixtures/data.json')],
    skipped: [],
  };
}

function goodExperiment() {
  return {
    experiment: {
      modelConfig: { provider: 'openai', model: 'gpt-6-luna', reasoningEffort: 'medium', temperature: null },
      budget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 120000 },
    },
  };
}

const LINK_NAMES = ['repo/PR/HEAD', 'AnalysisRun', 'changeset/targets', 'retrieval', 'context', 'generation', 'Sandbox', 'results', 'publication/check'];

function goodTrace9(overrides: { direct?: Record<number, string>; inverse?: { id: string; link: number; verdict: string }[] } = {}) {
  return {
    schema: 'trace-9-links',
    directLinks: LINK_NAMES.map((name, index) => ({ number: index + 1, name, verdict: overrides.direct?.[index + 1] ?? 'PRESENT' })),
    inverseChecks: overrides.inverse ?? [
      { id: 'executionProposalOtherRun', link: 7, verdict: 'PRESENT' },
      { id: 'proposalContextOtherRun', link: 6, verdict: 'PRESENT' },
    ],
  };
}

function goodHashes() {
  const prompt = { name: 'promptSha256', verdict: 'no verificable' };
  return {
    summary: { coincide: 10, 'no coincide': 0, 'no verificable': 6 },
    experimentRepetitions: Array.from({ length: 6 }, () => ({ checks: [prompt] })),
    generatedTests: [],
  };
}

async function makePackage(spec: PackageSpec = {}) {
  counter += 1;
  const dir = path.join(scratch, `pkg-${counter}`, 'paquete');
  await mkdir(dir, { recursive: true });
  const columns = spec.omitEnvColumn ? REPETITION_CSV_COLUMNS.filter((column: string) => column !== 'envSuspect') : REPETITION_CSV_COLUMNS;
  const put = async (name: string, value: unknown) => writeFile(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  if (spec.rows !== null) await put('repetitions.csv', toCsv(columns, spec.rows ?? goodRows()));
  const files: [string, unknown][] = [
    ['hash-verification.json', spec.hashes === undefined ? goodHashes() : spec.hashes],
    ['experiment.json', spec.experiment === undefined ? goodExperiment() : spec.experiment],
    ['context-traces.json', spec.traces === undefined ? goodTraces() : spec.traces],
    ['snapshot-manifest.json', spec.snapshot === undefined ? goodSnapshot() : spec.snapshot],
    ['trace-9-links.json', spec.trace9 === undefined ? goodTrace9() : spec.trace9],
  ];
  for (const [name, value] of files) if (value !== null) await put(name, value);
  return dir;
}

function afterOptions(dir: string, extra: string[] = []) {
  return parsePreflightArguments(['after', '--package', dir, ...extra]) as Parameters<typeof runPreflightAfter>[0]['options'];
}

async function after(spec: PackageSpec, extra: string[] = []) {
  const dir = await makePackage(spec);
  const result = await runPreflightAfter({ options: afterOptions(dir, extra), cwd: scratch });
  return { dir, result, byId: Object.fromEntries(result.checks.map((item: { id: string }) => [item.id, item])) as Record<string, { status: string; detail: string }> };
}

async function snapshotOfDir(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await readdir(dir)) out[name] = sha256Hex(await readFile(path.join(dir, name)));
  return out;
}

describe('preflight after: paquete correcto', () => {
  it('todas las comprobaciones pasan: ✅, código 0, tabla sin ⚠️ ni ⛔', async () => {
    const { result } = await after({});
    expect(result.exitCode).toBe(0);
    expect(result.checks.map((item: { id: string; status: string }) => `${item.id}:${item.status}`)).toEqual(['a:ok', 'b:ok', 'c:ok', 'd:ok', 'e:ok', 'f:ok', 'g:ok']);
    expect(result.text).toContain('✅');
    expect(result.text).not.toContain('⛔');
    expect(result.text).not.toContain('⚠️');
    expect(result.text).toContain('RAG 3/3, GENERALIST_AGENT 3/3');
  });

  it('el paquete no se modifica y no se escribe nada sin --json', async () => {
    const dir = await makePackage();
    const before = await snapshotOfDir(dir);
    const parent = path.dirname(dir);
    const siblings = await readdir(parent);
    await runPreflightAfter({ options: afterOptions(dir), cwd: scratch });
    expect(await snapshotOfDir(dir)).toEqual(before);
    expect(await readdir(parent)).toEqual(siblings);
  });
});

describe('preflight after: (a) repeticiones efectivas', () => {
  it('⛔ si falta una repetición de un brazo', async () => {
    const { byId, result } = await after({ rows: goodRows().filter((row) => !(row.strategy === 'GENERALIST_AGENT' && row.repetition === 3)) });
    expect(byId.a.status).toBe('fail');
    expect(byId.a.detail).toBe('RAG 3/3, GENERALIST_AGENT 2/3');
    expect(result.exitCode).toBe(1);
  });

  it('⛔ si falta un brazo completo o el CSV', async () => {
    expect((await after({ rows: goodRows().filter((row) => row.strategy === 'RAG') })).byId.a.status).toBe('fail');
    const missing = await after({ rows: null });
    expect(missing.byId.a.status).toBe('fail');
    expect(missing.byId.g.status).toBe('fail');
    expect(missing.result.exitCode).toBe(1);
  });

  it('un reintento (intento 2) no cuenta como repetición nueva: la ranura usa el intento más alto', async () => {
    const rows = [...goodRows(), { repetitionId: 'RAG-1-b', strategy: 'RAG', repetition: 1, attempt: 2, state: 'COMPLETED', valid: true, failureType: 'NONE', errorSummary: '', envSuspect: '' }];
    const { byId } = await after({ rows });
    expect(byId.a.status).toBe('ok');
    expect(byId.a.detail).toBe('RAG 3/3, GENERALIST_AGENT 3/3');
  });

  it('⚠️ si hay más repeticiones de las esperadas', async () => {
    const rows = [...goodRows(), { repetitionId: 'RAG-4', strategy: 'RAG', repetition: 4, attempt: 1, state: 'COMPLETED', valid: true, failureType: 'NONE', errorSummary: '', envSuspect: '' }];
    const { byId, result } = await after({ rows });
    expect(byId.a.status).toBe('warn');
    expect(result.exitCode).toBe(0);
  });

  it('effectiveRepetitions toma el intento más alto por ranura', () => {
    const rows = [
      { strategy: 'RAG', repetition: '1', attempt: '1', id: 'x' },
      { strategy: 'RAG', repetition: '1', attempt: '10', id: 'y' },
      { strategy: 'RAG', repetition: '1', attempt: '2', id: 'z' },
    ];
    expect(effectiveRepetitions(rows).map((row: { id: string }) => row.id)).toEqual(['y']);
  });
});

describe('preflight after: (b) hashes', () => {
  it('⛔ si algún hash no coincide', async () => {
    const hashes = { ...goodHashes(), summary: { coincide: 9, 'no coincide': 1, 'no verificable': 6 } };
    const { byId, result } = await after({ hashes });
    expect(byId.b.status).toBe('fail');
    expect(result.exitCode).toBe(1);
  });

  it('⚠️ si hay «no verificable» distintos de promptSha256 (estructural)', async () => {
    const hashes = goodHashes();
    hashes.summary['no verificable'] = 7;
    hashes.experimentRepetitions[0].checks.push({ name: 'testContentSha256', verdict: 'no verificable' });
    const { byId, result } = await after({ hashes });
    expect(byId.b.status).toBe('warn');
    expect(byId.b.detail).toContain('no verificables 7');
    expect(result.exitCode).toBe(0);
  });

  it('sin verificables distintos del prompt queda ✅ y el detalle los cuenta aparte', async () => {
    const { byId } = await after({});
    expect(byId.b.status).toBe('ok');
    expect(byId.b.detail).toBe('coinciden 10, no coinciden 0, no verificables 6 (6 promptSha256, estructural)');
  });

  it('⛔ si falta hash-verification.json', async () => {
    expect((await after({ hashes: null })).byId.b.status).toBe('fail');
  });
});

describe('preflight after: (c) modelConfig y presupuesto', () => {
  it('⛔ si el modelo o el esfuerzo difieren o faltan', async () => {
    const wrongModel = goodExperiment();
    wrongModel.experiment.modelConfig.model = 'otro-modelo';
    expect((await after({ experiment: wrongModel })).byId.c.status).toBe('fail');
    const wrongEffort = goodExperiment();
    wrongEffort.experiment.modelConfig.reasoningEffort = 'low';
    const effort = await after({ experiment: wrongEffort });
    expect(effort.byId.c.status).toBe('fail');
    expect(effort.byId.c.detail).toContain('reasoningEffort=low (esperado medium)');
    expect((await after({ experiment: { experiment: {} } })).byId.c.status).toBe('fail');
  });

  it('⛔ si algún campo del presupuesto difiere o falta', async () => {
    for (const field of ['toolCallCap', 'contextTokenBudget', 'maxDurationMs'] as const) {
      const changed = goodExperiment();
      changed.experiment.budget[field] = 1;
      const result = await after({ experiment: changed });
      expect(result.byId.c.status, field).toBe('fail');
      expect(result.byId.c.detail).toContain(`budget.${field}=1`);
    }
    const missing = goodExperiment() as { experiment: { budget?: unknown } };
    delete missing.experiment.budget;
    expect((await after({ experiment: missing })).byId.c.status).toBe('fail');
  });

  it('respeta --expect-model, --expect-effort y --expect-budget', async () => {
    const experiment = goodExperiment();
    experiment.experiment.modelConfig.model = 'm-x';
    experiment.experiment.modelConfig.reasoningEffort = 'high';
    experiment.experiment.budget = { toolCallCap: 5, contextTokenBudget: 100, maxDurationMs: 9 };
    const { byId } = await after({ experiment }, ['--expect-model', 'm-x', '--expect-effort', 'high', '--expect-budget', '5,100,9']);
    expect(byId.c.status).toBe('ok');
  });

  it('acepta modelConfig y budget como cadenas JSON', async () => {
    const source = goodExperiment();
    const experiment = { experiment: { modelConfig: JSON.stringify(source.experiment.modelConfig), budget: JSON.stringify(source.experiment.budget) } };
    expect((await after({ experiment })).byId.c.status).toBe('ok');
  });

  it('⚠️ si temperature no es null', async () => {
    const experiment = goodExperiment();
    (experiment.experiment.modelConfig as Record<string, unknown>).temperature = 0.2;
    const { byId, result } = await after({ experiment });
    expect(byId.c.status).toBe('warn');
    expect(result.exitCode).toBe(0);
  });

  it('⛔ si falta experiment.json', async () => {
    expect((await after({ experiment: null })).byId.c.status).toBe('fail');
  });
});

describe('preflight after: (d) estrategia y parámetros de contexto', () => {
  it('⛔ si la estrategia difiere de la esperada', async () => {
    const { byId, result } = await after({ traces: goodTraces({ ...GOOD_CONFIG, strategy: 'RANKED' }) });
    expect(byId.d.status).toBe('fail');
    expect(byId.d.detail).toContain('3 distintas');
    expect(result.exitCode).toBe(1);
  });

  it.each(['relevanceThreshold', 'declaringClassMaxTokens', 'targetEvidenceMaxTokens'])('⛔ si %s difiere (LAYERED)', async (field) => {
    const { byId } = await after({ traces: goodTraces({ ...GOOD_CONFIG, [field]: 1 }) });
    expect(byId.d.status).toBe('fail');
  });

  it('⚠️ si la traza no trae los campos nuevos (sin configuration, sin strategy o sin parámetros LAYERED)', async () => {
    const withoutStrategy = await after({ traces: goodTraces({ topK: 10 }) });
    expect(withoutStrategy.byId.d.status).toBe('warn');
    expect(withoutStrategy.byId.d.detail).toContain('3 sin los campos necesarios');
    const withoutParameters = await after({ traces: goodTraces({ strategy: 'LAYERED' }) });
    expect(withoutParameters.byId.d.status).toBe('warn');
    const noConfiguration = await after({ traces: { traces: [{ kind: 'RAG', strategy: 'RAG', detail: { candidates: [] } }] } });
    expect(noConfiguration.byId.d.status).toBe('warn');
    expect(noConfiguration.result.exitCode).toBe(0);
  });

  it('⛔ prevalece sobre ⚠️ si hay trazas distintas y trazas incompletas a la vez', async () => {
    const traces = {
      traces: [
        { kind: 'RAG', strategy: 'RAG', detail: { configuration: { ...GOOD_CONFIG, strategy: 'RANKED' } } },
        { kind: 'RAG', strategy: 'RAG', detail: { configuration: { topK: 1 } } },
      ],
    };
    expect((await after({ traces })).byId.d.status).toBe('fail');
  });

  it('⚠️ si no hay trazas RAG; las trazas del agente no se evalúan', async () => {
    const onlyAgent = { traces: [{ kind: 'AGENT', strategy: 'GENERALIST_AGENT', detail: { configuration: { strategy: 'RANKED' } } }] };
    const { byId } = await after({ traces: onlyAgent });
    expect(byId.d.status).toBe('warn');
    expect(byId.d.detail).toContain('no hay trazas RAG');
  });

  it('con RANKED esperado solo se comprueba la estrategia y acepta detail como cadena JSON', async () => {
    const traces = { traces: [{ kind: 'RAG', strategy: 'RAG', detail: JSON.stringify({ configuration: { strategy: 'RANKED' } }) }] };
    expect((await after({ traces }, ['--expect-strategy', 'RANKED'])).byId.d.status).toBe('ok');
    expect((await after({ traces })).byId.d.status).toBe('fail');
  });

  it('respeta --expect-relevance-threshold, --expect-declaring-max y --expect-evidence-max', async () => {
    const configuration = { strategy: 'LAYERED', relevanceThreshold: 0.75, declaringClassMaxTokens: 1000, targetEvidenceMaxTokens: 500 };
    const { byId } = await after({ traces: goodTraces(configuration) }, ['--expect-relevance-threshold', '0.75', '--expect-declaring-max', '1000', '--expect-evidence-max', '500']);
    expect(byId.d.status).toBe('ok');
  });

  it('⛔ si falta context-traces.json', async () => {
    expect((await after({ traces: null })).byId.d.status).toBe('fail');
  });
});

describe('preflight after: (e) manifiesto del snapshot', () => {
  it('⚠️ si falta snapshot-manifest.json', async () => {
    const { byId, result } = await after({ snapshot: null });
    expect(byId.e.status).toBe('warn');
    expect(result.exitCode).toBe(0);
  });

  it('con --expect-fixtures-min cuenta solo entradas que no son .php, composer ni phpunit', async () => {
    const ok = await after({}, ['--expect-fixtures-min', '2']);
    expect(ok.byId.e.status).toBe('ok');
    expect(ok.byId.e.detail).toContain('2 fixtures');
    const short = await after({}, ['--expect-fixtures-min', '3']);
    expect(short.byId.e.status).toBe('fail');
    expect(short.result.exitCode).toBe(1);
  });

  it('⛔ con --expect-fixtures-min si el manifiesto falta o tiene un esquema distinto', async () => {
    expect((await after({ snapshot: null }, ['--expect-fixtures-min', '1'])).byId.e.status).toBe('fail');
    expect((await after({ snapshot: { schema: 'otro', entries: [] } })).byId.e.status).toBe('fail');
    expect((await after({ snapshot: '{ no es json' })).byId.e.status).toBe('fail');
  });
});

describe('preflight after: (e) manifiesto completo, parcial o vacío', () => {
  const entry = (name: string, sha: string | null = 'a'.repeat(64)) => ({ path: name, bytes: 1, sha256: sha });

  it('✅ solo con manifiesto completo (sin skipped ni sha256 null)', async () => {
    const { byId } = await after({ snapshot: { schema: 'snapshot-manifest', entries: [entry('a.php')], skipped: [] } });
    expect(byId.e.status).toBe('ok');
    expect(byId.e.detail).toContain('0 omitidas');
  });

  it('⚠️ con skipped no vacío: indica recuentos y motivos y sale con 0', async () => {
    const snapshot = { schema: 'snapshot-manifest', entries: [entry('a.php')], skipped: [{ path: 'x', reason: 'unsafe_path' }, { path: 'y', reason: 'unsafe_path' }, { path: 'z', reason: 'total_too_large' }] };
    const { byId, result } = await after({ snapshot });
    expect(byId.e.status).toBe('warn');
    expect(byId.e.detail).toContain('3 omitidas (total_too_large: 1, unsafe_path: 2)');
    expect(byId.e.detail).toContain('manifiesto parcial');
    expect(result.exitCode).toBe(0);
    expect(result.text).not.toContain('"x"');
  });

  it('⚠️ con entradas sha256 null: las cuenta', async () => {
    const { byId, result } = await after({ snapshot: { schema: 'snapshot-manifest', entries: [entry('a.php'), entry('big.bin', null)], skipped: [] } });
    expect(byId.e.status).toBe('warn');
    expect(byId.e.detail).toContain('1 sin sha256');
    expect(result.exitCode).toBe(0);
  });

  it('⛔ con entries vacío (aunque no haya skipped) y código 1', async () => {
    const { byId, result } = await after({ snapshot: { schema: 'snapshot-manifest', entries: [], skipped: [] } });
    expect(byId.e.status).toBe('fail');
    expect(byId.e.detail).toContain('manifiesto vacío');
    expect(result.exitCode).toBe(1);
  });

  it('con --expect-fixtures-min, el mínimo incumplido (⛔) prevalece sobre el manifiesto parcial (⚠️)', async () => {
    const snapshot = { schema: 'snapshot-manifest', entries: [entry('a.php')], skipped: [{ path: 'x', reason: 'unsafe_path' }] };
    expect((await after({ snapshot }, ['--expect-fixtures-min', '1'])).byId.e.status).toBe('fail');
    const partialButEnough = { schema: 'snapshot-manifest', entries: [entry('a.conf')], skipped: [{ path: 'x', reason: 'unsafe_path' }] };
    expect((await after({ snapshot: partialButEnough }, ['--expect-fixtures-min', '1'])).byId.e.status).toBe('warn');
  });
});

describe('preflight after: (f) los 9 enlaces (trace-9-links.json)', () => {
  it('✅ si todos los veredictos son PRESENT', async () => {
    const { byId, result } = await after({});
    expect(byId.f.status).toBe('ok');
    expect(byId.f.detail).toContain('todos PRESENT');
    expect(result.exitCode).toBe(0);
  });

  it('⚠️ si el archivo falta', async () => {
    const missing = await after({ trace9: null });
    expect(missing.byId.f.status).toBe('warn');
    expect(missing.result.exitCode).toBe(0);
  });

  it('⚠️ y lista los NOT_APPLICABLE («debe estar justificado»), directos e inversos', async () => {
    const { byId, result } = await after({
      trace9: goodTrace9({ direct: { 9: 'NOT_APPLICABLE' }, inverse: [{ id: 'publicationOtherRun', link: 9, verdict: 'NOT_APPLICABLE' }] }),
    });
    expect(byId.f.status).toBe('warn');
    expect(byId.f.detail).toContain('debe estar justificado');
    expect(byId.f.detail).toContain('#9 publication/check');
    expect(byId.f.detail).toContain('inverso publicationOtherRun');
    expect(result.exitCode).toBe(0);
  });

  it('⛔ y lista los INCONSISTENT; prevalece sobre NOT_APPLICABLE', async () => {
    const { byId, result } = await after({
      trace9: goodTrace9({
        direct: { 7: 'INCONSISTENT', 9: 'NOT_APPLICABLE' },
        inverse: [{ id: 'executionProposalOtherRun', link: 7, verdict: 'INCONSISTENT' }],
      }),
    });
    expect(byId.f.status).toBe('fail');
    expect(byId.f.detail).toContain('INCONSISTENT: #7 Sandbox, inverso executionProposalOtherRun');
    expect(byId.f.detail).toContain('NOT_APPLICABLE: #9 publication/check');
    expect(result.exitCode).toBe(1);
  });

  it('⛔ si el archivo no es JSON válido', async () => {
    const { byId, result } = await after({ trace9: '{ no es json' });
    expect(byId.f.status).toBe('fail');
    expect(byId.f.detail).toContain('no es JSON válido');
    expect(result.exitCode).toBe(1);
  });

  it.each([
    ['sin directLinks', { inverseChecks: [] }],
    ['sin inverseChecks', { directLinks: goodTrace9().directLinks }],
    ['menos de 9 enlaces', { directLinks: goodTrace9().directLinks.slice(0, 8), inverseChecks: [] }],
    ['veredicto desconocido', goodTrace9({ direct: { 3: 'QUIZAS' } })],
    ['elemento que no es objeto', { directLinks: goodTrace9().directLinks, inverseChecks: ['x'] }],
    ['un arreglo en lugar de un objeto', []],
    ['null', null],
  ])('⛔ si no tiene la forma esperada: %s', async (_name, trace9) => {
    const { byId, result } = await after({ trace9: trace9 === null ? 'null' : trace9 });
    expect(byId.f.status).toBe('fail');
    expect(byId.f.detail).toContain('forma esperada');
    expect(result.exitCode).toBe(1);
  });
});

describe('preflight after: (g) VT clasificado en estrategia o entorno sospechoso', () => {
  function rowsWith(overrides: Record<string, string | number | boolean>[]) {
    const rows = goodRows();
    overrides.forEach((override, index) => Object.assign(rows[index === 0 ? 0 : index === 1 ? 4 : 5], override));
    return rows;
  }

  it('sin reglas: «estrategia», recuento por brazo y ✅', async () => {
    const rows = rowsWith([
      { valid: false, failureType: 'TEST_RUNTIME', errorSummary: 'Class "X" not found' },
      { valid: false, failureType: 'COMPILATION', errorSummary: 'runner results file is empty (exitCode=2)' },
    ]);
    const { byId, result } = await after({ rows });
    expect(byId.g.status).toBe('ok');
    expect(result.vt.byArm).toEqual({ RAG: { invalid: 1, envSuspect: 0 }, GENERALIST_AGENT: { invalid: 1, envSuspect: 0 } });
    expect(result.vt.rows.map((row: { classification: string }) => row.classification)).toEqual(['estrategia', 'estrategia']);
    expect(result.text).toContain('estrategia');
    expect(result.exitCode).toBe(0);
  });

  it('con alguna regla: «entorno sospechoso (revisar)» y ⚠️ (código 0)', async () => {
    const rows = rowsWith([
      { valid: false, failureType: 'TEST_RUNTIME', errorSummary: `${CODE_MARKER} Failed to open stream /app/x.conf`, envSuspect: 'ENV-01' },
      { valid: false, failureType: 'TEST_RUNTIME', errorSummary: 'Fatal error en la estrategia' },
    ]);
    const { byId, result } = await after({ rows });
    expect(byId.g.status).toBe('warn');
    expect(result.vt.byArm.RAG).toEqual({ invalid: 1, envSuspect: 1 });
    expect(result.vt.byArm.GENERALIST_AGENT).toEqual({ invalid: 1, envSuspect: 0 });
    expect(result.text).toContain('entorno sospechoso (revisar)');
    expect(result.text).toContain('ENV-01');
    expect(result.exitCode).toBe(0);
  });

  it('solo cuenta la repetición efectiva (intento más alto): un intento 1 inválido seguido de un 2 válido no figura', async () => {
    const rows = [
      ...goodRows(),
      { repetitionId: 'RAG-1-b', strategy: 'RAG', repetition: 1, attempt: 2, state: 'COMPLETED', valid: false, failureType: 'TEST_RUNTIME', errorSummary: '', envSuspect: 'ENV-03' },
    ];
    rows[0] = { ...rows[0], valid: false, failureType: 'TEST_RUNTIME', envSuspect: '' };
    const { result } = await after({ rows });
    expect(result.vt.rows).toHaveLength(1);
    expect(result.vt.rows[0]).toMatchObject({ attempt: 2, envSuspect: ['ENV-03'] });
  });

  it('⚠️ si el CSV no tiene la columna envSuspect (paquete anterior)', async () => {
    const { byId } = await after({ omitEnvColumn: true, rows: rowsWith([{ valid: false, failureType: 'TEST_RUNTIME' }]) });
    expect(byId.g.status).toBe('warn');
    expect(byId.g.detail).toContain('envSuspect');
  });

  it('buildVtTable no lanza con filas vacías', () => {
    expect(buildVtTable([], ['strategy'])).toEqual({ rows: [], byArm: { RAG: { invalid: 0, envSuspect: 0 }, GENERALIST_AGENT: { invalid: 0, envSuspect: 0 } }, hasEnvColumn: false });
  });
});

describe('preflight after: salidas sin secretos ni código', () => {
  it('ni el texto ni el JSON contienen errorSummary, rutas de archivos del snapshot ni contenido de pruebas', async () => {
    const rows = goodRows();
    Object.assign(rows[0], { valid: false, failureType: 'TEST_RUNTIME', errorSummary: `${CODE_MARKER} Failed to open stream /app/secret.conf`, envSuspect: 'ENV-01' });
    const dir = await makePackage({ rows });
    const target = path.join(scratch, `salida-${counter}`, 'informe.json');
    const result = await runPreflightAfter({ options: afterOptions(dir, ['--json', target]), cwd: scratch });
    const written = await readFile(target, 'utf8');
    for (const text of [result.text, written, JSON.stringify(result.report)]) {
      expect(text).not.toContain(CODE_MARKER);
      expect(text).not.toContain('secret.conf');
      expect(text).not.toContain('rbac');
      expect(text).not.toContain('data.json');
    }
  });
});

describe('preflight after: --json', () => {
  it('escribe el informe estructurado fuera de la carpeta del paquete y no altera el paquete', async () => {
    const dir = await makePackage();
    const before = await snapshotOfDir(dir);
    const target = path.join(scratch, `json-${counter}`, 'informe.json');
    const result = await runPreflightAfter({ options: afterOptions(dir, ['--json', target]), cwd: scratch });
    const report = JSON.parse(await readFile(target, 'utf8'));
    expect(report).toMatchObject({ schema: 'oe5-preflight-after', schemaVersion: 1, result: 'ok', exitCode: 0, package: 'paquete' });
    expect(report.checks).toHaveLength(7);
    expect(report.expectations).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'medium', strategy: 'LAYERED' });
    expect(result.exitCode).toBe(0);
    expect(await snapshotOfDir(dir)).toEqual(before);
  });

  it('rechaza una ruta dentro de la carpeta del paquete (también vía subcarpeta nueva) y no escribe nada', async () => {
    const dir = await makePackage();
    const before = await snapshotOfDir(dir);
    for (const target of [path.join(dir, 'informe.json'), path.join(dir, 'sub', 'informe.json'), path.join(dir, '..', 'paquete', 'informe.json')]) {
      await expect(runPreflightAfter({ options: afterOptions(dir, ['--json', target]), cwd: scratch })).rejects.toThrow(/dentro de la carpeta del paquete/);
    }
    expect(await readdir(dir)).toEqual(Object.keys(before).sort());
    await expect(readdir(path.join(dir, 'sub'))).rejects.toThrow();
  });

  it('rechaza un --json que ya existe', async () => {
    const dir = await makePackage();
    const target = path.join(scratch, `previo-${counter}.json`);
    await writeFile(target, 'previo');
    await expect(runPreflightAfter({ options: afterOptions(dir, ['--json', target]), cwd: scratch })).rejects.toThrow(/ya existe/);
    expect(await readFile(target, 'utf8')).toBe('previo');
  });

  it('rechaza un paquete inexistente', async () => {
    await expect(runPreflightAfter({ options: afterOptions(path.join(scratch, 'no-existe')), cwd: scratch })).rejects.toThrow(/--package/);
  });
});

describe('preflight after: argumentos', () => {
  it('usa los valores por defecto aprobados', () => {
    expect(parsePreflightArguments(['after', '--package', 'p'])).toEqual({
      help: false,
      command: 'after',
      package: 'p',
      expectModel: 'gpt-6-luna',
      expectEffort: 'medium',
      expectBudget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 120000 },
      expectStrategy: 'LAYERED',
      expectRelevanceThreshold: 0.6,
      expectDeclaringMax: 4000,
      expectEvidenceMax: 2000,
      expectFixturesMin: null,
      json: null,
    });
  });

  it.each([
    [['after']],
    [['after', '--package']],
    [['after', '--package', '  ']],
    [['after', '--package', 'p', '--expect-strategy', 'OTRA']],
    [['after', '--package', 'p', '--expect-budget', '1,2']],
    [['after', '--package', 'p', '--expect-budget', '1,2,x']],
    [['after', '--package', 'p', '--expect-budget', '1,0,3']],
    [['after', '--package', 'p', '--expect-model', 'con espacios']],
    [['after', '--package', 'p', '--expect-relevance-threshold', 'abc']],
    [['after', '--package', 'p', '--expect-fixtures-min', '-1']],
    [['after', '--package', 'p', '--json', ' ']],
    [['after', '--package', 'p', '--nada']],
  ])('rechaza %j', (argv) => {
    expect(() => parsePreflightArguments(argv)).toThrow(UsageError);
  });
});

describe('parseCsv', () => {
  it('lee comillas, comillas escapadas, saltos de línea dentro de comillas y CRLF', () => {
    const csv = 'a,b,c\r\n1,"x, y","l1\nl2"\r\n2,"di ""hola""",\r\n';
    expect(parseCsv(csv)).toEqual({
      columns: ['a', 'b', 'c'],
      rows: [
        { a: '1', b: 'x, y', c: 'l1\nl2' },
        { a: '2', b: 'di "hola"', c: '' },
      ],
    });
  });

  it('es compatible con toCsv y tolera un texto vacío', () => {
    const columns = ['k', 'v'];
    const rows = [{ k: 'a,b', v: 'c"d' }, { k: 'líneas\nmúltiples', v: '' }];
    expect(parseCsv(toCsv(columns, rows)).rows).toEqual(rows);
    expect(parseCsv('')).toEqual({ columns: [], rows: [] });
  });
});
