// WI-CORE-094: orquestación del extractor de evidencia de solo lectura. Orden:
//   1) validar la salida y las variables de entorno;
//   2) leer TODO dentro de una transacción READ ONLY (sondeo de esquema, experimento, AnalysisRun, comprobaciones);
//   3) descargar de Storage (solo `download`) los test generados de las propuestas, si está configurado;
//   4) construir el paquete en memoria con ausencias y truncados declarados;
//   5) escribir la carpeta (solo si todo lo anterior ha ido bien).
import { INVERSE_CHECKS, PRISMA_MIGRATIONS_QUERY, SCHEMA_GROUPS, probeColumnsQuery, probeTablesQuery } from './queries.mjs';
import { STORAGE_PREFIX, buildAnalysisPart, collectAnalysisRun } from './analysis.mjs';
import { buildExperimentPart, collectExperiment } from './experiment.mjs';
import { countVerdicts, VERDICT } from './hashes.mjs';
import { createPiiPolicy } from './pii.mjs';
import { EXTRACTOR_INFO, PACKAGE_SCHEMA_VERSION, PackagePlan, finalizePackage, resolveOutputDir, writePackageFiles } from './package.mjs';
import { runInReadOnlyTransaction } from './session.mjs';
import { buildTabla70 } from './tabla70.mjs';
import { UsageError } from './options.mjs';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Ausencias que el producto no persiste: se declaran SIEMPRE en el manifiesto, nunca se rellenan. */
export const STATIC_ABSENCES = Object.freeze([
  { item: 'prompt completo', reason: 'solo se persiste promptSha256 (DEC-VAL-001 PENDING)' },
  { item: 'respuesta cruda del LLM', reason: 'solo se persiste el contenido fusionado final, no la respuesta original' },
  { item: 'contexto RAG completo', reason: 'context_traces.detail guarda fragmentos de hasta 2000 caracteres; el texto entregado al LLM no se guarda' },
  { item: 'trazas completas del agente', reason: 'solo resumen, fragmento de hasta 2000 caracteres y resultSha256; los resultados completos de las herramientas no se guardan' },
  { item: 'oráculo', reason: 'fuera del producto por diseño; vive en el runbook de pilotos y en Tesis-Validacion' },
  { item: 'log completo de composer install', reason: 'no existe un tipo de evidencia de instalación de dependencias' },
  { item: 'códigos de salida de los procesos', reason: 'no se persisten; solo failure.code, failure.category y failure.stage' },
  { item: 'stdout y stderr de AnalysisRun', reason: 'no se persisten para AnalysisRun; solo para experimentos (evidencia acotada)' },
  { item: 'versión previa de una propuesta', reason: 'generated_test_proposals se sobrescribe por (run, símbolo); la versión anterior no queda' },
  { item: 'tarifa de costo aplicada', reason: 'no se persiste; estimatedCost no puede reproducirse sin la tarifa histórica' },
  { item: 'versiones instaladas por Composer y composer.lock', reason: 'no se persisten' },
  { item: 'filas anteriores a las migraciones de evidencia', reason: 'sin backfill: sandboxEvidence, promptSha256, artifactHash y startedAt quedan null' },
]);

const NON_EMPTY = (value) => typeof value === 'string' && value.length > 0;

/** Estado de cada grupo de esquema a partir del sondeo (tablas y columnas existentes). */
export function computeSchemaGroups(tablesRow, columnRows) {
  const columnsByTable = new Map();
  for (const row of columnRows) {
    if (!columnsByTable.has(row.tableName)) columnsByTable.set(row.tableName, new Set());
    columnsByTable.get(row.tableName).add(row.columnName);
  }
  const groups = {};
  for (const [name, group] of Object.entries(SCHEMA_GROUPS)) {
    const missing = [];
    for (const [table, columns] of Object.entries(group.columns)) {
      if (tablesRow[table] !== true) {
        missing.push(`tabla ${table}`);
        continue;
      }
      for (const column of columns) {
        if (!columnsByTable.get(table)?.has(column)) missing.push(`${table}.${column}`);
      }
    }
    groups[name] = { available: missing.length === 0, missing, label: group.label, migration: group.migration ?? null };
  }
  return groups;
}

