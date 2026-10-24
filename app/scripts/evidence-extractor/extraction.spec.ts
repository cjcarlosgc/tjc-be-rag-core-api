// WI-CORE-094: prueba de extremo a extremo del extractor con un doble de la base y de Storage. No hay conexión real.
// Los valores de prueba (URL y clave) son ficticios y solo sirven para comprobar que nunca aparecen en la salida.
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExtractionPackage, computeSchemaGroups, ConfigError, STATIC_ABSENCES } from './index.mjs';
import { ANALYSIS_CONTEXTS, ANALYSIS_RETRIEVALS, ANALYSIS_RUN_BY_ID, ANALYSIS_RUN_EXECUTIONS, ANALYSIS_SYMBOLS, CONTEXT_TRACES, GENERATED_TEST_PROPOSALS, INVERSE_CHECKS, PRISMA_MIGRATIONS_QUERY, PROJECT_VERSION, SCHEMA_GROUPS, TEST_PUBLICATIONS, artifactsQuery, experimentByIdQuery, probeColumnsQuery, probeTablesQuery, probedTableNames, repetitionsQuery } from './queries.mjs';
import { NotFoundError } from './analysis.mjs';
import { UsageError, parseArguments } from './options.mjs';
import { canonicalJson, sha256Hex } from './util.mjs';

const RUN = '3f2c0a10-0000-4000-8000-000000000001';
const EXP = '3f2c0a10-0000-4000-8000-000000000002';
const PV = '3f2c0a10-0000-4000-8000-000000000003';
const PROJECT = '3f2c0a10-0000-4000-8000-000000000004';
const PROP1 = '3f2c0a10-0000-4000-8000-000000000005';
const PROP2 = '3f2c0a10-0000-4000-8000-000000000006';
const SECRET_URL = 'postgresql://owner:TOPSECRETPW@db.example.test:5432/app';
const SECRET_KEY = 'sb_secret_TESTKEY123456';
const SUPABASE = 'https://proyecto.example.test';
const BUCKET = 'evidencia-pruebas';
const HEAD = 'h'.repeat(40);

const TEST_CONTENT_1 = "<?php\n// Cookie: sid=abc123\nfinal class MoneyTest {}\n";
const PROPOSAL_BYTES_1 = Buffer.from("<?php\nclass MoneyAddTest {}\n// Authorization: Bearer abcdefghijklmnopqrstuv\n", 'utf8');
const LONG_CONTENT_2 = 'x'.repeat(300);
const STRIPPED_2 = 'x'.repeat(100);

const runnerReport = {
  status: 'FAILED',
  runner: 'PHPUNIT',
  compiled: true,
  executed: true,
  passed: false,
  totalTests: 1,
  passedTests: 0,
  failedTests: 1,
  skippedTests: 0,
  testCasesTruncated: false,
  testCasesOmitted: 0,
  testCases: [{ suitePath: 'MoneyTest', name: 'test', status: 'FAILED', durationMs: 3, failureKind: 'ASSERTION', errorMessage: 'Authorization: Bearer abcdefghijklmnopqrstuv' }],
  failure: null,
  stageDurations: [{ stage: 'TEST', durationMs: 10 }],
};
const sandboxEvidence = {
  entries: [
    { kind: 'TEST_STDOUT', stage: 'TEST', truncated: false, originalBytes: 40, content: 'Authorization: Bearer abcdefghijklmnopqrstuv\nOK', contentTruncated: false },
  ],
  omitted: 0,
};

function fixtureRun() {
  return {
    id: RUN, projectId: PROJECT, repositoryId: '42', repositoryName: 'acme/pilot', prNumber: 7, prTitle: 'Cobro con tarjeta',
    baseRef: 'main', headRef: 'feature/cobro', baseSha: 'b'.repeat(40), headSha: HEAD, changesetBaseSha: 'b'.repeat(40),
    changesetHeadSha: HEAD, actorLogin: 'octocat', status: 'SUCCESS', current: true, attemptCount: 1, indexMode: 'BOOTSTRAP',
    projectVersionId: PV, functionalBehaviorValidated: false, actionRequiredCount: 0, generatedTestsCount: 1,
    resultSummary: null, checkId: '99', checkPublishedAt: '2026-10-24T10:00:00.000Z', completedAt: '2026-10-24T10:05:00.000Z',
    createdAt: '2026-10-24T10:00:00.000Z',
  };
}

