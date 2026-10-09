# WI-CORE-030 — Implementación (recuperación de jobs de experimento tras la caída del worker)
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high

Escalada: se usó `implementer-high` desde el inicio por tocar concurrencia de la cola de jobs (motivo del leader). El reporte lo redactó el leader a partir del informe del implementer (su perfil no escribe `.md`); los checks los volvió a correr el leader.

## Commits (rango sin publicar, trailer corregido a Sonnet 5.5 por convención del repo; árbol idéntico al original)
- `10e068b` feat(jobs): latido del lock y fencing por lockedBy (corte 1)
- `583db1a` fix(experiments): liberar locks obsoletos de experiment-run y cerrar el run al agotar intentos (corte 2)
- `945dd1d` fix(experiments): no sobrescribir repeticiones cerradas y limpiar el fallo al reiniciar o completar (corte 3, H3/H4)

## Cambios (13 archivos en `app/`, +843/-87; sin migración, sin DTO/controlador/prisma)
- `jobs.repository.ts`: `touchLock`; `fencedUpdate`; `complete/fail/reschedule` con fencing `where {id, status: RUNNING, lockedBy}`; `FailOutcome` (`terminal|retry|discarded|lost`); `RELEASABLE_UNKEYED_JOB_TYPES = ['experiment-run']` (congelada, no configurable por env); `releaseStale` devuelve `{released, exhausted}`.
- `jobs.service.ts`: `startJobHeartbeat` (setInterval con `unref`, se detiene en `finally`, un fallo de escritura se registra) y `notifyExhausted` (invoca `onExhausted`, errores del gancho no rompen el barrido).
- `job-handler.interface.ts`: `onExhausted?` opcional.
- `env.validation.ts` y `.env.example`: `JOBS_HEARTBEAT_INTERVAL_MS` (default 60000, mínimo 1000, rechaza `heartbeat*3 > JOBS_STALE_LOCK_MS`).
- `experiment-job.handler.ts`: `onExhausted` no sobrescribe un run ya FAILED/COMPLETED, marca `FAILED` con `EXPERIMENT_WORKER_LOST` y cierra repeticiones RUNNING huérfanas con `technicallyEvaluable=false`.
- `experiment-runs.repository.ts`: H3 `updateRepetitionById` con `updateMany where {id, state: RUNNING}` que devuelve boolean; H4 `markStarted` y `complete` limpian `failureCode`/`failureMessage` (y `completedAt` en `markStarted`).
- `test/support/in-memory-jobs.repository.ts` alineado; specs de jobs (repository.pg, service), experiment-job.handler, experiment-runs.repository y env.validation.
- Cambios de firma: `complete(jobId)` pasa a `complete(job: Job)`; `fail` devuelve `FailOutcome`; `releaseStale` devuelve `{released, exhausted: Job[]}`.

## Verificación (leader, 2026-10-09)
- `pnpm lint`: 0 warnings/errores. `pnpm build`: ok. `tsc --noEmit`: 43 errores, línea base conservada. `tsc -p tsconfig.build.json` ok en cada commit de código (10e068b, 583db1a, HEAD).
- `pnpm test` x3: 112 archivos pasan / 1 omitido; 1494 pasan, 54 omitidos (pg), 1548 total (antes 1510, +38), sin intermitencias.
- e2e con `DATABASE_URL`/`DIRECT_URL` inalcanzables: 7 archivos, 222 pruebas pasan.
- Specs pg (`jobs.repository.pg.spec.ts`) en un PostgreSQL desechable local (tabla `jobs` sin migraciones ni pgvector), sesión UTC y America/Bogota: 54/54 pasan. Instancia destruida al terminar.
- Cubre: redistribución tras lock vencido, no duplicación con latido de job vigente (`touchLock`), límite de intentos con run `FAILED`, zombi con `lockedBy` distinto que no escribe, H3 y H4, y que `snapshot-analysis`, `functional-continuation`, `analysis-run-validation` y `test-publication` NO se liberan.
- Contrato: sin cambios en DTOs, controladores ni prisma; `contractImpact=false` confirmado, sin Contract Sync nuevo.

## Deudas e interpretaciones para el usuario
a. Experimentos legados sin semilla: el redelivery omite el slot RUNNING huérfano y `complete()` lanza; tras `maxAttempts` el run queda `FAILED` con `EXPERIMENT_FAILED` (no `EXPERIMENT_WORKER_LOST`) porque `handle()` marcó primero el fallo.
b. Si un run estaba `FAILED` por un intento previo y el worker muere antes del `markStarted` del reintento, conserva el código previo.
c. `EXPERIMENT_WORKER_LOST` es un valor libre de `failureCode` visible en `ExperimentStatusResponse`; documentarlo en INTEROP exigiría un Contract Sync aditivo (decisión del usuario).
d. Trampa de configuración: con `JOBS_HEARTBEAT_INTERVAL_MS=60000` por defecto, un entorno con `JOBS_STALE_LOCK_MS < 180000` sin heartbeat explícito no arranca (el default de stale es 600000).
e. El fencing añade `status: RUNNING` al `where`.
f. Los cuatro tipos no liberables se prueban con un test conjunto, no uno por tipo.
