// WI-CORE-094: extracción de un ExperimentRun: lectura (solo SELECT) y construcción de sus archivos: experimento y
// repeticiones, tests por repetición e intento (bytes exactos de la BD), copia REDACTADA de la evidencia del Sandbox,
// trazas de contexto y CSV. Nada de esto se rellena: lo que no se persistió queda declarado como ausencia.
import { CONTEXT_TRACES, PROJECT_VERSION, artifactsQuery, experimentByIdQuery, repetitionsQuery } from './queries.mjs';
import { NotFoundError, testExtension } from './analysis.mjs';
import {
  artifactHashCheck,
  canonicalJsonHashCheck,
  promptHashCheck,
  testContentHashCheck,
} from './hashes.mjs';
import { canonicalJson, sha256Hex, toCsv } from './util.mjs';
import { redactSecretsInText } from './redaction.mjs';
import { detectEnvSuspect } from './env-suspect.mjs';

/** Lectura completa del experimento. Las variantes de consulta dependen de las migraciones disponibles. */
export async function collectExperiment(session, experimentId, { trial, artifactsAvailable }) {
  const [experiment] = await session.query(experimentByIdQuery({ trial }), [experimentId]);
  if (!experiment) throw new NotFoundError(`no existe el ExperimentRun ${experimentId}`);
  const [projectVersion] = await session.query(PROJECT_VERSION, [experiment.projectVersionId]);
  const repetitions = await session.query(repetitionsQuery({ trial }), [experimentId]);
  const artifacts = artifactsAvailable ? await session.query(artifactsQuery({ trial }), [experimentId]) : [];
  const contextTraces = await session.query(CONTEXT_TRACES, [experimentId]);
  return { experiment, projectVersion: projectVersion ?? null, repetitions, artifacts, contextTraces };
}

/**
 * Quita `endpoint` de `modelConfig`: es configuración interna del proveedor y no forma parte de la evidencia.
 * Devuelve el valor saneado y si se omitió algo.
 */
export function sanitizeModelConfig(modelConfig) {
  if (modelConfig === null || typeof modelConfig !== 'object') return { value: modelConfig ?? null, endpointOmitted: false };
  const { endpoint, ...rest } = modelConfig;
  return { value: rest, endpointOmitted: endpoint !== undefined };
}

/**
 * Copia REDACTADA de un valor JSON: aplica `redactSecretsInText` a cada cadena. Devuelve el valor copiado y el número
 * de cadenas que cambiaron. Nunca se usa sobre contenido de pruebas.
 */
export function redactCopy(value) {
  let changed = 0;
  const visit = (node) => {
    if (typeof node === 'string') {
      const redacted = redactSecretsInText(node);
      if (redacted !== node) changed += 1;
      return redacted;
    }
    if (Array.isArray(node)) return node.map((item) => visit(item));
    if (node !== null && typeof node === 'object') {
      const copy = {};
      for (const key of Object.keys(node)) copy[key] = visit(node[key]);
      return copy;
    }
    return node;
  };
  return { value: visit(value), changed };
}

const ARTIFACT_FIELDS = [
  'testContent', 'testContentSha256', 'runnerReport', 'runnerReportSha256', 'sandboxEvidence', 'sandboxEvidenceSha256',
  'sandboxStartedAt', 'sandboxCompletedAt', 'sandboxEvidenceTruncated',
];

/** Artefacto con todos los campos definidos: los que faltan (o no existen en la consulta) quedan en null. */
export function normalizeArtifact(artifact) {
  const base = artifact ?? {};
  const normalized = { ...base, testContentTruncated: base.testContentTruncated === true };
  for (const field of ARTIFACT_FIELDS) normalized[field] = base[field] ?? null;
  normalized.testContent = base.testContent ?? null;
  return normalized;
}

export const REPETITION_CSV_COLUMNS = [
  'repetitionId', 'strategy', 'repetition', 'attempt', 'state', 'compiled', 'executed', 'passed', 'valid', 'failureType',
  'errorSummary', 'generationDurationMs', 'executionDurationMs', 'totalDurationMs', 'inputTokens', 'outputTokens',
  'totalTokens', 'estimatedCost', 'retrievedChunks', 'selectedChunks', 'contextTokens', 'toolCalls', 'filesInspected',
  'pairId', 'pairPosition', 'technicallyEvaluable', 'sandboxTimedOut', 'startedAt', 'finishedAt', 'promptSha256',
  'artifactHash', 'sandboxExecutionId', 'sandboxRequestId', 'sandboxCorrelationId', 'testFile', 'testContentTruncated',
  'verificacion', 'envSuspect',
];

