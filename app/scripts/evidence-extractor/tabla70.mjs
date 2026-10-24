// WI-CORE-094: autorrelleno parcial de la Tabla 70 (Anexo L de la tesis). Solo Fecha, Proyecto/snapshot/Run y Tipo
// (parcial) se rellenan desde datos; el resto se declara manual. No modifica ningún documento: genera un JSON de apoyo.
import { snapshotRefFor } from './uuid.mjs';

const CATEGORY_RULES = Object.freeze([
  [/^(?:hashes\.txt|hash-verification\.json|manifest\.sha256)$/, 'hash'],
  [/^(?:manifest\.json|trace-9-links\.json|sandbox-evidence\.json|context-traces\.json|tabla70-autofill\.json|README\.txt)$/, 'log'],
  [/^(?:experiment\.json|analysis-run\.json|.*\.csv)$/, 'dataset'],
  [/^(?:tests|generated-tests)\//, 'dataset'],
]);

/** Categoría de Tipo (dataset, log, hash, configuración) de un archivo del paquete. */
export function categoryOf(relativePath) {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(relativePath)) return category;
  }
  return 'configuración';
}

/**
 * Construye `tabla70-autofill.json`. `analysis` y `experiment` son las filas leídas (o null); `filePaths` son las rutas
 * del paquete (sin este archivo). `generatedAt` es la fecha de extracción.
 */
export function buildTabla70({ generatedAt, analysis, experiment, filePaths }) {
  const headSha = analysis?.run?.headSha ?? experiment?.experiment?.commitSha ?? experiment?.projectVersion?.commitSha ?? null;
  const projectVersionId = analysis?.run?.projectVersionId ?? experiment?.experiment?.projectVersionId ?? null;
  const snapshotRef = snapshotRefFor(projectVersionId, headSha);
  const project = analysis?.projectVersion ?? experiment?.projectVersion ?? null;
  return {
    schema: 'tabla70-autofill',
    schemaVersion: 1,
    table: 'Tabla 70 (Anexo L)',
    note: 'Solo se rellenan las columnas marcadas como automáticas. El resto lo completa el usuario; Estado VERIFICADA exige comprobación humana.',
    columns: {
      evidence_id: { value: null, source: 'manual (asigna el usuario; D-1)' },
      'OE/indicador': { value: null, source: 'manual' },
      Fecha: {
        value: generatedAt,
        source: 'automático: fecha de extracción (manifest.generatedAt)',
        fuentes: {
          analysisRunCreatedAt: analysis?.run?.createdAt ?? null,
          analysisRunCompletedAt: analysis?.run?.completedAt ?? null,
          experimentStartedAt: experiment?.experiment?.startedAt ?? null,
          experimentCompletedAt: experiment?.experiment?.completedAt ?? null,
        },
      },
      'Proyecto/snapshot/Run': {
        value: {
          projectId: project?.projectId ?? analysis?.run?.projectId ?? experiment?.experiment?.projectId ?? null,
          projectName: project?.projectName ?? null,
          projectVersionId,
          commitSha: headSha,
          snapshotRef,
          analysisRunId: analysis?.run?.id ?? null,
          experimentId: experiment?.experiment?.id ?? null,
          repositoryName: analysis?.run?.repositoryName ?? null,
          prNumber: analysis?.run?.prNumber ?? null,
        },
        source: 'automático: projects, project_versions, analysis_runs, experiment_runs; snapshotRef = UUIDv5 (DEC-EVID-005)',
      },
      'Ubicación maestra': { value: null, source: 'manual (ruta en la evidencia maestra del usuario)' },
      Tipo: {
        value: null,
        status: 'parcial',
        source: 'automático por archivo; la clasificación final la decide el usuario',
        porArchivo: [...filePaths].sort().map((path) => ({ path, categoria: categoryOf(path) })),
      },
      Estado: { value: null, source: 'manual: VERIFICADA solo tras comprobación humana' },
      'Qué demuestra': { value: null, source: 'manual' },
    },
  };
}
