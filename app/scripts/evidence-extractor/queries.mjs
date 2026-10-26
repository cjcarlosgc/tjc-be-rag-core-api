// WI-CORE-094: consultas de solo lectura del extractor. Cada consulta es una constante con identificadores camelCase
// entre comillas dobles (los de Prisma) y parámetros posicionales ($1, $2). Ninguna interpola valores del usuario.
// Todas pasan por `assertReadOnlySql` antes de enviarse (ver `session.mjs`).
//
// `json`: columnas JSON/JSONB que el adaptador de Prisma devuelve como texto y que el extractor parsea.

const sel = (alias, names) => names.map((name) => `${alias}."${name}"`).join(', ');

// ---------------------------------------------------------------------------------------------------------------
// Sondeo de esquema: tablas (to_regclass) y columnas (information_schema). Solo nombres constantes.
// ---------------------------------------------------------------------------------------------------------------

/** Grupos de esquema que el extractor necesita. Si un grupo falta, la parte correspondiente se declara ausente. */
export const SCHEMA_GROUPS = Object.freeze({
  experimentCore: {
    label: 'Experimentos (ExperimentRun, repeticiones, trazas de contexto)',
    columns: {
      experiment_runs: [
        'id', 'projectId', 'projectVersionId', 'targetId', 'status', 'completedRepetitions', 'totalRepetitions',
        'failureCode', 'failureMessage', 'startedAt', 'completedAt', 'modelConfig', 'randomizationSeed', 'budget',
        'executionProfile', 'runnerHint', 'createdAt',
      ],
      experiment_repetitions: [
        'id', 'experimentId', 'repetition', 'strategy', 'attempt', 'state', 'compiled', 'executed', 'passed', 'valid',
        'failureType', 'errorSummary', 'generationDurationMs', 'executionDurationMs', 'totalDurationMs', 'inputTokens',
        'outputTokens', 'totalTokens', 'estimatedCost', 'retrievedChunks', 'selectedChunks', 'contextTokens',
        'toolCalls', 'filesInspected', 'trajectory', 'pairId', 'pairPosition', 'technicallyEvaluable',
        'sandboxTimedOut', 'failure', 'sandboxExecutionId', 'sandboxRequestId', 'sandboxCorrelationId',
        'sandboxFacts', 'artifactHash', 'createdAt',
      ],
      context_traces: [
        'experimentRepetitionId', 'experimentId', 'kind', 'strategy', 'repetition', 'attempt', 'current', 'state',
        'detail', 'toolCalls', 'filesInspected',
      ],
      project_versions: ['id', 'projectId', 'commitSha', 'status', 'language'],
      projects: ['id', 'name'],
    },
  },
  experimentTrial: {
    label: 'Reconstrucción del trial (migración 20261013110000_experiment_trial_reconstruction)',
    migration: '20261013110000_experiment_trial_reconstruction',
    columns: {
      experiment_runs: ['analysisRunId', 'commitSha'],
      experiment_repetitions: ['startedAt', 'finishedAt', 'promptSha256'],
      experiment_repetition_artifacts: [
        'sandboxEvidence', 'sandboxEvidenceSha256', 'sandboxEvidenceTruncated', 'sandboxStartedAt', 'sandboxCompletedAt',
      ],
    },
  },
  repetitionArtifacts: {
    label: 'Evidencia por repetición (migración 20261013100000_experiment_repetition_artifacts)',
    migration: '20261013100000_experiment_repetition_artifacts',
    columns: {
      experiment_repetition_artifacts: [
        'id', 'repetitionId', 'testContent', 'testContentSha256', 'testContentTruncated', 'runnerReport',
        'runnerReportSha256',
      ],
    },
  },
  analysisRun: {
    label: 'AnalysisRun (trace de 9 enlaces, propuestas, ejecuciones del Sandbox y publicaciones)',
    columns: {
      analysis_runs: [
        'id', 'projectId', 'repositoryId', 'repositoryName', 'prNumber', 'prTitle', 'baseRef', 'headRef', 'baseSha',
        'headSha', 'changesetBaseSha', 'changesetHeadSha', 'actorLogin', 'status', 'current', 'attemptCount',
        'indexMode', 'projectVersionId', 'functionalBehaviorValidated', 'actionRequiredCount', 'generatedTestsCount',
        'resultSummary', 'checkId', 'checkPublishedAt', 'completedAt', 'createdAt',
      ],
      analysis_symbols: [
        'id', 'analysisRunId', 'language', 'kind', 'qualifiedName', 'filePath', 'changeKind', 'createdAt',
      ],
      analysis_retrievals: ['id', 'analysisRunId', 'analysisSymbolId', 'mode', 'createdAt'],
      analysis_contexts: [
        'id', 'analysisRunId', 'analysisSymbolId', 'retrievalId', 'selectedChunkIds', 'discardedChunkIds',
        'selectedTokens', 'tokenBudget', 'functionalRuleIds', 'functionalRulesRetrieved', 'functionalRulesSelected',
        'functionalRulesOmitted', 'omittedFunctionalRules', 'createdAt',
      ],
      generated_test_proposals: [
        'id', 'analysisRunId', 'analysisSymbolId', 'contextId', 'relativePath', 'symbolLanguage', 'symbolKind',
        'qualifiedName', 'filePath', 'storageKey', 'contentSha256', 'status', 'failureSummary', 'generation', 'createdAt',
      ],
      analysis_run_executions: [
        'id', 'analysisRunId', 'proposalId', 'executionId', 'attempt', 'executionProfile', 'outcome', 'requestId',
        'correlationId', 'durationMs', 'facts', 'failure', 'createdAt',
      ],
      test_publications: [
        'id', 'analysisRunId', 'proposalIds', 'sourceHeadSha', 'status', 'branchName', 'companionPullRequestNumber',
        'companionPullRequestUrl', 'failureMessage', 'createdAt',
      ],
      project_versions: ['id', 'projectId', 'commitSha', 'status', 'language'],
      projects: ['id', 'name'],
    },
  },
});