function fixtureAnalysis(opts: { foreignKey?: boolean; dotName?: boolean } = {}) {
  const proposalOne = {
    id: PROP1, analysisRunId: RUN, analysisSymbolId: 'sym-1', contextId: 'ctx-1', relativePath: 'tests/MoneyAddTest.php',
    symbolLanguage: 'PHP', symbolKind: 'METHOD', qualifiedName: opts.dotName ? 'Foo..bar' : 'Money.add', filePath: 'src/Money.php',
    storageKey: `analysis-runs/${RUN}/proposals/a1`, contentSha256: sha256Hex(PROPOSAL_BYTES_1), status: 'AVAILABLE',
    failureSummary: null, generation: JSON.stringify({ provider: 'openai', model: 'gpt-6-luna', inputTokens: 10, outputTokens: 5, durationMs: 100 }),
    createdAt: '2026-10-24T10:02:00.000Z',
  };
  const proposalTwo = {
    id: PROP2, analysisRunId: RUN, analysisSymbolId: 'sym-2', contextId: 'ctx-2', relativePath: 'tests/parse.test.ts',
    symbolLanguage: 'TYPESCRIPT', symbolKind: 'FUNCTION', qualifiedName: 'parse', filePath: 'src/parse.ts',
    storageKey: opts.foreignKey ? 'analysis-runs/otro-run/proposals/x' : `analysis-runs/${RUN}/proposals/b2`, contentSha256: sha256Hex('nunca descargado'), status: 'HELD',
    failureSummary: 'BEHAVIORAL_MISMATCH', generation: null, createdAt: '2026-10-24T10:02:00.000Z',
  };
  return {
    run: [fixtureRun()],
    symbols: [{ id: 'sym-1', language: 'PHP', kind: 'METHOD', qualifiedName: 'Money.add', filePath: 'src/Money.php', changeKind: 'DIRECTLY_CHANGED', createdAt: '2026-10-24T10:01:00.000Z' }],
    retrievals: [{ id: 'ret-1', analysisSymbolId: 'sym-1', mode: 'SEM', createdAt: '2026-10-24T10:01:10.000Z' }],
    contexts: [{ id: 'ctx-1', analysisRunId: RUN, analysisSymbolId: 'sym-1', retrievalId: 'ret-1', selectedChunkIds: ['c1'], discardedChunkIds: [], selectedTokens: 10, tokenBudget: 100, functionalRuleIds: [], functionalRulesRetrieved: 0, functionalRulesSelected: 0, functionalRulesOmitted: 0, omittedFunctionalRules: '[]', createdAt: '2026-10-24T10:01:20.000Z' }],
    proposals: [proposalOne, proposalTwo],
    executions: [{ id: 'exe-1', analysisRunId: RUN, proposalId: PROP1, executionId: 'sbx-1', attempt: 1, executionProfile: 'PHP_PHPUNIT', outcome: 'PASSED', requestId: 'req-1', correlationId: 'corr-1', durationMs: 900, facts: JSON.stringify({ passed: true }), failure: null, createdAt: '2026-10-24T10:03:00.000Z' }],
    publications: [{ id: 'pub-1', analysisRunId: RUN, proposalIds: [PROP1], sourceHeadSha: HEAD, status: 'PUBLISHED', branchName: 'feature/cobro-tests', companionPullRequestNumber: 9, companionPullRequestUrl: 'https://github.com/acme/pilot/pull/9', failureMessage: null, createdAt: '2026-10-24T10:04:00.000Z' }],
    projectVersion: [{ projectVersionId: PV, projectId: PROJECT, commitSha: HEAD, status: 'COMPLETED', language: 'PHP', projectName: 'pilot' }],
  };
}

