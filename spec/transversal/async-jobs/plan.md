# async-jobs — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

POST 202 crea estado persistido antes de despachar. Prohibido fire-and-forget in-memory. Mecanismo durable: cola DB-backed en PostgreSQL de Supabase (tabla `jobs`), despacho con `SELECT ... FOR UPDATE SKIP LOCKED`. Workers idempotentes por operationId (p. ej. `projectVersionId`). Para generación, experimento y retry, la misma transacción crea el recurso, reserva `IdempotencyRecord` y crea el job; el UUID primario del job participa en el nombre canónico UUID v5 de cada subejecución Sandbox.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.

## Detalle técnico verificado (WI-CORE-030)

> **Aprobado por el usuario en chat (2026-10-09)**, registro en `harness/reports/wi-core-030-scope-approval.md`. Origen: `IDEA-008`, `ST-CORE-037`, HU17. Análisis completo en `harness/reports/wi-core-030-sdd-verification.md`. Se vuelve comportamiento vigente al cerrar `WI-CORE-030`.

### DEC-JOBS-001 — Alcance de liberación de locks obsoletos por tipo de job
**Estado:** APROBADO (2026-10-09, por el usuario)
**Blocks:** ninguno
**Decisión:** se liberan los locks `RUNNING` vencidos de `experiment-run` (además de los jobs con `dedupeKey`) y se mantienen sin liberar `snapshot-analysis`, `functional-continuation`, `analysis-run-validation` y `test-publication` (gates de estado, costo LLM y escrituras externas). La recuperación a nivel de entidad de esos cuatro tipos queda registrada como `IDEA-011`.

### DEC-JOBS-002 — Latido de job y fencing por `lockedBy`
**Estado:** APROBADO (2026-10-09, por el usuario)
**Blocks:** ninguno
**Decisión:** se aprueba que `JobsService` renueve `lockedAt` mientras `handle()` corre (`JOBS_HEARTBEAT_INTERVAL_MS`, default 60 000, ≤ `JOBS_STALE_LOCK_MS/3`) y que `complete/fail/reschedule` solo escriban si `lockedBy` sigue siendo el worker. Sin migración. Cada liberación consume un intento; un latido de job vigente no libera.

### Diseño aprobado

1. **Latido de job** (`app/src/jobs/jobs.service.ts`, `jobs.repository.ts`): `JobsRepository.touchLock(jobId, workerId): Promise<boolean>` con `UPDATE "jobs" SET "lockedAt" = UTC_NOW, "updatedAt" = UTC_NOW WHERE "id" = $1 AND "status" = 'RUNNING' AND "lockedBy" = $2` (devuelve si afectó una fila). `runOnce` arranca un `setInterval` con `unref` antes de `handler.handle` y lo detiene en `finally`; un error de escritura se registra y no interrumpe el handler. Nueva variable `JOBS_HEARTBEAT_INTERVAL_MS` en `env.validation.ts` y `.env.example` (validar `≤ JOBS_STALE_LOCK_MS/3`).
2. **Criterio de liberación** (`releaseStale`): sustituir `"dedupeKey" IS NOT NULL` por `("dedupeKey" IS NOT NULL OR "type" = ANY(${RELEASABLE_UNKEYED_JOB_TYPES}))`, con `RELEASABLE_UNKEYED_JOB_TYPES = ['experiment-run']` como constante exportada (no configurable por entorno). Cada liberación sigue consumiendo un intento vía `fail()`; respeta `JOBS_MAX_ATTEMPTS`.
3. **Fencing** (`complete/fail/reschedule`): pasar a `updateMany({ where: { id, lockedBy } })`; si `count = 0`, advertir y no escribir (un worker zombi no pisa un job ya reclamado o liberado). `fail` devuelve si el job quedó terminal.
4. **Gancho de cierre** (`app/src/jobs/job-handler.interface.ts`): `onExhausted?(payload, reason): Promise<void>`. `releaseStale` (y `runOnce` cuando `fail` termina terminal) lo invoca para el handler del tipo. `ExperimentJobHandler.onExhausted` llama a `markFailed(experimentId, 'EXPERIMENT_WORKER_LOST', reason)` (`failureCode` aprobado) y `closeInterruptedRepetition` de las repeticiones RUNNING del experimento.
5. **Segunda capa (ya existe):** al reentrar, `resolveSlotAction`/`assertNoInFlightAttempt` (`attempt-recovery.ts`, `experiment-job.handler.ts`) no duplican un intento con latido vigente (reprograma sin consumir intento) ni crean un tercer intento.
6. **H3** (`ExperimentRunsRepository.updateRepetitionById`, `experiment-runs.repository.ts:265`): cambiar `update` por `updateMany({ where: { id, state: RUNNING }, data })` y devolver la fila actual o `null`/avisar cuando `count = 0`; el handler (`experiment-job.handler.ts:~1344`) no debe cerrar traza/refrescar contadores si la fila ya estaba cerrada.
7. **H4** (`markStarted` y `complete()`): limpiar `failureCode: null, failureMessage: null` (y `completedAt: null` en `markStarted`) para que un experimento que pasó por `markFailed` y luego completa en un reintento no quede `COMPLETED` con `failureCode`.

### Pruebas (sin tiempos reales; reloj/lock simulados con `age()` y timers falsos)
- `jobs.repository.pg.spec.ts`: libera un `experiment-run` sin clave con lock vencido (a `PENDING` con backoff y `attempts+1`); no toca `snapshot-analysis`/`test-publication`/`analysis-run-validation`/`functional-continuation` aunque estén vencidos; no toca un `experiment-run` con lock renovado (`touchLock`); a `maxAttempts` queda `FAILED`; `touchLock` no escribe si `lockedBy` cambió.
- `jobs.service.spec.ts`: el latido arranca antes de `handle()`, se detiene en `finally`, un fallo de `touchLock` no interrumpe; fencing: `complete/fail` de un worker que perdió el lock no escribe; `onExhausted` se invoca solo al agotar intentos.
- `experiment-job.handler.spec.ts`: `onExhausted` marca el run `FAILED` con el código y cierra repeticiones RUNNING; redelivery tras liberación con latido de repetición vigente reprograma sin ejecutar; con latido vencido cierra y reintenta una sola vez; nunca tercer intento.
- `experiment-runs.repository.spec.ts`: H3 (`updateRepetitionById` sobre fila no RUNNING no sobrescribe); H4 (`markStarted`/`complete` limpian `failureCode`/`failureMessage`/`completedAt`).
- `env.validation.spec.ts`: `JOBS_HEARTBEAT_INTERVAL_MS` válido y rechazado si > `JOBS_STALE_LOCK_MS/3`.

### Criterios de aceptación
1. Un job `experiment-run` con lock vencido y sin renovaciones se libera, se redistribuye y respeta `JOBS_MAX_ATTEMPTS`; al agotar intentos el `ExperimentRun` queda `FAILED` (no `RUNNING`).
2. Un `experiment-run` cuyo worker sigue vivo (lock renovado, o repetición con latido vigente) no se libera ni se ejecuta dos veces.
3. Los tipos no aprobados en `DEC-JOBS-001` (`snapshot-analysis`, `functional-continuation`, `analysis-run-validation`, `test-publication`) siguen sin liberarse (prueba negativa por tipo).
4. H3 y H4 con pruebas.
5. Sin migración y sin cambio de contrato (`contractImpact=false`); lint, test y build en verde.
