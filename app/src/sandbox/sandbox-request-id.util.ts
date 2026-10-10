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

/**
 * Identidad de una ejecución del Sandbox para una repetición experimental.
 * El intento 1 conserva la identidad original (sin sufijo); el intento 2 (reintento
 * externo, WI-CORE-025) agrega `:{attempt}`, por lo que obtiene un requestId distinto.
 */
export function sandboxExperimentRequestId(
  jobId: string,
  strategy: string,
  repetition: number,
  attempt = 1,
): string {
  const base = `urn:tjc:sandbox-execution:v1:experiment:${jobId}:${strategy}:${repetition}`;
  return uuidV5(SANDBOX_REQUEST_ID_NAMESPACE, attempt > 1 ? `${base}:${attempt}` : base);
}

export function sandboxManualRetryRequestId(retryJobId: string, targetId: string): string {
  return uuidV5(
    SANDBOX_REQUEST_ID_NAMESPACE,
    `urn:tjc:sandbox-execution:v1:manual-retry:${retryJobId}:${targetId}`,
  );
}
