// WI-CORE-105: preflight por caso del Piloto v2 (OE5). Dos subcomandos, ambos de solo lectura:
//   before  GET <url>/health de Core (y, si se indica, Integration) y espera HTTP 200 (arranque en frío de Render).
//           Nunca imprime cabeceras ni cuerpos de respuesta. Código de salida 1 si algún servicio no devuelve 200.
//   after   comprobaciones OFFLINE sobre un paquete del extractor (solo lee archivos; sin red). Solo escribe con --json,
//           y rechaza una ruta dentro de la carpeta del paquete para no alterar su sellado. Código de salida 1 si hay ⛔.
// Todo lo que toca el mundo se inyecta (fetch, reloj, sleep, fs): las pruebas no usan red ni relojes reales.
// Estado de cada comprobación: ✅ ok, ⚠️ revisar, ⛔ fallo (la forma del símbolo no depende solo del color).
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from './options.mjs';

export const PREFLIGHT_HELP_TEXT = `Uso (desde tjc-be-rag-core-api/app):
  node scripts/oe5-preflight.mjs before --core-url <url> [--integration-url <url>] [--timeout-ms <n=40000>]
                                        [--wait-ms <n=0>]
  node scripts/oe5-preflight.mjs after --package <carpeta del extractor> [--expect-model <m=gpt-6-luna>]
                                       [--expect-effort <e=medium>] [--expect-budget <tool,ctx,ms=20,8000,120000>]
                                       [--expect-strategy <LAYERED|RANKED=LAYERED>]
                                       [--expect-relevance-threshold <n=0.6>] [--expect-declaring-max <n=4000>]
                                       [--expect-evidence-max <n=2000>] [--expect-fixtures-min <n>]
                                       [--json <archivo fuera de la carpeta del paquete>]

before: GET <url>/health de cada URL y espera HTTP 200. URL válida: https (o http solo en loopback), sin credenciales,
        ruta ni consulta. Con --wait-ms > 0 reintenta cada 5 s hasta ese tiempo total (arranque en frío de Render).
        Nunca imprime cabeceras ni cuerpos.
after:  comprobaciones offline sobre un paquete ya extraído (solo lectura; sin red). Escribe solo con --json.

Códigos de salida: 0 sin ⛔; 1 hay algún ⛔; 2 uso incorrecto.
`;

const STATUS = Object.freeze({ ok: '✅', warn: '⚠️', fail: '⛔' });
const RETRY_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 40_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_WAIT_MS = 600_000;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

// ---------------------------------------------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------------------------------------------

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`la opción ${flag} necesita un valor`);
  return value;
}

function parseInteger(text, flag, { min, max }) {
  if (!/^(0|[1-9][0-9]{0,11})$/.test(text)) throw new UsageError(`${flag} debe ser un entero no negativo`);
  const value = Number(text);
  if (value < min || value > max) throw new UsageError(`${flag} debe estar entre ${min} y ${max}`);
  return value;
}

function parseNumber(text, flag) {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) throw new UsageError(`${flag} debe ser un número no negativo`);
  return Number(text);
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * URL base de un servicio: https (o http solo en loopback), sin credenciales, ruta ni consulta. Devuelve la URL de
 * `/health`. Nunca repite la URL recibida en el error (podría contener credenciales).
 */
export function healthUrlFor(text, flag) {
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new UsageError(`${flag} no es una URL válida`);
  }
  const httpsOk = parsed.protocol === 'https:';
  const httpLoopbackOk = parsed.protocol === 'http:' && isLoopback(parsed.hostname);
  if (!httpsOk && !httpLoopbackOk) throw new UsageError(`${flag} debe ser https (http solo en loopback)`);
  if (parsed.username !== '' || parsed.password !== '') throw new UsageError(`${flag} no puede llevar credenciales`);
  if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search !== '' || parsed.hash !== '') {
    throw new UsageError(`${flag} no puede llevar ruta, consulta ni fragmento`);
  }
  return `${parsed.origin}/health`;
}

