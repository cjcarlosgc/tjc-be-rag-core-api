// WI-CORE-094: trace de los 9 enlaces de un AnalysisRun (sentido directo) y resultado del chequeo inverso. Función pura:
// recibe filas ya leídas y los recuentos de las comprobaciones inversas. Veredictos: PRESENT, NOT_APPLICABLE
// (sin filas en el enlace) e INCONSISTENT (una comprobación inversa encontró filas que rompen el enlace).
// No verifica PR/HEAD contra GitHub: eso no es posible con SELECT.

export const LINK_VERDICT = Object.freeze({
  PRESENT: 'PRESENT',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  INCONSISTENT: 'INCONSISTENT',
});

const TARGET_KINDS = new Set(['METHOD', 'FUNCTION']);

function linkVerdict(count) {
  return count > 0 ? LINK_VERDICT.PRESENT : LINK_VERDICT.NOT_APPLICABLE;
}

/** Enlaces 1–9 del sentido directo, con su tabla, recuento de filas y una muestra de identificadores. */
export function buildDirectLinks({ run, symbols, retrievals, contexts, proposals, executions, publications }) {
  const targets = symbols.filter((symbol) => symbol.changeKind === 'DIRECTLY_CHANGED' && TARGET_KINDS.has(symbol.kind));
  const withResult = executions.filter((execution) => execution.outcome !== null && execution.outcome !== undefined);
  const hasCheck = run.checkId !== null || run.checkPublishedAt !== null;
  return [
    {
      number: 1,
      name: 'repo/PR/HEAD',
      tables: ['analysis_runs'],
      count: 1,
      verdict: LINK_VERDICT.PRESENT,
      sample: {
        repositoryName: run.repositoryName,
        prNumber: run.prNumber,
        baseSha: run.baseSha,
        headSha: run.headSha,
        changesetBaseSha: run.changesetBaseSha,
        changesetHeadSha: run.changesetHeadSha,
      },
    },
    {
      number: 2,
      name: 'AnalysisRun',
      tables: ['analysis_runs'],
      count: 1,
      verdict: LINK_VERDICT.PRESENT,
      sample: { id: run.id, status: run.status, createdAt: run.createdAt, completedAt: run.completedAt },
    },
    {
      number: 3,
      name: 'changeset/targets',
      tables: ['analysis_symbols'],
      count: targets.length,
      verdict: linkVerdict(targets.length),
      sample: { ids: targets.slice(0, 20).map((symbol) => symbol.id) },
    },
    {
      number: 4,
      name: 'retrieval',
      tables: ['analysis_retrievals'],
      count: retrievals.length,
      verdict: linkVerdict(retrievals.length),
      sample: { ids: retrievals.slice(0, 20).map((row) => row.id) },
    },
    {
      number: 5,
      name: 'context',
      tables: ['analysis_contexts'],
      count: contexts.length,
      verdict: linkVerdict(contexts.length),
      sample: { ids: contexts.slice(0, 20).map((row) => row.id) },
    },
    {
      number: 6,
      name: 'generation',
      tables: ['generated_test_proposals'],
      count: proposals.length,
      verdict: linkVerdict(proposals.length),
      sample: { ids: proposals.slice(0, 20).map((row) => row.id) },
    },
    {
      number: 7,
      name: 'Sandbox',
      tables: ['analysis_run_executions'],
      count: executions.length,
      verdict: linkVerdict(executions.length),
      sample: { ids: executions.slice(0, 20).map((row) => row.id) },
    },
    {
      number: 8,
      name: 'results',
      tables: ['analysis_run_executions', 'generated_test_proposals', 'analysis_runs'],
      count: withResult.length,
      verdict: linkVerdict(withResult.length),
      sample: { outcomes: [...new Set(withResult.map((row) => row.outcome))].sort(), runStatus: run.status },
    },
    {
      number: 9,
      name: 'publication/check',
      tables: ['test_publications', 'analysis_runs'],
      count: publications.length + (hasCheck ? 1 : 0),
      verdict: linkVerdict(publications.length + (hasCheck ? 1 : 0)),
      sample: { publicationIds: publications.slice(0, 20).map((row) => row.id), checkPublished: hasCheck },
    },
  ];
}

const SOURCE_COUNT = {
  executions: (data) => data.executions.length,
  proposals: (data) => data.proposals.length,
  contexts: (data) => data.contexts.length,
  retrievals: (data) => data.retrievals.length,
  publications: (data) => data.publications.length,
};

/**
 * Resultado de una comprobación inversa. `rowCount` son las filas que ROMPEN el enlace (deben ser 0). Sin filas de
 * origen el enlace es NOT_APPLICABLE; con 0 filas rotas es PRESENT; con filas rotas es INCONSISTENT.
 */
export function inverseVerdict({ check, rowCount, sourceCount }) {
  if (sourceCount === 0) return LINK_VERDICT.NOT_APPLICABLE;
  return rowCount === 0 ? LINK_VERDICT.PRESENT : LINK_VERDICT.INCONSISTENT;
}

/** Construye el objeto completo de `trace-9-links.json`. */
export function buildTrace({ runId, run, data, inverseResults, generatedAt }) {
  const directLinks = buildDirectLinks({ run, ...data });
  const inverseChecks = inverseResults.map(({ check, rowCount }) => {
    const sourceCount = SOURCE_COUNT[check.sourceKey](data);
    return {
      id: check.id,
      link: check.link,
      description: check.description,
      sql: check.sql,
      params: check.params,
      sourceCount,
      rowCount,
      verdict: inverseVerdict({ check, rowCount, sourceCount }),
    };
  });
  const inconsistentLinks = [...new Set(inverseChecks.filter((item) => item.verdict === LINK_VERDICT.INCONSISTENT).map((item) => item.link))];
  for (const link of directLinks) {
    if (inconsistentLinks.includes(link.number)) link.verdict = LINK_VERDICT.INCONSISTENT;
  }
  return {
    schema: 'trace-9-links',
    schemaVersion: 1,
    generatedAt,
    analysisRunId: runId,
    directLinks,
    inverseChecks,
    notes: [
      'Sentido directo: enlaces 1 a 9 leídos de la base. Sin filas = NOT_APPLICABLE; la auditoría decide si es N/A justificado o incumplimiento.',
      'Chequeo inverso: cada consulta cuenta filas que rompen el enlace; 0 filas = PRESENT; más de 0 = INCONSISTENT.',
      'No se verifica el PR ni el HEAD contra GitHub: requiere GitHub Integration y no se consulta desde el extractor.',
    ],
  };
}
