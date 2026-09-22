/**
 * Tope de concurrencia y presupuesto de verificaciones contra GitHub por petición
 * (`014/plan.md`, "Presupuesto de verificaciones"): candidatos de `GET /projects` y
 * membresías de `GET /workspaces`. Agotado el presupuesto, los candidatos restantes se
 * tratan como no verificables (omitidos en listados). No se memoizan denegaciones: se
 * acepta por escrito que un límite de tasa de GitHub degrade las altas nuevas (omitidas
 * o `503`), nunca lo ya registrado.
 */
export const ACCESS_VERIFICATION_CONCURRENCY = 5;
export const ACCESS_VERIFICATION_BUDGET = 50;

/**
 * El alta retiene una conexión de base de datos (transacción con el advisory lock)
 * durante las llamadas a GitHub. Prisma corta una transacción interactiva a los 5 s
 * por defecto, insuficiente para tres lecturas encadenadas a GitHub; el techo evita
 * además que una verificación colgada retenga la conexión indefinidamente.
 */
export const ACCESS_LOCK_MAX_WAIT_MS = 10_000;
export const ACCESS_LOCK_TIMEOUT_MS = 30_000;
