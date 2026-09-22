/**
 * Job periódico de reconciliación de acceso (`INTEROP-2.4` §6.9, "Reconciliación horaria").
 * `dedupeKey` es un singleton: el índice único parcial de `jobs` (solo `PENDING`) garantiza
 * a lo sumo una ocurrencia pendiente; la siguiente se encola AL INICIO de la ejecución, así
 * que un fallo a mitad no rompe la cadena.
 */
export const ACCESS_RECONCILIATION_JOB_TYPE = 'access-reconciliation';
export const ACCESS_RECONCILIATION_DEDUPE_KEY = 'ACCESS_RECONCILIATION';

/** Bindings leídos por página (el presupuesto de verificaciones por ejecución es configurable). */
export const RECONCILIATION_BATCH_SIZE = 100;

/** Revocaciones (borrado de un registro bajo su advisory lock) simultáneas al pasar un binding a `REVOKED`. */
export const REVOKE_CONCURRENCY = 5;

/** Bindings `REVOKED` con registros sobrantes que se limpian por ejecución. */
export const LEFTOVER_SWEEP_LIMIT = 100;

/** Projects de organización con registros leídos por página en la parte (b) de la reconciliación. */
export const RECONCILIATION_PROJECT_BATCH_SIZE = 20;