export const MIGRATION_NAMES = Object.freeze([
  '20261013100000_experiment_repetition_artifacts',
  '20261013110000_experiment_trial_reconstruction',
]);

/** Tablas que se sondean con to_regclass (incluye la de control de migraciones de Prisma). */
export function probedTableNames() {
  const names = new Set(['_prisma_migrations']);
  for (const group of Object.values(SCHEMA_GROUPS)) {
    for (const table of Object.keys(group.columns)) names.add(table);
  }
  return [...names].sort();
}

/** Sondeo de existencia de tablas: una fila con una columna booleana por tabla (alias = nombre de tabla). */
export function probeTablesQuery() {
  const parts = probedTableNames().map(
    (table) => `to_regclass('public.${table}') IS NOT NULL AS "${table}"`,
  );
  return { id: 'probeTables', sql: `SELECT ${parts.join(', ')}` };
}

/** Sondeo de columnas de las tablas del esquema, desde information_schema (solo lectura). */
export function probeColumnsQuery() {
  const tables = probedTableNames().map((table) => `'${table}'`).join(', ');
  return {
    id: 'probeColumns',
    sql: `SELECT c."table_name" AS "tableName", c."column_name" AS "columnName" FROM information_schema.columns c WHERE c."table_schema" = 'public' AND c."table_name" IN (${tables})`,
  };
}

export const PRISMA_MIGRATIONS_QUERY = {
  id: 'prismaMigrations',
  sql: `SELECT m."migration_name" AS "migrationName", m."finished_at" AS "finishedAt" FROM "_prisma_migrations" m WHERE m."migration_name" IN ('20261013100000_experiment_repetition_artifacts', '20261013110000_experiment_trial_reconstruction')`,
};

// ---------------------------------------------------------------------------------------------------------------
// AnalysisRun
// ---------------------------------------------------------------------------------------------------------------

export const ANALYSIS_RUN_BY_ID = {
  id: 'analysisRunById',
  sql: `SELECT ${sel('r', SCHEMA_GROUPS.analysisRun.columns.analysis_runs)} FROM "analysis_runs" r WHERE r."id" = $1`,
};

export const ANALYSIS_SYMBOLS = {
  id: 'analysisSymbols',
  sql: `SELECT ${sel('s', SCHEMA_GROUPS.analysisRun.columns.analysis_symbols)} FROM "analysis_symbols" s WHERE s."analysisRunId" = $1 ORDER BY s."createdAt", s."id"`,
};

export const ANALYSIS_RETRIEVALS = {
  id: 'analysisRetrievals',
  sql: `SELECT ${sel('r', SCHEMA_GROUPS.analysisRun.columns.analysis_retrievals)} FROM "analysis_retrievals" r WHERE r."analysisRunId" = $1 ORDER BY r."createdAt", r."id"`,
};

export const ANALYSIS_CONTEXTS = {
  id: 'analysisContexts',
  json: ['omittedFunctionalRules'],
  sql: `SELECT ${sel('c', SCHEMA_GROUPS.analysisRun.columns.analysis_contexts)} FROM "analysis_contexts" c WHERE c."analysisRunId" = $1 ORDER BY c."createdAt", c."id"`,
};