function fixtureExperiment() {
  return {
    experiment: [
      { id: EXP, projectId: PROJECT, projectVersionId: PV, targetId: 'T1', status: 'COMPLETED', completedRepetitions: 2, totalRepetitions: 2, failureCode: null, failureMessage: null, startedAt: '2026-10-24T09:00:00.000Z', completedAt: '2026-10-24T09:30:00.000Z', modelConfig: JSON.stringify({ provider: 'openai', model: 'gpt-6-luna', reasoningEffort: 'medium', endpoint: 'https://internal.example.test/v1' }), randomizationSeed: '42', budget: JSON.stringify({ toolCallCap: 10 }), executionProfile: 'PHP_PHPUNIT', runnerHint: 'PHPUNIT', analysisRunId: RUN, commitSha: HEAD, createdAt: '2026-10-24T08:59:00.000Z' },
    ],
    repetitions: [
      { id: 'rep-1', repetition: 1, strategy: 'RAG', attempt: 1, state: 'COMPLETED', compiled: true, executed: true, passed: true, valid: true, failureType: 'NONE', errorSummary: null, generationDurationMs: 5, executionDurationMs: 6, totalDurationMs: 11, inputTokens: 100, outputTokens: 20, totalTokens: 120, estimatedCost: 0.01, retrievedChunks: 3, selectedChunks: 2, contextTokens: 50, toolCalls: 0, filesInspected: 1, trajectory: null, pairId: 'pair-1', pairPosition: 1, technicallyEvaluable: true, sandboxTimedOut: false, failure: null, sandboxExecutionId: 'sbx-r1', sandboxRequestId: 'req-r1', sandboxCorrelationId: 'corr-r1', sandboxFacts: JSON.stringify({ passedTests: 1 }), artifactHash: sha256Hex(TEST_CONTENT_1), createdAt: '2026-10-24T09:01:00.000Z', startedAt: '2026-10-24T09:01:00.000Z', finishedAt: '2026-10-24T09:02:00.000Z', promptSha256: 'p'.repeat(64) },
      { id: 'rep-2', repetition: 1, strategy: 'GENERALIST_AGENT', attempt: 1, state: 'COMPLETED', compiled: true, executed: false, passed: null, valid: false, failureType: 'TEST_RUNTIME', errorSummary: 'fallo con Cookie: sid=zzz', generationDurationMs: 7, executionDurationMs: null, totalDurationMs: 9, inputTokens: 90, outputTokens: 10, totalTokens: 100, estimatedCost: null, retrievedChunks: null, selectedChunks: null, contextTokens: null, toolCalls: 4, filesInspected: 2, trajectory: JSON.stringify([{ step: 1 }]), pairId: 'pair-1', pairPosition: 2, technicallyEvaluable: true, sandboxTimedOut: false, failure: null, sandboxExecutionId: null, sandboxRequestId: null, sandboxCorrelationId: null, sandboxFacts: null, artifactHash: null, createdAt: '2026-10-24T09:03:00.000Z', startedAt: '2026-10-24T09:03:00.000Z', finishedAt: '2026-10-24T09:04:00.000Z', promptSha256: 'q'.repeat(64) },
    ],
    artifacts: [
      { id: 'art-1', repetitionId: 'rep-1', testContent: TEST_CONTENT_1, testContentSha256: sha256Hex(TEST_CONTENT_1), testContentTruncated: false, runnerReport: JSON.stringify(runnerReport), runnerReportSha256: sha256Hex(canonicalJson(runnerReport)), sandboxEvidence: JSON.stringify(sandboxEvidence), sandboxEvidenceSha256: sha256Hex(canonicalJson(sandboxEvidence)), sandboxEvidenceTruncated: false, sandboxStartedAt: '2026-10-24T09:01:30.000Z', sandboxCompletedAt: '2026-10-24T09:01:40.000Z' },
      { id: 'art-2', repetitionId: 'rep-2', testContent: STRIPPED_2, testContentSha256: sha256Hex(LONG_CONTENT_2), testContentTruncated: true, runnerReport: null, runnerReportSha256: null, sandboxEvidence: null, sandboxEvidenceSha256: null, sandboxEvidenceTruncated: null, sandboxStartedAt: null, sandboxCompletedAt: null },
    ],
    contextTraces: [
      { experimentRepetitionId: 'rep-1', kind: 'RAG', strategy: 'RAG', repetition: 1, attempt: 1, current: true, state: 'COMPLETE', detail: JSON.stringify({ candidates: [{ snippet: 'function add()', contentSha256: 'x' }] }), toolCalls: 0, filesInspected: 1 },
    ],
  };
}

type Scenario = {
  missingTables?: string[];
  missingTrialColumns?: boolean;
  withExperiment?: boolean;
  withAnalysis?: boolean;
  migrationRows?: unknown[];
  foreignKey?: boolean;
  dotName?: boolean;
};

