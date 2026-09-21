/** Primer retraso de un job de acceso cuya verificación no fue posible (GitHub no disponible). */
export const ACCESS_BACKOFF_BASE_MS = 60_000;
/** Tope del backoff: una hora (`INTEROP-2.4` §6.9: "backoff creciente acotado a una hora"). */
export const ACCESS_BACKOFF_MAX_MS = 3_600_000;

/**
 * Backoff creciente y acotado para un job de acceso no verificable (`ACCESS_REVERIFY`,
 * etapa 3b, lo usa con `RescheduleJobError`): 1 min, 2, 4, 8... sin pasar de una hora. Se
 * reprograma en lugar de fallar (no consume `maxAttempts`); la reconciliación es el respaldo.
 */
export function accessBackoffMs(deferrals: number): number {
  const exponent = Math.max(0, Math.min(deferrals, 20));
  return Math.min(ACCESS_BACKOFF_BASE_MS * 2 ** exponent, ACCESS_BACKOFF_MAX_MS);
}
