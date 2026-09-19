import type { AnalysisRunStatus } from '../generated/prisma/client.js';
import type { CheckConclusion } from '../github-app/github-checks.service.js';

/**
 * HU39: solo los status terminales-publicables tienen conclusión. `QUEUED`,
 * `PROCESSING` y `OBSOLETE` devuelven `null` -no se publica Check para
 * ellos, `OBSOLETE` queda superseded por el Check del Run nuevo-.
 * `BASELINE_FAILED`/`INFRASTRUCTURE_FAILURE` son `neutral`: no le achacan el
 * problema al PR (`spec.md`, caso 9).
 */
export function mapRunStatusToCheckConclusion(status: AnalysisRunStatus): CheckConclusion | null {
  switch (status) {
    case 'SUCCESS':
    case 'NO_ADDITIONAL_TESTS_REQUIRED':
    case 'NO_TEST_RELEVANT_CHANGES':
      return 'success';
    case 'BEHAVIORAL_MISMATCH':
    case 'TECHNICAL_GENERATION_FAILURE':
      return 'failure';
    case 'BASELINE_FAILED':
    case 'INFRASTRUCTURE_FAILURE':
      return 'neutral';
    case 'ACTION_REQUIRED':
      return 'action_required';
    default:
      return null;
  }
}

const STATUS_TITLES: Partial<Record<AnalysisRunStatus, string>> = {
  SUCCESS: 'Análisis exitoso',
  NO_ADDITIONAL_TESTS_REQUIRED: 'Cobertura existente suficiente',
  NO_TEST_RELEVANT_CHANGES: 'Sin cambios relevantes para pruebas',
  BEHAVIORAL_MISMATCH: 'Comportamiento inconsistente detectado',
  TECHNICAL_GENERATION_FAILURE: 'Falla técnica generando la prueba',
  BASELINE_FAILED: 'Tests existentes ya estaban en rojo',
  INFRASTRUCTURE_FAILURE: 'Fallo de infraestructura durante el análisis',
  ACTION_REQUIRED: 'Falta contexto funcional',
};

export function buildCheckTitle(status: AnalysisRunStatus): string {
  return STATUS_TITLES[status] ?? status;
}