function columnsFor(scenario: Scenario) {
  const rows: [string, string][] = [];
  for (const [name, group] of Object.entries(SCHEMA_GROUPS)) {
    if (name === 'experimentTrial' && scenario.missingTrialColumns) continue;
    for (const [table, columns] of Object.entries(group.columns)) {
      if ((scenario.missingTables ?? []).includes(table)) continue;
      for (const column of columns) rows.push([table, column]);
    }
  }
  return rows;
}

function filtered(object: Record<string, unknown>, sql: string) {
  const keys = Object.keys(object).filter((key) => sql.includes(`"${key}"`));
  return { columnNames: keys, columnTypes: [], rows: [keys.map((key) => object[key])] };
}

function resultSetFor(sql: string, scenario: Scenario, fixtures: ReturnType<typeof fixtureAnalysis> & ReturnType<typeof fixtureExperiment>) {
  if (sql === probeTablesQuery().sql) {
    const names = probedTableNames();
    const values = names.map((name) => !(scenario.missingTables ?? []).includes(name));
    return { columnNames: names, columnTypes: [], rows: [values] };
  }
  if (sql === probeColumnsQuery().sql) {
    return { columnNames: ['tableName', 'columnName'], columnTypes: [], rows: columnsFor(scenario) };
  }
  if (sql === PRISMA_MIGRATIONS_QUERY.sql) {
    const rows = scenario.migrationRows ?? [];
    return { columnNames: ['migrationName', 'finishedAt'], columnTypes: [], rows: rows as unknown[][] };
  }
  const single = (object: Record<string, unknown>) => filtered(object, sql);
  const many = (objects: Record<string, unknown>[]) => {
    if (objects.length === 0) return { columnNames: [], columnTypes: [], rows: [] };
    const keys = Object.keys(objects[0]).filter((key) => sql.includes(`"${key}"`));
    return { columnNames: keys, columnTypes: [], rows: objects.map((object) => keys.map((key) => object[key])) };
  };
  if (sql === ANALYSIS_RUN_BY_ID.sql) return scenario.withAnalysis === false ? many([]) : many(fixtures.run);
  if (sql === ANALYSIS_SYMBOLS.sql) return many(fixtures.symbols);
  if (sql === ANALYSIS_RETRIEVALS.sql) return many(fixtures.retrievals);
  if (sql === ANALYSIS_CONTEXTS.sql) return many(fixtures.contexts);
  if (sql === GENERATED_TEST_PROPOSALS.sql) return many(fixtures.proposals);
  if (sql === ANALYSIS_RUN_EXECUTIONS.sql) return many(fixtures.executions);
  if (sql === TEST_PUBLICATIONS.sql) return many(fixtures.publications);
  if (sql === PROJECT_VERSION.sql) return many(fixtures.projectVersion);
  if (sql === experimentByIdQuery({ trial: true }).sql || sql === experimentByIdQuery({ trial: false }).sql) {
    return many(fixtures.experiment);
  }
  if (sql === repetitionsQuery({ trial: true }).sql || sql === repetitionsQuery({ trial: false }).sql) {
    return many(fixtures.repetitions);
  }
  if (sql === artifactsQuery({ trial: true }).sql || sql === artifactsQuery({ trial: false }).sql) {
    return many(fixtures.artifacts);
  }
  if (sql === CONTEXT_TRACES.sql) return many(fixtures.contextTraces);
  if (INVERSE_CHECKS.some((check) => check.sql === sql)) return single({ rowCount: '0' });
  throw new Error('consulta inesperada en el doble');
}

function createFakeDatabase(scenario: Scenario) {
  const statements: string[] = [];
  const fixtures = { ...fixtureAnalysis({ foreignKey: scenario.foreignKey, dotName: scenario.dotName }), ...fixtureExperiment() };
  const transaction = {
    async executeRaw(query: { sql: string }) {
      statements.push(query.sql);
      return 0;
    },
    async queryRaw(query: { sql: string }) {
      statements.push(query.sql);
      return resultSetFor(query.sql, scenario, fixtures);
    },
    /** Libera la conexión; el ROLLBACK SQL se envía antes, por executeRaw. */
    async rollback() {
      statements.push('RELEASE');
    },
  };
  const driver = {
    async startTransaction() {
      statements.push('BEGIN');
      return transaction;
    },
    async dispose() {},
  };
  return { statements, openDriver: () => async () => driver };
}