export const GENERATED_TEST_PROPOSALS = {
  id: 'generatedTestProposals',
  json: ['generation'],
  sql: `SELECT ${sel('p', SCHEMA_GROUPS.analysisRun.columns.generated_test_proposals)} FROM "generated_test_proposals" p WHERE p."analysisRunId" = $1 ORDER BY p."qualifiedName", p."id"`,
};

export const ANALYSIS_RUN_EXECUTIONS = {
  id: 'analysisRunExecutions',
  json: ['facts', 'failure'],
  sql: `SELECT ${sel('e', SCHEMA_GROUPS.analysisRun.columns.analysis_run_executions)} FROM "analysis_run_executions" e WHERE e."analysisRunId" = $1 ORDER BY e."createdAt", e."attempt", e."id"`,
};

export const TEST_PUBLICATIONS = {
  id: 'testPublications',
  sql: `SELECT ${sel('t', SCHEMA_GROUPS.analysisRun.columns.test_publications)} FROM "test_publications" t WHERE t."analysisRunId" = $1 ORDER BY t."createdAt", t."id"`,
};

/** Versión del proyecto con el nombre del proyecto (una fila por `projectVersionId`). */
export const PROJECT_VERSION = {
  id: 'projectVersion',
  sql: `SELECT v."id" AS "projectVersionId", v."projectId" AS "projectId", v."commitSha" AS "commitSha", v."status" AS "status", v."language" AS "language", p."name" AS "projectName" FROM "project_versions" v JOIN "projects" p ON p."id" = v."projectId" WHERE v."id" = $1`,
};

/**
 * Comprobaciones inversas del trace de 9 enlaces. Cada una cuenta filas que ROMPEN el enlace: 0 filas = el enlace
 * se sostiene; más de 0 = INCONSISTENT. `sourceKey` indica el conjunto de origen para decidir N/A (sin origen).
 */
export const INVERSE_CHECKS = Object.freeze([
  {
    id: 'executionProposalOtherRun',
    link: 7,
    description: 'Ejecución del Sandbox cuya propuesta pertenece a otro AnalysisRun',
    sourceKey: 'executions',
    params: ['runId'],
    sql: `SELECT count(*) AS "rowCount" FROM "analysis_run_executions" e JOIN "generated_test_proposals" p ON p."id" = e."proposalId" WHERE e."analysisRunId" = $1 AND p."analysisRunId" <> e."analysisRunId"`,
  },
  {
    id: 'proposalContextOtherRunOrSymbol',
    link: 5,
    description: 'Propuesta cuyo contexto pertenece a otro AnalysisRun o a otro símbolo',
    sourceKey: 'proposals',
    params: ['runId'],
    sql: `SELECT count(*) AS "rowCount" FROM "generated_test_proposals" p JOIN "analysis_contexts" c ON c."id" = p."contextId" WHERE p."analysisRunId" = $1 AND (c."analysisRunId" <> p."analysisRunId" OR c."analysisSymbolId" <> p."analysisSymbolId")`,
  },
  {
    id: 'contextRetrievalOtherRunOrSymbol',
    link: 5,
    description: 'Contexto cuyo retrieval pertenece a otro AnalysisRun o a otro símbolo',
    sourceKey: 'contexts',
    params: ['runId'],
    sql: `SELECT count(*) AS "rowCount" FROM "analysis_contexts" c JOIN "analysis_retrievals" r ON r."id" = c."retrievalId" WHERE c."analysisRunId" = $1 AND (r."analysisRunId" <> c."analysisRunId" OR r."analysisSymbolId" <> c."analysisSymbolId")`,
  },
  {
    id: 'retrievalSymbolOtherRun',
    link: 4,
    description: 'Retrieval cuyo símbolo pertenece a otro AnalysisRun',
    sourceKey: 'retrievals',
    params: ['runId'],
    sql: `SELECT count(*) AS "rowCount" FROM "analysis_retrievals" r JOIN "analysis_symbols" s ON s."id" = r."analysisSymbolId" WHERE r."analysisRunId" = $1 AND s."analysisRunId" <> r."analysisRunId"`,
  },
  {
    id: 'proposalStorageKeyOtherRun',
    link: 6,
    description: 'Propuesta cuyo storageKey no empieza por el prefijo de su AnalysisRun',
    sourceKey: 'proposals',
    params: ['runId', 'storagePrefix'],
    sql: `SELECT count(*) AS "rowCount" FROM "generated_test_proposals" p WHERE p."analysisRunId" = $1 AND left(p."storageKey", length(CAST($2 AS TEXT))) <> CAST($2 AS TEXT)`,
  },
  {
    id: 'publicationProposalOutsideRun',
    link: 9,
    description: 'Publicación que incluye propuestas que no pertenecen a su AnalysisRun',
    sourceKey: 'publications',
    params: ['runId'],
    sql: `SELECT count(*) AS "rowCount" FROM "test_publications" t WHERE t."analysisRunId" = $1 AND NOT (t."proposalIds" <@ ARRAY(SELECT p."id" FROM "generated_test_proposals" p WHERE p."analysisRunId" = $1))`,
  },
  {
    id: 'publicationHeadNotRunHead',
    link: 9,
    description: 'Publicación validada contra un HEAD distinto del HEAD del Run (sourceHeadSha <> headSha)',
    sourceKey: 'publications',
    params: ['runId'],
    sql: `SELECT count(*) AS "rowCount" FROM "test_publications" t JOIN "analysis_runs" r ON r."id" = t."analysisRunId" WHERE t."analysisRunId" = $1 AND t."sourceHeadSha" <> r."headSha"`,
  },
]);

