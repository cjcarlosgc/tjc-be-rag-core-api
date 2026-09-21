/**
 * Tope de concurrencia y presupuesto de verificaciones de membresía por petición
 * a `GET /workspaces` (`014/plan.md`, "Presupuesto de verificaciones"). Agotado el
 * presupuesto, las organizaciones restantes se tratan como no verificables (no se
 * ofrecen); no se memoizan denegaciones.
 */
export const WORKSPACE_VERIFICATION_CONCURRENCY = 5;
export const WORKSPACE_VERIFICATION_BUDGET = 50;