function createFakeStorage() {
  const objects = new Map<string, Buffer>([[`analysis-runs/${RUN}/proposals/a1`, PROPOSAL_BYTES_1]]);
  const requested: string[] = [];
  return {
    requested,
    create: () => ({
      bucket: BUCKET,
      async download(key: string) {
        requested.push(key);
        const bytes = objects.get(key);
        return bytes ? { ok: true as const, bytes } : { ok: false as const, reason: 'not_found' };
      },
    }),
  };
}

let repoRootDir = '';
/** Ruta de salida inexistente: la prueba nunca escribe; solo valida que la carpeta no exista. */
const OUT = () => path.join(repoRootDir, '..', `salida-no-escrita-${Math.random().toString(36).slice(2)}`);
beforeAll(async () => {
  repoRootDir = await mkdtemp(path.join(tmpdir(), 'extract-evidence-repo-'));
  await mkdir(path.join(repoRootDir, 'app'), { recursive: true });
});
afterAll(async () => {
  await rm(repoRootDir, { recursive: true, force: true });
});

const FULL_ENV = { DATABASE_URL: SECRET_URL, SUPABASE_URL: SUPABASE, SUPABASE_SECRET_KEY: SECRET_KEY, SUPABASE_STORAGE_BUCKET: BUCKET };
const NOW = () => new Date('2026-10-24T12:00:00.000Z');

async function build(overrides: {
  argv?: string[];
  env?: Record<string, string>;
  scenario?: Scenario;
  storage?: boolean;
  out?: string;
  repoRoot?: string;
}) {
  const argv = overrides.argv ?? ['--out', overrides.out ?? OUT(), '--analysis-run', RUN, '--experiment', EXP];
  const options = parseArguments(argv);
  const database = createFakeDatabase(overrides.scenario ?? {});
  const storage = createFakeStorage();
  const result = await buildExtractionPackage({
    options,
    env: overrides.env ?? FULL_ENV,
    cwd: '/',
    repoRoot: overrides.repoRoot ?? repoRootDir,
    now: NOW,
    openDriver: database.openDriver as never,
    createStorage: (overrides.storage === false ? undefined : storage.create) as never,
  });
  return { result, database, storage };
}

function textOf(entries: { path: string; bytes: Buffer }[]) {
  return entries.map((entry) => entry.bytes.toString('utf8')).join('\n');
}

function entryOf(entries: { path: string; bytes: Buffer }[], name: string) {
  const found = entries.find((entry) => entry.path === name);
  if (!found) throw new Error(`falta ${name}`);
  return found.bytes;
}