// ---------------------------------------------------------------------------------------------------------------
// Experimentos
// ---------------------------------------------------------------------------------------------------------------

const EXPERIMENT_BASE_COLUMNS = [
  'id', 'projectId', 'projectVersionId', 'targetId', 'status', 'completedRepetitions', 'totalRepetitions',
  'failureCode', 'failureMessage', 'startedAt', 'completedAt', 'modelConfig', 'randomizationSeed', 'budget',
  'executionProfile', 'runnerHint', 'createdAt',
];

/** Experimento por id; la variante trial añade `analysisRunId` y `commitSha` (migración 20261013110000). */
export function experimentByIdQuery({ trial }) {
  const columns = trial ? [...EXPERIMENT_BASE_COLUMNS, 'analysisRunId', 'commitSha'] : EXPERIMENT_BASE_COLUMNS;
  return {
    id: trial ? 'experimentByIdTrial' : 'experimentByIdBase',
    json: ['modelConfig', 'budget'],
    sql: `SELECT ${sel('e', columns)} FROM "experiment_runs" e WHERE e."id" = $1`,
  };
}

const REPETITION_BASE_COLUMNS = [
  'id', 'repetition', 'strategy', 'attempt', 'state', 'compiled', 'executed', 'passed', 'valid', 'failureType',
  'errorSummary', 'generationDurationMs', 'executionDurationMs', 'totalDurationMs', 'inputTokens', 'outputTokens',
  'totalTokens', 'estimatedCost', 'retrievedChunks', 'selectedChunks', 'contextTokens', 'toolCalls', 'filesInspected',
  'trajectory', 'pairId', 'pairPosition', 'technicallyEvaluable', 'sandboxTimedOut', 'failure', 'sandboxExecutionId',
  'sandboxRequestId', 'sandboxCorrelationId', 'sandboxFacts', 'artifactHash', 'createdAt',
];

/** Repeticiones del experimento (una fila por estrategia, repetición e intento). */
export function repetitionsQuery({ trial }) {
  const columns = trial ? [...REPETITION_BASE_COLUMNS, 'startedAt', 'finishedAt', 'promptSha256'] : REPETITION_BASE_COLUMNS;
  return {
    id: trial ? 'repetitionsTrial' : 'repetitionsBase',
    json: ['trajectory', 'failure', 'sandboxFacts'],
    sql: `SELECT ${sel('r', columns)} FROM "experiment_repetitions" r WHERE r."experimentId" = $1 ORDER BY r."strategy", r."repetition", r."attempt", r."id"`,
  };
}

/** Artefactos por repetición: contenido de prueba y reporte del runner; la variante trial añade la evidencia del Sandbox. */
export function artifactsQuery({ trial }) {
  const extra = trial
    ? ', a."sandboxEvidence", a."sandboxEvidenceSha256", a."sandboxEvidenceTruncated", a."sandboxStartedAt", a."sandboxCompletedAt"'
    : '';
  return {
    id: trial ? 'artifactsTrial' : 'artifactsBase',
    json: trial ? ['runnerReport', 'sandboxEvidence'] : ['runnerReport'],
    sql: `SELECT a."id", a."repetitionId", a."testContent", a."testContentSha256", a."testContentTruncated", a."runnerReport", a."runnerReportSha256"${extra} FROM "experiment_repetition_artifacts" a JOIN "experiment_repetitions" r ON r."id" = a."repetitionId" WHERE r."experimentId" = $1 ORDER BY r."strategy", r."repetition", r."attempt"`,
  };
}