function repetitionKey(repetition) {
  return `${repetition.strategy}/${repetition.repetition}-${repetition.attempt}`;
}

/**
 * Añade al plan los archivos del experimento. Devuelve las comprobaciones de hash por repetición y los recuentos.
 */
export function buildExperimentPart({ plan, raw, trial, artifactsAvailable }) {
  const { experiment, projectVersion, repetitions, artifacts, contextTraces } = raw;
  const extension = testExtension(projectVersion?.language);
  const artifactByRepetition = new Map(artifacts.map((artifact) => [artifact.repetitionId, artifact]));
  const { value: modelConfig, endpointOmitted } = sanitizeModelConfig(experiment.modelConfig);

  if (!artifactsAvailable) {
    plan.absence(
      'experiment_repetition_artifacts',
      'migración 20261013100000_experiment_repetition_artifacts no aplicada: sin tests, runnerReport ni evidencia del Sandbox',
      'experiment',
    );
  }
  if (!trial) {
    plan.absence(
      'columnas de la reconstrucción del trial',
      'migración 20261013110000_experiment_trial_reconstruction no aplicada: analysisRunId, commitSha, startedAt, finishedAt, promptSha256 y evidencia del Sandbox no disponibles',
      'experiment',
    );
  }

  const repetitionRows = [];
  const hashChecks = [];
  const sandboxEntries = [];
  let redactedStrings = 0;
  let testFiles = 0;

  for (const repetition of repetitions) {
    const key = repetitionKey(repetition);
    const artifact = artifactByRepetition.get(repetition.id) ?? null;
    // Campos ausentes en la consulta (variante sin migración trial) o sin fila: null, nunca undefined.
    const persisted = normalizeArtifact(artifact);
    let testFile = '';

    if (artifactsAvailable && artifact === null) {
      plan.absence(`artefacto ${key}`, 'no hay fila en experiment_repetition_artifacts (repetición sin evidencia persistida)', 'experiment');
    }

    if (persisted.testContent !== null && persisted.testContent !== undefined) {
      const base = `tests/${repetition.strategy}/${repetition.repetition}-${repetition.attempt}`;
      testFile = `${base}.${extension}`;
      const bytes = Buffer.from(persisted.testContent, 'utf8');
      plan.addBytes(testFile, bytes);
      testFiles += 1;
      const contentCheck = testContentHashCheck(persisted);
      plan.addJson(`${base}.meta.json`, {
        repetitionId: repetition.id,
        strategy: repetition.strategy,
        repetition: repetition.repetition,
        attempt: repetition.attempt,
        file: testFile,
        bytes: bytes.length,
        testContentTruncated: persisted.testContentTruncated === true,
        testContentSha256: persisted.testContentSha256,
        sha256OfFileBytes: sha256Hex(bytes),
        verificacion: contentCheck,
        note: 'El archivo contiene los bytes exactos de experiment_repetition_artifacts.testContent (sin redactar).',
      });
      if (persisted.testContentTruncated === true) {
        plan.truncation(`testContent ${key}`, 'truncado a 256 KiB UTF-8: testContentSha256 cubre el contenido completo', testFile);
      }
    } else {
      plan.absence(`tests ${key}`, 'sin contenido de prueba persistido', 'experiment');
    }

    if (persisted.sandboxEvidence === null && artifactsAvailable && artifact !== null && trial) {
      plan.absence(`sandboxEvidence ${key}`, 'sin evidencia del Sandbox (no se invocó, fallo previo o fila anterior a la migración)', 'experiment');
    }
    if (persisted.runnerReport !== null && persisted.runnerReport !== undefined && persisted.runnerReport.testCasesTruncated) {
      plan.truncation(
        `runnerReport.testCases ${key}`,
        `${persisted.runnerReport.testCasesOmitted ?? 0} casos omitidos (máximo 200 por repetición)`,
        null,
      );
    }
    if (persisted.sandboxEvidenceTruncated === true) {
      plan.truncation(
        `sandboxEvidence ${key}`,
        'recortado: 8 KiB por entrada y 40 KiB en total (Core), y/o recortado por el Sandbox (64 KiB por captura)',
        'sandbox-evidence.json',
      );
    }

    const verificacionChecks = [
      testContentHashCheck(persisted),
      artifactHashCheck(repetition, artifact),
      canonicalJsonHashCheck('runnerReportSha256', persisted.runnerReportSha256, persisted.runnerReport),
      canonicalJsonHashCheck('sandboxEvidenceSha256', persisted.sandboxEvidenceSha256, persisted.sandboxEvidence),
      promptHashCheck(repetition.promptSha256),
    ];
    hashChecks.push({
      scope: 'repeticion',
      key,
      repetitionId: repetition.id,
      checks: verificacionChecks,
    });

    if (persisted.runnerReport !== null || persisted.sandboxEvidence !== null) {
      const runnerCopy = redactCopy(persisted.runnerReport);
      const evidenceCopy = redactCopy(persisted.sandboxEvidence);
      redactedStrings += runnerCopy.changed + evidenceCopy.changed;
      sandboxEntries.push({
        key,
        repetitionId: repetition.id,
        strategy: repetition.strategy,
        repetition: repetition.repetition,
        attempt: repetition.attempt,
        sandboxStartedAt: persisted.sandboxStartedAt ?? null,
        sandboxCompletedAt: persisted.sandboxCompletedAt ?? null,
        sandboxEvidenceTruncated: persisted.sandboxEvidenceTruncated ?? null,
        runnerReport: runnerCopy.value,
        sandboxEvidence: evidenceCopy.value,
        digests: {
          runnerReportSha256Persisted: persisted.runnerReportSha256 ?? null,
          runnerReportSha256OfCopy: persisted.runnerReport ? sha256Hex(canonicalJson(runnerCopy.value)) : null,
          sandboxEvidenceSha256Persisted: persisted.sandboxEvidenceSha256 ?? null,
          sandboxEvidenceSha256OfCopy: persisted.sandboxEvidence ? sha256Hex(canonicalJson(evidenceCopy.value)) : null,
        },
        redactedStrings: runnerCopy.changed + evidenceCopy.changed,
      });
    }

    const errorCopy = redactCopy({ errorSummary: repetition.errorSummary ?? null, failure: repetition.failure ?? null });
    const repetitionOut = {
      ...repetition,
      errorSummary: errorCopy.value.errorSummary,
      failure: errorCopy.value.failure,
      testFile: testFile || null,
      testContentTruncated: persisted.testContentTruncated === true,
    };
    redactedStrings += errorCopy.changed;
    repetitionRows.push({
      ...repetitionOut,
      repetitionId: repetition.id,
      testFile,
      verificacion: verificacionChecks.map((check) => `${check.name}=${check.verdict}`).join('; '),
    });
  }

  plan.addJson('experiment.json', {
    schema: 'experiment',
    schemaVersion: 1,
    experiment: {
      ...experiment,
      modelConfig,
      analysisRunId: experiment.analysisRunId ?? null,
      commitSha: experiment.commitSha ?? null,
    },
    projectVersion,
    omitted: endpointOmitted ? ['modelConfig.endpoint (configuración interna del proveedor)'] : [],
    repetitions: repetitionRows.map((row) => ({ ...row, failure: row.failure ?? null })),
  });

  plan.addText(
    'repetitions.csv',
    toCsv(
      REPETITION_CSV_COLUMNS,
      repetitionRows.map((row) => ({
        ...row,
        repetitionId: row.repetitionId,
        // WI-CORE-105: informativo (no es veredicto ni puntuación); reglas declaradas en env-suspect.mjs.
        envSuspect: detectEnvSuspect({ failureType: row.failureType, errorSummary: row.errorSummary }).join(';'),
      })),
    ),
  );

  plan.addJson('context-traces.json', {
    schema: 'context-traces',
    schemaVersion: 1,
    note: 'detail tal como se persistió: los fragmentos (snippet) están acotados a 2000 caracteres y el texto completo entregado al LLM no se guarda.',
    traces: contextTraces,
  });

  plan.addJson('sandbox-evidence.json', {
    schema: 'sandbox-evidence-copy',
    schemaVersion: 1,
    note: 'COPIA redactada de la evidencia del Sandbox (secretos sustituidos por [REDACTED]). Los hashes persistidos se verifican sobre la base; los de la copia son independientes.',
    redactedStrings,
    repetitions: sandboxEntries,
  });

  return {
    hashChecks,
    counts: { repetitions: repetitions.length, testFiles, sandboxEntries: sandboxEntries.length, redactedStrings },
  };
}