describe('extracción completa de un AnalysisRun y un experimento (dobles)', () => {
  it('escribe el paquete esperado con los bytes exactos de la base y de Storage', async () => {
    const { result } = await build({});
    const paths = result.entries.map((entry) => entry.path);
    for (const expected of [
      'README.txt', 'manifest.json', 'hashes.txt', 'hash-verification.json', 'trace-9-links.json', 'analysis-run.json',
      'generated-tests.csv', 'generated-tests/01-Money.add.php', 'experiment.json', 'repetitions.csv', 'context-traces.json',
      'sandbox-evidence.json', 'tabla70-autofill.json', 'tests/RAG/1-1.php', 'tests/RAG/1-1.meta.json',
      'tests/GENERALIST_AGENT/1-1.meta.json',
    ]) {
      expect(paths, expected).toContain(expected);
    }
    expect(entryOf(result.entries, 'generated-tests/01-Money.add.php').equals(PROPOSAL_BYTES_1)).toBe(true);
    expect(entryOf(result.entries, 'tests/RAG/1-1.php').equals(Buffer.from(TEST_CONTENT_1, 'utf8'))).toBe(true);
  });

  it('no redacta el contenido de las pruebas, pero sí la copia de la evidencia del Sandbox', async () => {
    const { result } = await build({});
    const copy = entryOf(result.entries, 'sandbox-evidence.json').toString('utf8');
    expect(copy).toContain('[REDACTED]');
    expect(copy).not.toContain('abcdefghijklmnopqrstuv');
    expect(entryOf(result.entries, 'tests/RAG/1-1.php').toString('utf8')).toContain('Cookie: sid=abc123');
    const copyJson = JSON.parse(copy);
    const digests = copyJson.repetitions[0].digests;
    expect(digests.runnerReportSha256Persisted).not.toBe(digests.runnerReportSha256OfCopy);
  });

  it('verifica hashes sobre los bytes de la base: coincide, no verificable por truncado y prompt', async () => {
    const { result } = await build({});
    const verification = JSON.parse(entryOf(result.entries, 'hash-verification.json').toString('utf8'));
    expect(verification.summary['coincide']).toBeGreaterThan(0);
    expect(verification.summary['no verificable']).toBeGreaterThan(0);
    const rep2 = verification.experimentRepetitions.find((item: { key: string }) => item.key === 'GENERALIST_AGENT/1-1');
    const testHash = rep2.checks.find((check: { name: string }) => check.name === 'testContentSha256');
    expect(testHash.verdict).toBe('no verificable');
    const prompt = rep2.checks.find((check: { name: string }) => check.name === 'promptSha256');
    expect(prompt.verdict).toBe('no verificable');
  });

  it('el manifiesto lista el SHA-256 de cada archivo, las ausencias y los truncados', async () => {
    const { result } = await build({});
    const manifest = JSON.parse(entryOf(result.entries, 'manifest.json').toString('utf8'));
    const bytesByPath = new Map(result.entries.map((entry) => [entry.path, entry.bytes]));
    expect(manifest.packageSchemaVersion).toBe(1);
    expect(manifest.generatedAt).toBe('2026-10-24T12:00:00.000Z');
    for (const file of manifest.files) {
      expect(file.sha256).toBe(sha256Hex(bytesByPath.get(file.path)!));
    }
    const absenceItems = manifest.absences.map((item: { item: string }) => item.item);
    for (const absence of STATIC_ABSENCES) expect(absenceItems).toContain(absence.item);
    expect(absenceItems).toContain('generated-tests: propuesta ' + PROP2 + ' (parse)');
    expect(manifest.truncations.map((item: { item: string }) => item.item)).toContain('testContent GENERALIST_AGENT/1-1');
  });

  it('anonimiza por defecto actorLogin, refs y URL del PR, y omite el título', async () => {
    const { result } = await build({});
    const analysis = entryOf(result.entries, 'analysis-run.json').toString('utf8');
    expect(analysis).not.toContain('octocat');
    expect(analysis).not.toContain('Cobro con tarjeta');
    expect(analysis).not.toContain('feature/cobro-tests');
    expect(analysis).toMatch(/anon-[0-9a-f]{16}/);
  });

  it('con includePii incluye los valores personales y lo declara en el manifiesto', async () => {
    const { result } = await build({ argv: ['--out', OUT(), '--analysis-run', RUN, '--include-pii'] });
    const analysis = entryOf(result.entries, 'analysis-run.json').toString('utf8');
    expect(analysis).toContain('octocat');
    expect(analysis).toContain('Cobro con tarjeta');
    const manifest = JSON.parse(entryOf(result.entries, 'manifest.json').toString('utf8'));
    expect(manifest.includePii).toBe(true);
  });

  it('nunca escribe la URL de la base, la clave de Storage ni sus valores en ningún archivo', async () => {
    const { result } = await build({});
    const everything = textOf(result.entries);
    expect(everything).not.toContain('TOPSECRETPW');
    expect(everything).not.toContain(SECRET_URL);
    expect(everything).not.toContain(SECRET_KEY);
    expect(everything).not.toContain('internal.example.test');
    expect(everything).not.toContain('"endpoint"');
  });

  it('ejecuta solo sentencias de solo lectura dentro de la transacción READ ONLY', async () => {
    const { database } = await build({});
    expect(database.statements[0]).toBe('BEGIN');
    expect(database.statements[1]).toBe('SET TRANSACTION READ ONLY');
    expect(database.statements.at(-2)).toBe('ROLLBACK');
    expect(database.statements.at(-1)).toBe('RELEASE');
    for (const sql of database.statements.slice(2, -2)) {
      expect(sql).toMatch(/^SELECT|^WITH/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/);
    }
  });

  it('descarga de Storage solo las propuestas del run y declara el objeto que no existe', async () => {
    const { result, storage } = await build({});
    expect(storage.requested.sort()).toEqual([`analysis-runs/${RUN}/proposals/a1`, `analysis-runs/${RUN}/proposals/b2`].sort());
    expect(result.summary.hashVerification['no verificable']).toBeGreaterThan(0);
  });

  it('declara como ausencia el Storage no configurado y no descarga nada', async () => {
    const { result, storage } = await build({ env: { DATABASE_URL: SECRET_URL }, storage: false });
    expect(storage.requested).toEqual([]);
    const manifest = JSON.parse(entryOf(result.entries, 'manifest.json').toString('utf8'));
    expect(manifest.storage.configured).toBe(false);
    expect(manifest.absences.map((item: { item: string }) => item.item)).toContain('generated-tests (Storage)');
    expect(result.entries.some((entry) => entry.path.startsWith('generated-tests/'))).toBe(false);
  });

  it('declara la migración del trial ausente y omite lo que depende de ella', async () => {
    const { result } = await build({ scenario: { missingTrialColumns: true } });
    const manifest = JSON.parse(entryOf(result.entries, 'manifest.json').toString('utf8'));
    const migrations = manifest.schema.migrations as { name: string; status: string }[];
    expect(migrations.find((item) => item.name.startsWith('20261013110000'))?.status).toBe('no aplicada');
    expect(manifest.absences.map((item: { item: string }) => item.item)).toContain('columnas de la reconstrucción del trial');
  });

  it('declara la tabla de artefactos ausente en vez de fallar a medias', async () => {
    const { result } = await build({ scenario: { missingTables: ['experiment_repetition_artifacts'], missingTrialColumns: true } });
    const manifest = JSON.parse(entryOf(result.entries, 'manifest.json').toString('utf8'));
    expect(manifest.absences.map((item: { item: string }) => item.item)).toContain('experiment_repetition_artifacts');
    expect(result.entries.some((entry) => entry.path.startsWith('tests/'))).toBe(false);
  });

  it('un experimento sin AnalysisRun vinculado sigue su vínculo cuando no se indica uno', async () => {
    const { result } = await build({ argv: ['--out', OUT(), '--experiment', EXP] });
    const paths = result.entries.map((entry) => entry.path);
    expect(paths).toContain('analysis-run.json');
    const manifest = JSON.parse(entryOf(result.entries, 'manifest.json').toString('utf8'));
    expect(manifest.identifiers.analysisRunLinkedFromExperiment).toBe(true);
  });

  it('rechaza un --out dentro del repositorio', async () => {
    await expect(build({ out: path.join(repoRootDir, 'evidencia') })).rejects.toThrow(/dentro del repositorio/);
  });

  it('falla con ConfigError si falta DATABASE_URL', async () => {
    await expect(build({ env: { SUPABASE_URL: SUPABASE } })).rejects.toThrow(ConfigError);
  });

  it('falla con NotFoundError si el AnalysisRun no existe, sin paquete', async () => {
    await expect(build({ scenario: { withAnalysis: false }, argv: ['--out', OUT(), '--analysis-run', RUN] })).rejects.toThrow(NotFoundError);
  });

  it('rechaza un --analysis-run que no coincide con el vínculo del experimento', async () => {
    await expect(
      build({ argv: ['--out', OUT(), '--analysis-run', 'otro-run', '--experiment', EXP] }),
    ).rejects.toThrow(/vinculado a otro AnalysisRun/);
  });

  it('el trace de 9 enlaces incluye el chequeo inverso con 0 filas rotas', async () => {
    const { result } = await build({});
    const trace = JSON.parse(entryOf(result.entries, 'trace-9-links.json').toString('utf8'));
    expect(trace.directLinks).toHaveLength(9);
    expect(trace.inverseChecks.every((item: { verdict: string }) => item.verdict !== 'INCONSISTENT')).toBe(true);
    expect(trace.directLinks[8].verdict).toBe('PRESENT');
  });

  it('la tabla 70 rellena solo las columnas automáticas y declara el resto manual', async () => {
    const { result } = await build({});
    const table = JSON.parse(entryOf(result.entries, 'tabla70-autofill.json').toString('utf8'));
    expect(table.columns.Fecha.value).toBe('2026-10-24T12:00:00.000Z');
    expect(table.columns['Proyecto/snapshot/Run'].value.snapshotRef).toMatch(/^[0-9a-f]{8}-/);
    expect(table.columns.Estado.value).toBeNull();
    expect(table.columns.Tipo.status).toBe('parcial');
  });

  it('el CSV de repeticiones tiene cabecera fija y una fila por repetición', async () => {
    const { result } = await build({});
    const lines = entryOf(result.entries, 'repetitions.csv').toString('utf8').trim().split('\n');
    expect(lines[0]).toMatch(/^repetitionId,strategy,repetition,attempt,/);
    expect(lines).toHaveLength(3);
  });

  it('la propiedad de solo lectura de la guardia cubre las consultas del doble', () => {
    expect(INVERSE_CHECKS.length).toBe(7);
  });
});