function parseBudget(text) {
  const parts = text.split(',');
  if (parts.length !== 3) throw new UsageError('--expect-budget debe tener la forma <tool,ctx,ms>');
  const [toolCallCap, contextTokenBudget, maxDurationMs] = parts.map((part) => {
    if (!/^[1-9][0-9]{0,11}$/.test(part)) throw new UsageError('--expect-budget debe contener tres enteros positivos');
    return Number(part);
  });
  return { toolCallCap, contextTokenBudget, maxDurationMs };
}

function parseToken(text, flag) {
  if (!TOKEN_PATTERN.test(text)) throw new UsageError(`${flag} no tiene un formato válido`);
  return text;
}

/** Argumentos del preflight (subcomando + opciones). Función pura. Nunca repite un argumento desconocido. */
export function parsePreflightArguments(argv) {
  const [command, ...rest] = argv;
  if (command === undefined) throw new UsageError('indica el subcomando: before o after (ver --help)');
  if (command === '--help' || command === '-h') return { help: true };
  if (command !== 'before' && command !== 'after') throw new UsageError('subcomando desconocido (before o after)');

  if (command === 'before') {
    const options = { help: false, command, coreUrl: null, integrationUrl: null, timeoutMs: DEFAULT_TIMEOUT_MS, waitMs: 0 };
    for (let index = 0; index < rest.length; index += 1) {
      switch (rest[index]) {
        case '--help':
        case '-h':
          options.help = true;
          break;
        case '--core-url':
          index += 1;
          options.coreUrl = healthUrlFor(takeValue(rest, index, '--core-url'), '--core-url');
          break;
        case '--integration-url':
          index += 1;
          options.integrationUrl = healthUrlFor(takeValue(rest, index, '--integration-url'), '--integration-url');
          break;
        case '--timeout-ms':
          index += 1;
          options.timeoutMs = parseInteger(takeValue(rest, index, '--timeout-ms'), '--timeout-ms', { min: 1, max: MAX_TIMEOUT_MS });
          break;
        case '--wait-ms':
          index += 1;
          options.waitMs = parseInteger(takeValue(rest, index, '--wait-ms'), '--wait-ms', { min: 0, max: MAX_WAIT_MS });
          break;
        default:
          throw new UsageError('argumento desconocido (ver --help)');
      }
    }
    if (options.help) return options;
    if (options.coreUrl === null) throw new UsageError('falta --core-url <url>');
    return options;
  }

  const options = {
    help: false,
    command,
    package: null,
    expectModel: 'gpt-6-luna',
    expectEffort: 'medium',
    expectBudget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 120000 },
    expectStrategy: 'LAYERED',
    expectRelevanceThreshold: 0.6,
    expectDeclaringMax: 4000,
    expectEvidenceMax: 2000,
    expectFixturesMin: null,
    json: null,
  };
  for (let index = 0; index < rest.length; index += 1) {
    switch (rest[index]) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--package':
        index += 1;
        options.package = takeValue(rest, index, '--package');
        break;
      case '--expect-model':
        index += 1;
        options.expectModel = parseToken(takeValue(rest, index, '--expect-model'), '--expect-model');
        break;
      case '--expect-effort':
        index += 1;
        options.expectEffort = parseToken(takeValue(rest, index, '--expect-effort'), '--expect-effort');
        break;
      case '--expect-budget':
        index += 1;
        options.expectBudget = parseBudget(takeValue(rest, index, '--expect-budget'));
        break;
      case '--expect-strategy': {
        index += 1;
        const value = takeValue(rest, index, '--expect-strategy');
        if (value !== 'LAYERED' && value !== 'RANKED') throw new UsageError('--expect-strategy debe ser LAYERED o RANKED');
        options.expectStrategy = value;
        break;
      }
      case '--expect-relevance-threshold':
        index += 1;
        options.expectRelevanceThreshold = parseNumber(takeValue(rest, index, '--expect-relevance-threshold'), '--expect-relevance-threshold');
        break;
      case '--expect-declaring-max':
        index += 1;
        options.expectDeclaringMax = parseInteger(takeValue(rest, index, '--expect-declaring-max'), '--expect-declaring-max', { min: 0, max: 10_000_000 });
        break;
      case '--expect-evidence-max':
        index += 1;
        options.expectEvidenceMax = parseInteger(takeValue(rest, index, '--expect-evidence-max'), '--expect-evidence-max', { min: 0, max: 10_000_000 });
        break;
      case '--expect-fixtures-min':
        index += 1;
        options.expectFixturesMin = parseInteger(takeValue(rest, index, '--expect-fixtures-min'), '--expect-fixtures-min', { min: 0, max: 1_000_000 });
        break;
      case '--json':
        index += 1;
        options.json = takeValue(rest, index, '--json');
        break;
      default:
        throw new UsageError('argumento desconocido (ver --help)');
    }
  }
  if (options.help) return options;
  if (options.package === null) throw new UsageError('falta --package <carpeta del extractor>');
  if (options.package.trim().length === 0) throw new UsageError('--package no puede estar vacío');
  if (options.json !== null && options.json.trim().length === 0) throw new UsageError('--json no puede estar vacío');
  return options;
}