export const CONTEXT_TRACES = {
  id: 'contextTraces',
  json: ['detail'],
  sql: `SELECT t."experimentRepetitionId", t."kind", t."strategy", t."repetition", t."attempt", t."current", t."state", t."detail", t."toolCalls", t."filesInspected" FROM "context_traces" t WHERE t."experimentId" = $1 ORDER BY t."strategy", t."repetition", t."attempt", t."kind"`,
};

// ---------------------------------------------------------------------------------------------------------------
// OE2 (WI-CORE-107, `scripts/oe2`): volcados de chunks y de comparaciones de retrieval. Solo lectura.
// ---------------------------------------------------------------------------------------------------------------

/** Chunks de una ProjectVersion. El orden lo fija el CLI en JavaScript (no depende de la collation de la base). */
export const OE2_CODE_CHUNKS = {
  id: 'oe2CodeChunks',
  sql: `SELECT c."filePath" AS "filePath", c."symbolKind" AS "symbolKind", c."symbolName" AS "symbolName", c."parentSymbolName" AS "parentSymbolName", c."startLine" AS "startLine", c."endLine" AS "endLine", c."partIndex" AS "partIndex", c."partsTotal" AS "partsTotal", c."importsUsed" AS "importsUsed", c."tokenCount" AS "tokenCount", c."content" AS "content" FROM "code_chunks" c WHERE c."projectVersionId" = $1`,
};

/** Comparaciones de retrieval de un AnalysisRun (sin verdad de terreno: no se exporta). */
export const OE2_COMPARISONS_BY_RUN = {
  id: 'oe2ComparisonsByRun',
  json: ['symbol'],
  sql: `SELECT c."id" AS "id", c."analysisRunId" AS "analysisRunId", c."projectVersionId" AS "projectVersionId", c."symbol" AS "symbol", c."status" AS "status", c."completedAt" AS "completedAt" FROM "retrieval_comparisons" c WHERE c."analysisRunId" = $1 ORDER BY c."createdAt" ASC, c."id" ASC`,
};

/** Comparación de retrieval por id. */
export const OE2_COMPARISON_BY_ID = {
  id: 'oe2ComparisonById',
  json: ['symbol'],
  sql: `SELECT c."id" AS "id", c."analysisRunId" AS "analysisRunId", c."projectVersionId" AS "projectVersionId", c."symbol" AS "symbol", c."status" AS "status", c."completedAt" AS "completedAt" FROM "retrieval_comparisons" c WHERE c."id" = $1`,
};

/** Resultados por modo (SE y SEM) de una comparación. */
export const OE2_COMPARISON_RESULTS = {
  id: 'oe2ComparisonResults',
  json: ['config', 'candidates', 'metrics'],
  sql: `SELECT r."id" AS "id", r."comparisonId" AS "comparisonId", r."mode" AS "mode", r."config" AS "config", r."candidates" AS "candidates", r."metrics" AS "metrics" FROM "retrieval_comparison_results" r WHERE r."comparisonId" = $1 ORDER BY r."mode" ASC`,
};

/** Todas las definiciones de consulta de datos (sin contar el sondeo), para verificar que son de solo lectura. */
export function allDataQueries() {
  return [
    ANALYSIS_RUN_BY_ID, ANALYSIS_SYMBOLS, ANALYSIS_RETRIEVALS, ANALYSIS_CONTEXTS, GENERATED_TEST_PROPOSALS,
    ANALYSIS_RUN_EXECUTIONS, TEST_PUBLICATIONS, PROJECT_VERSION, CONTEXT_TRACES,
    experimentByIdQuery({ trial: false }), experimentByIdQuery({ trial: true }),
    repetitionsQuery({ trial: false }), repetitionsQuery({ trial: true }),
    artifactsQuery({ trial: false }), artifactsQuery({ trial: true }),
    ...INVERSE_CHECKS,
    OE2_CODE_CHUNKS, OE2_COMPARISONS_BY_RUN, OE2_COMPARISON_BY_ID, OE2_COMPARISON_RESULTS,
  ];
}

/**
 * Textos SQL aprobados (lista blanca exacta). `session.mjs` solo envía consultas cuyo texto figure aquí: cualquier
 * consulta nueva debe añadirse como constante en este archivo.
 */
export function approvedSqlTexts() {
  const texts = new Set([probeTablesQuery().sql, probeColumnsQuery().sql, PRISMA_MIGRATIONS_QUERY.sql]);
  for (const definition of allDataQueries()) texts.add(definition.sql);
  return texts;
}
