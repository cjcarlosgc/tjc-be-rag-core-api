import { uuidV5 } from '../common/uuid-v5.util.js';

/**
 * DEC-IDEMP-001: namespace estándar URL de RFC 4122, fijo por el contrato.
 */
export const SANDBOX_REQUEST_ID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/**
 * Identidad hija estable para una ejecución del Sandbox originada por
 * generación (005-test-generation). Coincide con `requestId` en cualquier
 * reintento del mismo job, porque `jobId` es el id de la fila en `jobs` (no
 * cambia entre reintentos internos de un mismo job).
 */
export function sandboxGenerationRequestId(jobId: string, targetId: string): string {
  return uuidV5(SANDBOX_REQUEST_ID_NAMESPACE, `urn:tjc:sandbox-execution:v1:generation:${jobId}:${targetId}`);
}

export function sandboxExperimentRequestId(
  jobId: string,
  strategy: string,
  repetition: number,
): string {
  return uuidV5(
    SANDBOX_REQUEST_ID_NAMESPACE,
    `urn:tjc:sandbox-execution:v1:experiment:${jobId}:${strategy}:${repetition}`,
  );
}

export function sandboxManualRetryRequestId(retryJobId: string, targetId: string): string {
  return uuidV5(
    SANDBOX_REQUEST_ID_NAMESPACE,
    `urn:tjc:sandbox-execution:v1:manual-retry:${retryJobId}:${targetId}`,
  );
}