// ---------------------------------------------------------------------------------------------------------------
// before: /health
// ---------------------------------------------------------------------------------------------------------------

async function checkService({ name, url, timeoutMs, waitMs, fetchImpl, now, sleep }) {
  const startedAt = now();
  let attempts = 0;
  let httpStatus = null;
  let failure = null;
  for (;;) {
    attempts += 1;
    httpStatus = null;
    failure = null;
    try {
      // redirect: 'manual' evita seguir una redirección hacia otro host; un 3xx cuenta como fallo.
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      httpStatus = typeof response?.status === 'number' ? response.status : null;
      // El cuerpo y las cabeceras no se leen nunca; se descarta el flujo para liberar la conexión.
      try {
        await response?.body?.cancel?.();
      } catch {
        // sin efecto
      }
    } catch (error) {
      failure = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'red';
    }
    if (httpStatus === 200) break;
    const elapsed = now() - startedAt;
    if (waitMs <= 0 || elapsed >= waitMs) break;
    await sleep(Math.min(RETRY_INTERVAL_MS, waitMs - elapsed));
  }
  const ms = Math.max(0, now() - startedAt);
  return { service: name, httpStatus, ms, attempts, ok: httpStatus === 200, failure };
}

/** Formatea una tabla de texto simple (sin contenido de respuestas). */
function textTable(headers, rows) {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => String(row[column]).length)));
  const line = (cells) => `| ${cells.map((cell, column) => String(cell).padEnd(widths[column])).join(' | ')} |`;
  return [line(headers), `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`, ...rows.map(line)].join('\n');
}

/**
 * `before`: comprueba `/health` de Core y, si se indica, de Integration. `deps`: `{ fetch, now, sleep }`.
 * Devuelve `{ exitCode, results, text }`.
 */
export async function runPreflightBefore({ options, fetch: fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const targets = [{ name: 'Core', url: options.coreUrl }];
  if (options.integrationUrl !== null) targets.push({ name: 'Integration', url: options.integrationUrl });
  const results = [];
  for (const target of targets) {
    results.push(await checkService({ ...target, timeoutMs: options.timeoutMs, waitMs: options.waitMs, fetchImpl, now, sleep }));
  }
  const rows = results.map((result) => [
    result.service,
    result.httpStatus ?? (result.failure === 'timeout' ? 'timeout' : 'sin respuesta'),
    result.ms,
    result.attempts,
    result.ok ? STATUS.ok : STATUS.fail,
  ]);
  const allOk = results.every((result) => result.ok);
  const text = [
    'Preflight before: /health',
    textTable(['Servicio', 'HTTP', 'ms', 'intentos', 'Estado'], rows),
    allOk ? 'Resultado: ✅ servicios despiertos.' : 'Resultado: ⛔ algún servicio no devolvió 200; espera el arranque en frío (--wait-ms) antes de abrir el PR.',
    '',
  ].join('\n');
  return { exitCode: allOk ? 0 : 1, results, text };
}

// ---------------------------------------------------------------------------------------------------------------
// after: comprobaciones offline
// ---------------------------------------------------------------------------------------------------------------

/** Parser CSV RFC 4180 (comillas dobles, `""`, saltos de línea dentro de comillas). Devuelve filas como objetos. */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else {
      field += char;
    }
    index += 1;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const [header, ...body] = records;
  if (header === undefined) return { columns: [], rows: [] };
  const rows = body
    .filter((cells) => !(cells.length === 1 && cells[0] === ''))
    .map((cells) => Object.fromEntries(header.map((column, position) => [column, cells[position] ?? ''])));
  return { columns: header, rows };
}