function readmeText({ generatedAt, analysisRunId, experimentId, includePii }) {
  return [
    'Paquete de evidencia (WI-CORE-094, extractor de solo lectura)',
    '=============================================================',
    '',
    `Generado: ${generatedAt}`,
    `AnalysisRun: ${analysisRunId ?? '(no solicitado)'}`,
    `ExperimentRun: ${experimentId ?? '(no solicitado)'}`,
    `Datos personales: ${includePii ? 'INCLUIDOS (--include-pii). No compartir sin revisión.' : 'anonimizados u omitidos (por defecto)'}`,
    '',
    'Qué es: una copia de lo que la base de datos de desarrollo y Storage tienen persistido para estos identificadores.',
    'Qué NO es: no contiene credenciales, claves, DATABASE_URL, SUPABASE_URL ni SUPABASE_SECRET_KEY, y no',
    'reconstruye lo que no se persistió (prompt completo, respuesta cruda del LLM, contexto RAG completo, trazas',
    'completas del agente, oráculo, logs completos de composer install). Esas ausencias están en manifest.json.',
    '',
    'Advertencias: la base de desarrollo es la misma que usa Core en Render; los tests generados y los fragmentos',
    'de contexto pueden contener código de terceros (repositorios públicos de pilotos). Trátalo como datos.',
    '',
    'Verificar hashes: desde esta carpeta ejecuta `shasum -a 256 -c hashes.txt` (datos) y `shasum -a 256 -c manifest.sha256`',
    '(manifiesto). manifest.json lista tamaño y SHA-256 de cada archivo. El propio manifiesto no se lista a sí mismo:',
    'sella manifest.sha256 externamente si necesitas probar su integridad.',
    '',
    'Archivos clave: manifest.json (ausencias y truncados), trace-9-links.json (9 enlaces e inverso),',
    'hash-verification.json, tests/ (bytes exactos de la BD), generated-tests/ (desde Storage),',
    'sandbox-evidence.json (COPIA redactada), experiment.json y repetitions.csv.',
    '',
  ].join('\n');
}

function storageReason(configured) {
  return configured ? 'error' : 'storage no configurado (SUPABASE_URL, SUPABASE_SECRET_KEY o SUPABASE_STORAGE_BUCKET ausentes)';
}

/**
 * Lee la base y construye el paquete en memoria. No escribe nada. `deps` inyecta el driver de base de datos
 * (`openDriver`), el descargador de Storage (`createStorage`) y el reloj (`now`); en producción los fija la CLI.
 */