describe('computeSchemaGroups', () => {
  it('marca un grupo como ausente con la lista de lo que falta', () => {
    const tables = Object.fromEntries(probedTableNames().map((name) => [name, true]));
    const columns = [{ tableName: 'experiment_runs', columnName: 'id' }];
    const groups = computeSchemaGroups(tables, columns);
    expect(groups.experimentCore.available).toBe(false);
    expect(groups.experimentCore.missing).toContain('experiment_runs.projectId');
    expect(groups.experimentTrial.migration).toBe('20261013110000_experiment_trial_reconstruction');
  });
});

describe('endurecimiento de la salida y de Storage (SEC-05, SEC-06, SEC-07, DOC-01)', () => {
  it('no descarga una clave fuera del prefijo del run y lo declara como ausencia', async () => {
    const { result, storage } = await build({ scenario: { foreignKey: true } });
    expect(storage.requested).toEqual([`analysis-runs/${RUN}/proposals/a1`]);
    const manifest = JSON.parse(entryOf(result.entries, 'manifest.json').toString('utf8'));
    const absence = manifest.absences.find((item: { item: string }) => item.item === `generated-tests: propuesta ${PROP2} (parse)`);
    expect(absence.reason).toMatch(/outside_prefix/);
    expect(manifest.storage.objectsSkippedByPolicy).toBe(1);
  });

  it('un qualifiedName con ".." no aborta la extracción y produce un nombre seguro', async () => {
    const { result } = await build({ scenario: { dotName: true } });
    expect(result.entries.some((entry) => entry.path === 'generated-tests/01-Foo.bar.php')).toBe(true);
  });

  it('sin migración trial, sandbox-evidence.json no contiene entradas vacías', async () => {
    const { result } = await build({ scenario: { missingTrialColumns: true } });
    const copy = JSON.parse(entryOf(result.entries, 'sandbox-evidence.json').toString('utf8'));
    for (const entry of copy.repetitions) {
      expect(entry.runnerReport !== null || entry.sandboxEvidence !== null, entry.key).toBe(true);
    }
    expect(copy.repetitions.some((entry: { key: string }) => entry.key === 'GENERALIST_AGENT/1-1')).toBe(false);
  });

  it('manifest.sha256 sella manifest.json y el manifiesto declara la excepción de autoverificación', async () => {
    const { result } = await build({});
    const manifestBytes = entryOf(result.entries, 'manifest.json');
    expect(entryOf(result.entries, 'manifest.sha256').toString('utf8')).toBe(`${sha256Hex(manifestBytes)}  manifest.json\n`);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    expect(manifest.manifestSeal.file).toBe('manifest.sha256');
    expect(manifest.manifestSeal.excepcion).toMatch(/sella/);
  });

  it('el manifiesto declara la PII residual en texto libre', async () => {
    const { result } = await build({});
    const manifest = JSON.parse(entryOf(result.entries, 'manifest.json').toString('utf8'));
    expect(manifest.piiPolicy.piiResidual.fields).toContain('test_publications.failureMessage');
    expect(manifest.piiPolicy.piiResidual.note).toMatch(/repositoryName/);
  });

  it('el tope de Storage configurado se declara en el manifiesto', async () => {
    const { result } = await build({ argv: ['--out', OUT(), '--analysis-run', RUN, '--storage-max-bytes', '1024'] });
    const manifest = JSON.parse(entryOf(result.entries, 'manifest.json').toString('utf8'));
    expect(manifest.storage.maxObjectBytes).toBe(1024);
    expect(manifest.readOnly.transaction).toMatch(/ROLLBACK explícito/);
  });
});

