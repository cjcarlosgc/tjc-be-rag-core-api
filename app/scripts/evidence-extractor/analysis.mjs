// WI-CORE-094: extracción de un AnalysisRun: lectura (solo SELECT), descarga de los test generados desde Storage y
// construcción de sus archivos. La lectura y la construcción están separadas: `collectAnalysisRun` solo lee la base
// y `buildAnalysisPart` no toca nada fuera de su `PackagePlan`.
import { ANALYSIS_CONTEXTS, ANALYSIS_RETRIEVALS, ANALYSIS_RUN_BY_ID, ANALYSIS_RUN_EXECUTIONS, ANALYSIS_SYMBOLS, GENERATED_TEST_PROPOSALS, INVERSE_CHECKS, PROJECT_VERSION, TEST_PUBLICATIONS } from './queries.mjs';
import { buildTrace } from './trace.mjs';
import { storageHashCheck } from './hashes.mjs';
import { fileStem, toCsv } from './util.mjs';

/** Error de dominio: el identificador pedido no existe en la base. */
export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export const STORAGE_PREFIX = (runId) => `analysis-runs/${runId}/proposals/`;

const EXTENSION_BY_LANGUAGE = Object.freeze({ TYPESCRIPT: 'ts', PHP: 'php' });

/** Extensión del archivo de prueba según el lenguaje del símbolo o del proyecto (`txt` si no se reconoce). */
export function testExtension(language) {
  return EXTENSION_BY_LANGUAGE[language] ?? 'txt';
}

/**
 * Lee el AnalysisRun completo (solo SELECT). Lanza `NotFoundError` si el run no existe. Las comprobaciones inversas
 * se ejecutan aquí, dentro de la misma transacción de lectura.
 */
export async function collectAnalysisRun(session, runId) {
  const [run] = await session.query(ANALYSIS_RUN_BY_ID, [runId]);
  if (!run) throw new NotFoundError(`no existe el AnalysisRun ${runId}`);
  const symbols = await session.query(ANALYSIS_SYMBOLS, [runId]);
  const retrievals = await session.query(ANALYSIS_RETRIEVALS, [runId]);
  const contexts = await session.query(ANALYSIS_CONTEXTS, [runId]);
  const proposals = await session.query(GENERATED_TEST_PROPOSALS, [runId]);
  const executions = await session.query(ANALYSIS_RUN_EXECUTIONS, [runId]);
  const publications = await session.query(TEST_PUBLICATIONS, [runId]);
  const projectVersion = run.projectVersionId
    ? ((await session.query(PROJECT_VERSION, [run.projectVersionId]))[0] ?? null)
    : null;
  const inverseResults = [];
  for (const check of INVERSE_CHECKS) {
    const params = check.params.map((name) => (name === 'runId' ? runId : STORAGE_PREFIX(runId)));
    const [row] = await session.query(check, params);
    inverseResults.push({ check, rowCount: Number(row.rowCount) });
  }
  return { run, symbols, retrievals, contexts, proposals, executions, publications, projectVersion, inverseResults };
}

/** Campos del run que pasan por la política de datos personales antes de escribirse. */
export function applyPiiToRun(run, pii) {
  return {
    ...run,
    actorLogin: pii.apply('analysis_runs', 'actorLogin', run.actorLogin),
    prTitle: pii.apply('analysis_runs', 'prTitle', run.prTitle),
    baseRef: pii.apply('analysis_runs', 'baseRef', run.baseRef),
    headRef: pii.apply('analysis_runs', 'headRef', run.headRef),
  };
}

function applyPiiToPublication(publication, pii) {
  return {
    ...publication,
    branchName: pii.apply('test_publications', 'branchName', publication.branchName),
    companionPullRequestUrl: pii.apply('test_publications', 'companionPullRequestUrl', publication.companionPullRequestUrl),
  };
}

/**
 * Añade al plan los archivos del AnalysisRun. `downloads` es un Map `proposalId -> { ok, bytes } | { ok: false,
 * reason }`; una propuesta sin descarga queda como ausencia declarada. Devuelve el trace y las verificaciones.
 */
export function buildAnalysisPart({ plan, raw, pii, downloads, generatedAt, storageState }) {
  const { run, symbols, retrievals, contexts, proposals, executions, publications, projectVersion, inverseResults } = raw;
  const runForOutput = applyPiiToRun(run, pii);
  const publicationsForOutput = publications.map((row) => applyPiiToPublication(row, pii));

  const orderedProposals = [...proposals].sort(
    (a, b) => a.qualifiedName.localeCompare(b.qualifiedName) || a.id.localeCompare(b.id),
  );
  const generatedTests = [];
  const proposalRows = [];
  orderedProposals.forEach((proposal, index) => {
    const order = String(index + 1).padStart(2, '0');
    const extension = testExtension(proposal.symbolLanguage);
    const download = downloads.get(proposal.id) ?? { ok: false, reason: storageState };
    let file = '';
    if (download.ok === true) {
      file = `generated-tests/${order}-${fileStem(proposal.qualifiedName)}.${extension}`;
      plan.addBytes(file, download.bytes);
    } else {
      plan.absence(
        `generated-tests: propuesta ${proposal.id} (${proposal.qualifiedName})`,
        `objeto de Storage no descargado: ${download.reason}`,
        'analysis-run',
      );
    }
    const verification = storageHashCheck(proposal.contentSha256, download);
    generatedTests.push({ proposalId: proposal.id, file: file || null, check: verification });
    proposalRows.push({
      proposalId: proposal.id,
      analysisSymbolId: proposal.analysisSymbolId,
      qualifiedName: proposal.qualifiedName,
      filePath: proposal.filePath,
      symbolLanguage: proposal.symbolLanguage,
      symbolKind: proposal.symbolKind,
      status: proposal.status,
      failureSummary: proposal.failureSummary,
      contextId: proposal.contextId,
      contentSha256: proposal.contentSha256,
      file: file || '',
      bytes: download.ok === true ? download.bytes.length : '',
      verificacion: verification.verdict,
      generationModel: proposal.generation?.model ?? '',
      generationInputTokens: proposal.generation?.inputTokens ?? '',
      generationOutputTokens: proposal.generation?.outputTokens ?? '',
      generationDurationMs: proposal.generation?.durationMs ?? '',
    });
  });

  plan.addText(
    'generated-tests.csv',
    toCsv(
      [
        'proposalId', 'analysisSymbolId', 'qualifiedName', 'filePath', 'symbolLanguage', 'symbolKind', 'status',
        'failureSummary', 'contextId', 'contentSha256', 'file', 'bytes', 'verificacion', 'generationModel',
        'generationInputTokens', 'generationOutputTokens', 'generationDurationMs',
      ],
      proposalRows,
    ),
  );

  const trace = buildTrace({
    runId: run.id,
    run: runForOutput,
    data: { symbols, retrievals, contexts, proposals, executions, publications: publicationsForOutput },
    inverseResults,
    generatedAt,
  });
  plan.addJson('trace-9-links.json', trace);

  plan.addJson('analysis-run.json', {
    schema: 'analysis-run',
    schemaVersion: 1,
    run: runForOutput,
    projectVersion,
    symbols,
    retrievals,
    contexts,
    proposals: orderedProposals.map((proposal) => ({ ...proposal })),
    executions,
    publications: publicationsForOutput,
    piiPolicy: pii.report(),
  });

  return {
    trace,
    generatedTests,
    counts: {
      symbols: symbols.length,
      proposals: proposals.length,
      executions: executions.length,
      publications: publications.length,
      testsDownloaded: generatedTests.filter((item) => item.file !== null).length,
    },
  };
}