export async function buildExtractionPackage({ options, env, cwd, repoRoot, now, openDriver, createStorage }) {
  if (!NON_EMPTY(env.DATABASE_URL)) {
    throw new ConfigError('falta DATABASE_URL en el entorno: expórtala en tu shell (el script no carga .env)');
  }
  const outDir = await resolveOutputDir(options.out, { cwd, repoRoot, allowOutInRepo: options.allowOutInRepo });
  const storageConfigured = [env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, env.SUPABASE_STORAGE_BUCKET].every(NON_EMPTY);

  const read = await runInReadOnlyTransaction(openDriver(env.DATABASE_URL), async (session) => {
    const [tablesRow] = await session.query(probeTablesQuery());
    const columnRows = await session.query(probeColumnsQuery());
    const migrationRows = tablesRow._prisma_migrations === true ? await session.query(PRISMA_MIGRATIONS_QUERY) : [];
    const groups = computeSchemaGroups(tablesRow, columnRows);

    let experiment = null;
    if (options.experimentId !== null) {
      if (!groups.experimentCore.available) {
        throw new ConfigError(`faltan tablas o columnas de experimentos: ${groups.experimentCore.missing.slice(0, 10).join(', ')}`);
      }
      experiment = await collectExperiment(session, options.experimentId, {
        trial: groups.experimentTrial.available,
        artifactsAvailable: groups.repetitionArtifacts.available,
      });
    }

    const linkedRunId = experiment?.experiment.analysisRunId ?? null;
    if (options.analysisRunId !== null && linkedRunId !== null && linkedRunId !== options.analysisRunId) {
      throw new UsageError('el experimento está vinculado a otro AnalysisRun que el indicado en --analysis-run');
    }
    const analysisRunId = options.analysisRunId ?? linkedRunId;

    let analysis = null;
    if (analysisRunId !== null) {
      if (!groups.analysisRun.available) {
        throw new ConfigError(`faltan tablas o columnas del AnalysisRun: ${groups.analysisRun.missing.slice(0, 10).join(', ')}`);
      }
      analysis = await collectAnalysisRun(session, analysisRunId);
    }
    return { groups, migrationRows, experiment, analysis, analysisRunId, linkedRunId };
  });

  const { groups, migrationRows, experiment, analysis, analysisRunId } = read;

  // Storage: solo `download`, y solo si la configuración está completa. Un fallo por objeto queda registrado.
  const downloads = new Map();
  const downloader = storageConfigured
    ? createStorage({
        url: env.SUPABASE_URL,
        secretKey: env.SUPABASE_SECRET_KEY,
        bucket: env.SUPABASE_STORAGE_BUCKET,
        maxBytes: options.storageMaxBytes,
      })
    : null;
  if (analysis !== null) {
    const expectedPrefix = STORAGE_PREFIX(analysis.run.id);
    for (const proposal of analysis.proposals) {
      // La clave la escribe el producto como analysis-runs/<runId>/proposals/<uuid>. Una clave fuera de ese prefijo
      // no se descarga: la base es de confianza, pero un dato corrupto no debe llevar a leer otros objetos.
      let result;
      if (typeof proposal.storageKey !== 'string' || !proposal.storageKey.startsWith(expectedPrefix)) {
        result = { ok: false, reason: 'outside_prefix' };
      } else {
        result = downloader ? await downloader.download(proposal.storageKey) : { ok: false, reason: storageReason(false) };
      }
      downloads.set(proposal.id, result);
    }
  }

  const generatedAt = now().toISOString();
  const pii = createPiiPolicy({ includePii: options.includePii });
  const plan = new PackagePlan();
  const trial = groups.experimentTrial.available;
  const artifactsAvailable = groups.repetitionArtifacts.available;

  let analysisOut = null;
  if (analysis !== null) {
    analysisOut = buildAnalysisPart({
      plan,
      raw: analysis,
      pii,
      downloads,
      generatedAt,
      storageState: downloader ? 'error' : storageReason(false),
    });
  }
  let experimentOut = null;
  if (experiment !== null) {
    experimentOut = buildExperimentPart({ plan, raw: experiment, trial, artifactsAvailable });
  }

  for (const absence of STATIC_ABSENCES) plan.absence(absence.item, absence.reason, 'global');
  if (analysis === null && experiment === null) plan.absence('datos', 'no se solicitó ni AnalysisRun ni ExperimentRun', 'global');
  if (experiment !== null && experiment.experiment.analysisRunId === null) {
    plan.absence(
      'AnalysisRun del experimento',
      trial
        ? 'experimento sin analysisRunId (corrida previa o no vinculada)'
        : 'no se puede saber el analysisRunId: la migración 20261013110000 no está aplicada',
      'experiment',
    );
  }
  if (!storageConfigured && analysis !== null) {
    plan.absence('generated-tests (Storage)', 'storage no configurado: faltan SUPABASE_URL, SUPABASE_SECRET_KEY o SUPABASE_STORAGE_BUCKET en el entorno', 'analysis-run');
  }

  const migrations = [
    {
      name: '20261013100000_experiment_repetition_artifacts',
      status: artifactsAvailable ? 'aplicada' : 'no aplicada',
      registro: migrationRows.find((row) => row.migrationName === '20261013100000_experiment_repetition_artifacts')?.finishedAt ?? null,
    },
    {
      name: '20261013110000_experiment_trial_reconstruction',
      status: trial ? 'aplicada' : 'no aplicada',
      registro: migrationRows.find((row) => row.migrationName === '20261013110000_experiment_trial_reconstruction')?.finishedAt ?? null,
    },
  ];
  for (const migration of migrations) {
    if (migration.status === 'no aplicada') {
      plan.absence(`migración ${migration.name}`, 'no aplicada en la base consultada; las partes que dependen de ella se declaran como ausentes', 'database');
    }
  }

  const verificationChecks = [
    ...(experimentOut?.hashChecks.flatMap((entry) => entry.checks) ?? []),
    ...(analysisOut?.generatedTests.map((item) => item.check) ?? []),
  ];
  const hashSummary = countVerdicts(verificationChecks);
  plan.addJson('hash-verification.json', {
    schema: 'hash-verification',
    schemaVersion: 1,
    note: 'Hash persistido frente al recalculado sobre los datos de la base o de Storage. "no verificable" indica el motivo; nunca se corrige un valor persistido.',
    summary: hashSummary,
    experimentRepetitions: experimentOut?.hashChecks ?? [],
    generatedTests: analysisOut?.generatedTests.map((item) => ({ proposalId: item.proposalId, file: item.file, check: item.check })) ?? [],
    verdicts: { [VERDICT.MATCH]: 'coincide', [VERDICT.MISMATCH]: 'no coincide', [VERDICT.UNVERIFIABLE]: 'no verificable' },
  });

  plan.addText(
    'README.txt',
    readmeText({ generatedAt, analysisRunId, experimentId: options.experimentId, includePii: options.includePii }),
  );

  const filePaths = [...plan.files.keys()];
  plan.addJson(
    'tabla70-autofill.json',
    buildTabla70({ generatedAt, analysis, experiment, filePaths: [...filePaths, 'tabla70-autofill.json'] }),
  );

  const storageReport = {
    configured: storageConfigured,
    bucket: storageConfigured ? env.SUPABASE_STORAGE_BUCKET : null,
    objectsRequested: downloads.size,
    objectsDownloaded: [...downloads.values()].filter((item) => item.ok === true).length,
    maxObjectBytes: storageConfigured ? options.storageMaxBytes : null,
    objectsNotDownloaded: [...downloads.values()].filter((item) => item.ok !== true).map((item) => item.reason),
    objectsSkippedByPolicy: [...downloads.values()].filter((item) => item.reason === 'outside_prefix' || item.reason === 'too_large').length,
  };

  const entries = finalizePackage(plan, (files) => ({
    packageSchemaVersion: PACKAGE_SCHEMA_VERSION,
    generatedAt,
    extractor: EXTRACTOR_INFO,
    identifiers: {
      analysisRunId,
      experimentId: options.experimentId,
      analysisRunLinkedFromExperiment: options.analysisRunId === null && analysisRunId !== null,
    },
    includePii: options.includePii,
    piiPolicy: pii.report(),
    readOnly: {
      transaction: 'BEGIN (lo emite el adaptador); SET TRANSACTION READ ONLY; solo consultas SELECT registradas en queries.mjs y validadas por la guardia léxica; ROLLBACK explícito; liberación de la conexión y cierre del pool',
      note: 'La barrera real es READ ONLY; la guardia léxica es una segunda barrera.',
      checksRun: INVERSE_CHECKS.length,
    },
    schema: {
      migrations,
      groups: Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, { available: group.available, missing: group.missing }])),
    },
    storage: storageReport,
    absences: plan.absences,
    truncations: plan.truncations,
    hashVerification: { summary: hashSummary, file: 'hash-verification.json' },
    manifestSeal: {
      file: 'manifest.sha256',
      excepcion: 'manifest.json no lista su propio hash, y manifest.sha256 tampoco puede listarse a sí mismo. Para probar la integridad del manifiesto, sella manifest.sha256 externamente (p. ej. en el handoff).',
    },
    counts: {
      analysisRun: analysisOut?.counts ?? null,
      experiment: experimentOut?.counts ?? null,
    },
    files,
  }));

  return {
    outDir,
    entries,
    summary: {
      files: entries.length,
      absences: plan.absences.length,
      truncations: plan.truncations.length,
      hashVerification: hashSummary,
    },
  };
}

/** Construye y escribe el paquete. Devuelve un resumen sin valores sensibles. */
export async function runExtraction(deps) {
  const built = await buildExtractionPackage(deps);
  await writePackageFiles(built.outDir, built.entries);
  return { outDir: built.outDir, summary: built.summary };
}
