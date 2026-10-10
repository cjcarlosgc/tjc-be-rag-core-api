import { ExperimentRepetitionState } from '../generated/prisma/enums.js';

/**
 * Reglas puras de reanudación de intentos de una repetición pareada (WI-CORE-025, HU17, latido).
 * Sin I/O: el handler aporta el reloj, el umbral y las filas; aquí solo se decide.
 */

/** Campos de una fila de `ExperimentRepetition` que intervienen en la decisión. */
export interface AttemptRecoveryRow {
  state: string;
  attempt: number;
  failureType?: string | null;
  sandboxTimedOut?: boolean | null;
  lastHeartbeatAt?: Date | null;
  createdAt?: Date | null;
  errorSummary?: string | null;
}

/** Factor mínimo entre el umbral de vencimiento y el intervalo de latido. */
export const HEARTBEAT_STALE_MIN_INTERVAL_FACTOR = 3;

export type SlotAction<Row extends AttemptRecoveryRow> =
  /** Ejecutar el intento `attempt`. `expiredAttempt` es el intento 1 RUNNING vencido que debe cerrarse antes. */
  | { kind: 'RUN'; attempt: 1 | 2; expiredAttempt: Row | null }
  /** Nada que hacer: el slot ya tiene su resultado definitivo (idempotencia de redelivery). */
  | { kind: 'SKIP' }
  /** Hay un intento RUNNING con latido vigente: no se duplica ni se cierra nada. */
  | { kind: 'IN_FLIGHT'; row: Row }
  /** Intento 2 RUNNING con latido vencido: se cierra como fallo, sin tercer intento. */
  | { kind: 'CLOSE_EXPIRED_SECOND'; row: Row };

/**
 * Fallo externo persistido: FAILED con INFRASTRUCTURE y no es timeout del Sandbox
 * (`sandboxTimedOut` NULL o false). Dispara el único reintento del slot.
 */
export function isPersistedExternalFailure(row: AttemptRecoveryRow): boolean {
  return (
    row.state === ExperimentRepetitionState.FAILED &&
    row.failureType === 'INFRASTRUCTURE' &&
    row.sandboxTimedOut !== true
  );
}

/**
 * Instante de referencia del latido: `lastHeartbeatAt`, o `createdAt` en filas previas a la
 * migración (latido NULL). Null cuando la fila no trae ningún timestamp.
 */
function heartbeatReferenceMs(row: AttemptRecoveryRow): number | null {
  const timestamp = row.lastHeartbeatAt ?? row.createdAt ?? null;
  if (timestamp === null) return null;
  const ms = new Date(timestamp).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Un latido es vencido cuando su referencia es más antigua que `staleMs`. Sin ningún timestamp
 * en la fila se trata como vencido (decisión documentada en WI-CORE-025 (3c)).
 */
export function isHeartbeatExpired(row: AttemptRecoveryRow, nowMs: number, staleMs: number): boolean {
  const referenceMs = heartbeatReferenceMs(row);
  return referenceMs === null || nowMs - referenceMs > staleMs;
}

/** Milisegundos que faltan para que un latido vigente venza. Solo válido para filas con referencia. */
export function remainingUntilExpiryMs(row: AttemptRecoveryRow, nowMs: number, staleMs: number): number {
  const referenceMs = heartbeatReferenceMs(row);
  return referenceMs === null ? 0 : staleMs - (nowMs - referenceMs);
}

/**
 * Decide qué hacer con un slot a partir de su último intento (plan punto 8 y WI-CORE-025 (3c)).
 * - Sin intento: intento 1.
 * - RUNNING con latido vigente: IN_FLIGHT (el job se reprograma sin tocar nada).
 * - RUNNING con latido vencido: intento 1 → intento 2 (el 1 se cierra antes); intento 2 → cierre.
 * - Intento 1 con fallo externo persistido: intento 2.
 * - Cualquier otro caso: SKIP. Nunca se devuelve un tercer intento.
 */
export function resolveSlotAction<Row extends AttemptRecoveryRow>(
  latest: Row | undefined,
  nowMs: number,
  staleMs: number,
): SlotAction<Row> {
  if (!latest) return { kind: 'RUN', attempt: 1, expiredAttempt: null };

  if (latest.state === ExperimentRepetitionState.RUNNING) {
    if (!isHeartbeatExpired(latest, nowMs, staleMs)) return { kind: 'IN_FLIGHT', row: latest };
    if (latest.attempt === 1) return { kind: 'RUN', attempt: 2, expiredAttempt: latest };
    return { kind: 'CLOSE_EXPIRED_SECOND', row: latest };
  }

  if (latest.attempt === 1 && isPersistedExternalFailure(latest)) {
    return { kind: 'RUN', attempt: 2, expiredAttempt: null };
  }

  return { kind: 'SKIP' };
}

/** Distancia de la ruta HTTP del cliente del Sandbox: un POST, hasta N consultas de estado y un GET de resultado. */
export function sandboxHttpBoundMs(requestTimeoutMs: number, maxPollAttempts: number): number {
  return requestTimeoutMs * (maxPollAttempts + 2);
}

/**
 * Umbral de vencimiento del latido. Por defecto: GENERATION_TIMEOUT del run más la cota HTTP del
 * Sandbox; si se configura, se usa ese valor. En ambos casos nunca es menor que 3 × intervalo.
 */
export function resolveHeartbeatStaleMs(input: {
  configuredMs: number | undefined;
  intervalMs: number;
  generationTimeoutMs: number;
  sandboxHttpBoundMs: number;
}): number {
  const base = input.configuredMs ?? input.generationTimeoutMs + input.sandboxHttpBoundMs;
  return Math.max(base, HEARTBEAT_STALE_MIN_INTERVAL_FACTOR * input.intervalMs);
}