async function readText(fs, file) {
  try {
    return { ok: true, text: await fs.readFile(file, 'utf8') };
  } catch {
    return { ok: false };
  }
}

function parseJsonText(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function readJsonFile(fs, file) {
  const read = await readText(fs, file);
  if (!read.ok) return { state: 'missing' };
  const parsed = parseJsonText(read.text);
  return parsed.ok ? { state: 'ok', value: parsed.value } : { state: 'invalid' };
}

function check(id, name, status, detail) {
  return { id, name, status, detail };
}

function worst(statuses) {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'ok';
}

/** Repeticiones efectivas: por ranura (estrategia + repetición) el intento más alto. */
export function effectiveRepetitions(rows) {
  const bySlot = new Map();
  for (const row of rows) {
    const slot = `${row.strategy}/${row.repetition}`;
    const attempt = Number(row.attempt);
    const current = bySlot.get(slot);
    if (current === undefined || attempt > Number(current.attempt)) bySlot.set(slot, row);
  }
  return [...bySlot.values()].sort(
    (a, b) => (a.strategy < b.strategy ? -1 : a.strategy > b.strategy ? 1 : 0) || Number(a.repetition) - Number(b.repetition),
  );
}

function checkRepetitions(csv) {
  if (csv.state !== 'ok') {
    return { check: check('a', '6 repeticiones efectivas (3 RAG + 3 GENERALIST_AGENT)', 'fail', csv.state === 'missing' ? 'falta repetitions.csv' : 'repetitions.csv no se pudo leer'), effective: [] };
  }
  const effective = effectiveRepetitions(csv.rows);
  const rag = effective.filter((row) => row.strategy === 'RAG').length;
  const agent = effective.filter((row) => row.strategy === 'GENERALIST_AGENT').length;
  const detail = `RAG ${rag}/3, GENERALIST_AGENT ${agent}/3`;
  let status = 'ok';
  if (rag < 3 || agent < 3) status = 'fail';
  else if (rag > 3 || agent > 3) status = 'warn';
  return { check: check('a', '6 repeticiones efectivas (3 RAG + 3 GENERALIST_AGENT)', status, status === 'warn' ? `${detail} (más de las esperadas)` : detail), effective };
}

function checkHashes(file) {
  const name = 'hashes del paquete';
  if (file.state !== 'ok') return check('b', name, 'fail', file.state === 'missing' ? 'falta hash-verification.json' : 'hash-verification.json no es JSON válido');
  const summary = file.value?.summary ?? {};
  const mismatch = Number(summary['no coincide'] ?? 0);
  const unverifiable = Number(summary['no verificable'] ?? 0);
  const match = Number(summary['coincide'] ?? 0);
  // `promptSha256` siempre es «no verificable» (el texto del prompt no se persiste): se cuenta aparte para no ocultar el resto.
  const allChecks = [
    ...(file.value?.experimentRepetitions ?? []).flatMap((entry) => entry.checks ?? []),
    ...(file.value?.generatedTests ?? []).map((entry) => entry.check).filter(Boolean),
  ];
  const structural = allChecks.filter((item) => item.verdict === 'no verificable' && item.name === 'promptSha256').length;
  const relevantUnverifiable = Math.max(0, unverifiable - structural);
  const detail = `coinciden ${match}, no coinciden ${mismatch}, no verificables ${unverifiable} (${structural} promptSha256, estructural)`;
  if (mismatch > 0) return check('b', name, 'fail', detail);
  return check('b', name, relevantUnverifiable > 0 ? 'warn' : 'ok', detail);
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const parsed = parseJsonText(value);
  return parsed.ok ? parsed.value : null;
}

function checkExperiment(file, options) {
  const name = 'modelConfig y presupuesto efectivos';
  if (file.state !== 'ok') return check('c', name, 'fail', file.state === 'missing' ? 'falta experiment.json' : 'experiment.json no es JSON válido');
  const experiment = file.value?.experiment ?? {};
  const modelConfig = parseMaybeJson(experiment.modelConfig) ?? {};
  const budget = parseMaybeJson(experiment.budget) ?? {};
  const problems = [];
  if (modelConfig.model !== options.expectModel) problems.push(`model=${modelConfig.model ?? 'ausente'} (esperado ${options.expectModel})`);
  if (modelConfig.reasoningEffort !== options.expectEffort) problems.push(`reasoningEffort=${modelConfig.reasoningEffort ?? 'ausente'} (esperado ${options.expectEffort})`);
  for (const field of ['toolCallCap', 'contextTokenBudget', 'maxDurationMs']) {
    if (budget[field] !== options.expectBudget[field]) problems.push(`budget.${field}=${budget[field] ?? 'ausente'} (esperado ${options.expectBudget[field]})`);
  }
  if (problems.length > 0) return check('c', name, 'fail', problems.join('; '));
  const temperature = modelConfig.temperature ?? null;
  const base = `model=${modelConfig.model}, effort=${modelConfig.reasoningEffort}, budget=${budget.toolCallCap}/${budget.contextTokenBudget}/${budget.maxDurationMs}`;
  if (temperature !== null) return check('c', name, 'warn', `${base}; temperature=${temperature} (se esperaba null)`);
  return check('c', name, 'ok', `${base}, temperature=null`);
}

function checkTraces(file, options) {
  const name = 'estrategia y parámetros de contexto en las trazas RAG';
  if (file.state !== 'ok') return check('d', name, 'fail', file.state === 'missing' ? 'falta context-traces.json' : 'context-traces.json no es JSON válido');
  const traces = (Array.isArray(file.value?.traces) ? file.value.traces : []).filter((trace) => trace?.kind === 'RAG' || trace?.strategy === 'RAG');
  if (traces.length === 0) return check('d', name, 'warn', 'no hay trazas RAG en el paquete');
  let matching = 0;
  let different = 0;
  let missingFields = 0;
  for (const trace of traces) {
    const detail = parseMaybeJson(trace.detail);
    const configuration = detail !== null && typeof detail === 'object' ? detail.configuration : null;
    if (configuration === null || typeof configuration !== 'object' || configuration.strategy === undefined) {
      missingFields += 1;
      continue;
    }
    let differs = configuration.strategy !== options.expectStrategy;
    let incomplete = false;
    if (!differs && options.expectStrategy === 'LAYERED') {
      const expected = {
        relevanceThreshold: options.expectRelevanceThreshold,
        declaringClassMaxTokens: options.expectDeclaringMax,
        targetEvidenceMaxTokens: options.expectEvidenceMax,
      };
      for (const [field, value] of Object.entries(expected)) {
        if (configuration[field] === undefined) incomplete = true;
        else if (configuration[field] !== value) differs = true;
      }
    }
    if (differs) different += 1;
    else if (incomplete) missingFields += 1;
    else matching += 1;
  }
  const detail = `${traces.length} trazas RAG: ${matching} con lo esperado (${options.expectStrategy}), ${different} distintas, ${missingFields} sin los campos necesarios`;
  if (different > 0) return check('d', name, 'fail', detail);
  return check('d', name, missingFields > 0 ? 'warn' : 'ok', detail);
}

const COMPOSER_FILE = /^composer\.(json|lock)$/i;
const PHPUNIT_FILE = /^phpunit(\..+)?$/i;

function isFixtureEntry(entryPath) {
  const base = entryPath.split('/').pop() ?? '';
  return !/\.php$/i.test(base) && !COMPOSER_FILE.test(base) && !PHPUNIT_FILE.test(base);
}

function checkSnapshot(file, options) {
  const name = 'manifiesto del snapshot';
  const fixturesRequired = options.expectFixturesMin !== null;
  if (file.state === 'missing') {
    return check('e', name, fixturesRequired ? 'fail' : 'warn', fixturesRequired ? `falta snapshot-manifest.json: no se puede comprobar el mínimo de ${options.expectFixturesMin} fixtures` : 'falta snapshot-manifest.json (¿Storage no configurado o snapshot ausente?)');
  }
  const manifest = file.state === 'ok' ? file.value : null;
  if (manifest === null || manifest.schema !== 'snapshot-manifest' || !Array.isArray(manifest.entries)) {
    return check('e', name, 'fail', 'snapshot-manifest.json no tiene el esquema esperado');
  }
  const skipped = Array.isArray(manifest.skipped) ? manifest.skipped : [];
  const reasons = new Map();
  for (const item of skipped) {
    const reason = typeof item?.reason === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(item.reason) ? item.reason : '(sin motivo)';
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const reasonText = [...reasons.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([reason, count]) => `${reason}: ${count}`).join(', ');
  const nullSha = manifest.entries.filter((entry) => entry?.sha256 === null).length;
  const fixtures = manifest.entries.filter((entry) => typeof entry?.path === 'string' && isFixtureEntry(entry.path)).length;
  const detail = `${manifest.entries.length} entradas, ${fixtures} fixtures (no .php, composer ni phpunit), ${skipped.length} omitidas${reasonText ? ` (${reasonText})` : ''}, ${nullSha} sin sha256`;
  if (manifest.entries.length === 0) return check('e', name, 'fail', `${detail}; manifiesto vacío: no describe nada de lo que recibió el Sandbox`);
  if (fixturesRequired && fixtures < options.expectFixturesMin) return check('e', name, 'fail', `${detail}; se exigían al menos ${options.expectFixturesMin} fixtures`);
  if (skipped.length > 0 || nullSha > 0) return check('e', name, 'warn', `${detail}; manifiesto parcial: no cubre todo lo que recibió el Sandbox`);
  return check('e', name, 'ok', fixturesRequired ? `${detail} (mínimo ${options.expectFixturesMin} cumplido)` : detail);
}

const LINK_VERDICTS = new Set(['PRESENT', 'NOT_APPLICABLE', 'INCONSISTENT']);

/** Los 9 enlaces (sentido directo e inverso) de `trace-9-links.json`: INCONSISTENT ⛔, NOT_APPLICABLE ⚠️ (¿justificado?). */
function checkTrace9(file) {
  const name = 'trace-9-links.json (9 enlaces)';
  if (file.state === 'missing') return check('f', name, 'warn', 'falta trace-9-links.json (¿experimento sin AnalysisRun vinculado?)');
  if (file.state === 'invalid') return check('f', name, 'fail', 'trace-9-links.json no es JSON válido');
  const trace = file.value;
  const direct = trace?.directLinks;
  const inverse = trace?.inverseChecks;
  const valid = (item) => item !== null && typeof item === 'object' && LINK_VERDICTS.has(item.verdict);
  if (!Array.isArray(direct) || !Array.isArray(inverse) || direct.length !== 9 || !direct.every(valid) || !inverse.every(valid)) {
    return check('f', name, 'fail', 'trace-9-links.json no tiene la forma esperada (9 directLinks e inverseChecks con verdict PRESENT, NOT_APPLICABLE o INCONSISTENT)');
  }
  const label = (item, kind) => {
    const id = kind === 'direct' ? `#${item.number}` : `inverso ${typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(item.id) ? item.id : `(enlace ${item.link})`}`;
    const text = kind === 'direct' && typeof item.name === 'string' && /^[A-Za-z0-9_ /().-]{1,40}$/.test(item.name) ? ` ${item.name}` : '';
    return `${id}${text}`;
  };
  const withVerdict = (verdict) => [...direct.filter((item) => item.verdict === verdict).map((item) => label(item, 'direct')), ...inverse.filter((item) => item.verdict === verdict).map((item) => label(item, 'inverse'))];
  const inconsistent = withVerdict('INCONSISTENT');
  const notApplicable = withVerdict('NOT_APPLICABLE');
  if (inconsistent.length > 0) return check('f', name, 'fail', `INCONSISTENT: ${inconsistent.join(', ')}${notApplicable.length > 0 ? `; NOT_APPLICABLE: ${notApplicable.join(', ')}` : ''}`);
  if (notApplicable.length > 0) return check('f', name, 'warn', `NOT_APPLICABLE (debe estar justificado): ${notApplicable.join(', ')}`);
  return check('f', name, 'ok', `${direct.length} enlaces directos y ${inverse.length} comprobaciones inversas: todos PRESENT`);
}

/** VT: repeticiones efectivas no válidas, con `failureType` y `envSuspect`. Informativo; no es veredicto. */
export function buildVtTable(effective, columns) {
  const hasEnvColumn = columns.includes('envSuspect');
  const rows = effective
    .filter((row) => row.valid !== 'true')
    .map((row) => {
      const envSuspect = (row.envSuspect ?? '').split(';').filter(Boolean);
      return {
        strategy: row.strategy,
        repetition: Number(row.repetition),
        attempt: Number(row.attempt),
        failureType: row.failureType === '' ? '(sin tipo)' : row.failureType,
        envSuspect,
        classification: envSuspect.length > 0 ? 'entorno sospechoso (revisar)' : 'estrategia',
      };
    });
  const byArm = {};
  for (const arm of ['RAG', 'GENERALIST_AGENT']) {
    const armRows = rows.filter((row) => row.strategy === arm);
    byArm[arm] = { invalid: armRows.length, envSuspect: armRows.filter((row) => row.envSuspect.length > 0).length };
  }
  return { rows, byArm, hasEnvColumn };
}

function checkVt(vt) {
  const name = 'VT: repeticiones efectivas no válidas';
  if (!vt.hasEnvColumn) return check('g', name, 'warn', 'repetitions.csv no tiene la columna envSuspect (paquete anterior a WI-CORE-105): no se puede separar entorno de estrategia');
  const total = vt.rows.length;
  const suspect = vt.rows.filter((row) => row.envSuspect.length > 0).length;
  const detail = `RAG: ${vt.byArm.RAG.invalid} no válidas (${vt.byArm.RAG.envSuspect} entorno sospechoso); GENERALIST_AGENT: ${vt.byArm.GENERALIST_AGENT.invalid} no válidas (${vt.byArm.GENERALIST_AGENT.envSuspect} entorno sospechoso)`;
  if (total === 0) return check('g', name, 'ok', 'ninguna repetición efectiva no válida');
  return check('g', name, suspect > 0 ? 'warn' : 'ok', detail);
}

async function realpathOfDeepestExisting(fs, absolute) {
  const missing = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isInside(child, parent) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/**
 * `after`: comprobaciones offline sobre el paquete. `deps`: `{ fs, cwd }`. Devuelve `{ exitCode, checks, vt, text,
 * report }`. Lanza `UsageError` si el paquete no existe o `--json` cae dentro de la carpeta del paquete.
 */
export async function runPreflightAfter({ options, cwd, fs = nodeFs }) {
  const packageDir = path.resolve(cwd, options.package);
  let packageReal;
  try {
    packageReal = await fs.realpath(packageDir);
    if (!(await fs.stat(packageReal)).isDirectory()) throw new UsageError('--package no es una carpeta');
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError('--package no existe o no se puede leer');
  }
  let jsonTarget = null;
  if (options.json !== null) {
    jsonTarget = path.resolve(cwd, options.json);
    const jsonReal = await realpathOfDeepestExisting(fs, jsonTarget);
    if (isInside(jsonReal, packageReal)) {
      throw new UsageError('--json no puede estar dentro de la carpeta del paquete (alteraría su sellado)');
    }
    try {
      await fs.stat(jsonTarget);
      throw new UsageError('--json ya existe; elige otro archivo');
    } catch (error) {
      if (error instanceof UsageError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const file = (name) => path.join(packageReal, name);
  const csvRead = await readText(fs, file('repetitions.csv'));
  const csv = csvRead.ok ? { state: 'ok', ...parseCsv(csvRead.text) } : { state: 'missing', rows: [], columns: [] };
  const [hashes, experiment, traces, snapshot, trace9] = await Promise.all([
    readJsonFile(fs, file('hash-verification.json')),
    readJsonFile(fs, file('experiment.json')),
    readJsonFile(fs, file('context-traces.json')),
    readJsonFile(fs, file('snapshot-manifest.json')),
    readJsonFile(fs, file('trace-9-links.json')),
  ]);

  const repetitions = checkRepetitions(csv);
  const vt = buildVtTable(repetitions.effective, csv.columns);
  const checks = [
    repetitions.check,
    checkHashes(hashes),
    checkExperiment(experiment, options),
    checkTraces(traces, options),
    checkSnapshot(snapshot, options),
    checkTrace9(trace9),
    csv.state === 'ok' ? checkVt(vt) : check('g', 'VT: repeticiones efectivas no válidas', 'fail', 'falta repetitions.csv'),
  ];
  const overall = worst(checks.map((item) => item.status));
  const exitCode = overall === 'fail' ? 1 : 0;

  const checkRows = checks.map((item) => [item.id, item.name, STATUS[item.status], item.detail]);
  const lines = [`Preflight after: paquete ${path.basename(packageReal)}`, textTable(['#', 'Comprobación', 'Estado', 'Detalle'], checkRows)];
  if (vt.rows.length > 0) {
    lines.push('', 'VT: repeticiones efectivas no válidas (informativo; no es veredicto ni puntuación)');
    lines.push(
      textTable(
        ['Brazo', 'Repetición', 'Intento', 'failureType', 'envSuspect', 'Clasificación'],
        vt.rows.map((row) => [row.strategy, row.repetition, row.attempt, row.failureType, row.envSuspect.join(';') || '-', row.classification]),
      ),
    );
  }
  lines.push(
    '',
    overall === 'fail' ? 'Resultado: ⛔ hay comprobaciones fallidas.' : overall === 'warn' ? 'Resultado: ⚠️ sin fallos, pero hay puntos que revisar.' : 'Resultado: ✅ todas las comprobaciones pasan.',
    '',
  );

  const report = {
    schema: 'oe5-preflight-after',
    schemaVersion: 1,
    package: path.basename(packageReal),
    expectations: {
      model: options.expectModel,
      reasoningEffort: options.expectEffort,
      budget: options.expectBudget,
      strategy: options.expectStrategy,
      relevanceThreshold: options.expectRelevanceThreshold,
      declaringClassMaxTokens: options.expectDeclaringMax,
      targetEvidenceMaxTokens: options.expectEvidenceMax,
      fixturesMin: options.expectFixturesMin,
    },
    checks,
    vt: { byArm: vt.byArm, rows: vt.rows },
    result: overall,
    exitCode,
  };
  if (jsonTarget !== null) {
    await fs.mkdir(path.dirname(jsonTarget), { recursive: true, mode: 0o700 });
    await fs.writeFile(jsonTarget, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  return { exitCode, checks, vt, text: lines.join('\n'), report };
}
