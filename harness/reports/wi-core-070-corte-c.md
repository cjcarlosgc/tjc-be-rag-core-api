# WI-CORE-070 — corte C: observabilidad de reintentos de GET al Sandbox
Modelo: implementer · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low

Informe del implementer (el leader lo transcribe; el implementer no escribe en `harness/reports/`). Corte aprobado por el usuario el 2026-10-19 (adenda de `wi-core-070-scope-approval.md`).

## Qué cambia

`app/src/sandbox/sandbox-execution.service.ts` (+43/−5): `withTransientRetries` recibe la operación (`status` | `result`) y el `executionId`. Cada reintento realmente realizado (error transitorio y `attempt < retries`) emite `logger.warn` con operación, executionId, «reintento N de TOTAL», clase del error, espera en ms y `sanitizeFailureMessage(error.message)` (solo estado HTTP y URL sin token). Contadores en memoria de la instancia: getter `transientRetryCount` (total) y `transientRetriesByOperation` (`{status, result}`, copia de solo lectura); cuentan solo reintentos realizados.

Único cambio observable: log y contador. Sin cambios en número de reintentos, esperas (`min(base·2^attempt, MAX_POLL_AFTER_MS)`), errores reintentados, POST de creación (no se reintenta), `pollAfterMs`, DTO, contratos, `sandboxHttpBoundMs`/`attempt-recovery` (F3 fuera de alcance).

## Pruebas (7 casos nuevos en `sandbox-execution.resilience.spec.ts`)

GET de estado 503 reintentado (warn y contadores); GET de resultado con fallo de red; los warns no contienen token ni `Bearer`/`authorization`; 404 no transitorio sin warn ni conteo; agotamiento con `SANDBOX_POLL_RETRIES=2` relanza igual (1 POST + 3 GET, 2 warns, contador 2); `SANDBOX_POLL_RETRIES=0` sin reintentos; `transientRetriesByOperation` devuelve copia. Los 5 casos previos de resiliencia siguen verdes.

## Evidencia (desde `app/`, Node 22.23.3)

| Comando | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm contracts:check` | exit 0 |
| `pnpm test` | 155 archivos pasan, 7 omitidos; 2514 tests pasan, 104 omitidos (antes 2507, +7) |
| `vitest run src/sandbox` | 6 archivos, 96 tests pasan |

Nota de proceso: un colisión de nombre entre el campo privado y el getter rompió lint/build en un intento intermedio; se renombró el campo a `transientRetriesTotal` antes de la verificación final (sin efecto de comportamiento).
