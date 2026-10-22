/**
 * Defaults únicos de la consulta (poll) al Sandbox (WI-CORE-077).
 *
 * Son los valores que se usan cuando `SANDBOX_POLL_RETRIES` o `SANDBOX_POLL_RETRY_DELAY_MS` no están
 * definidas. Viven en `config/` (sin dependencias) para que `env.validation`, el servicio del Sandbox,
 * la cota HTTP de experimentos y sus pruebas compartan una sola fuente sin ciclos de import.
 */
export const DEFAULT_POLL_RETRIES = 3;
export const DEFAULT_POLL_RETRY_DELAY_MS = 500;
/** Defaults de tope de consulta y de timeout por request al Sandbox (WI-CORE-078). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_POLL_ATTEMPTS = 120;
/** Tope de la espera entre consultas: `pollAfterMs` viene del Sandbox y no es de fiar para un `setTimeout`. */
export const MAX_POLL_AFTER_MS = 30_000;
