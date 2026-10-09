# Cierre — WI-CORE-025
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09 (America/Lima)
**Estado:** `W-DONE`
**Historias:** HU17
**Subtarea:** ST-CORE-032

## Revisión
- El usuario **delegó explícitamente en el chat** la revisión independiente a un agente `reviewer` (permitido por AGENTS.md solo así). El reviewer (agente general-purpose con el rol de `harness/roles/reviewer.md`, configurado claude-sonnet-5-5, atendido unknown) emitió `APPROVED` sin blockers ni importantes y con 4 hallazgos menores (`wi-core-025-independent-review.md`). Evidencia que corrió: lint, test x2 (1474), build, e2e 222/222, tsc 43 solo en specs, validate-harness, checkpoint before-review, 5 cortes compilando por separado en worktree desechable, migración en PG 14 desechable con shim de pgvector y 14 mutaciones detectadas.
- La delegación **no sustituye** la aprobación humana de alcance y arquitectura: el usuario ya la dio en las decisiones 1-9 de 025 (en chat) y en `smart-v3-scope-approval.md`.
- Contract-reviewer: `APPROVED` previo y final (`wi-core-025-contract-review.md`). Ciclos de revisión: 0 de 2.

## Tratamiento de los hallazgos
1. `executionDurationMs`: se acotó el texto (sin cambio de código). Es `null` si el Sandbox nunca se invocó y en corridas previas; si la llamada al Sandbox falla se registra el tiempo transcurrido, nunca un 0 inventado. INTEROP-2.7 y el plan se actualizaron; `CS-CORE-20261009-008` no se modificó y se emitió `CS-CORE-20261009-009` (documental, target Console) que lo acota, siguiendo el precedente de 006/007.
2. Fallback de presupuesto duplicado y limpieza de `insertRepetition`/campos sin uso/docblock: `IDEA-010` (sin implementar).
3. `updateRepetitionById` sin guarda `RUNNING` y `markStarted`/`complete()` sin limpiar `failureCode`/`failureMessage`: criterio de aceptación de `WI-CORE-030` (sin implementar, WI en `W-PLANNED`).

## Contratos y sincronización
- Publicados `CS-CORE-20261009-008` y `CS-CORE-20261009-009` hacia Console (`C-PENDING`; Console debe importarlos y acusarlos). Contract Sync `before-done`: sin pendientes relevantes entrantes; `CS-20260920-001` y `CS-20260921-003` NOT_RELEVANT.
- El cierre local no implica push, despliegue ni cutover.

## Deudas aceptadas y limitaciones conocidas
- Cuatro migraciones sin validar en Postgres real (con pgvector y Prisma): `20261008160000`, `20261009100000`, `20261009110000`, `20261009120000`. Validaciones parciales en PG 14 desechable.
- Sin prueba HTTP de los 422/503; intermitencia no reproducida en `test-target-extractor.service.spec.ts`; precedencia de `UNSUPPORTED_PROJECT` anotada en INTEROP; `validRate=0` sin slots evaluables (IDEA-007, `WI-CORE-027`); `errorSummary` no declarado (IDEA-009); idempotencia por requestId del Sandbox no verificable desde este repo; `completedRepetitions` intermedio adelantado.
- D1 (experimento sin semilla con fila RUNNING huérfana termina FAILED), D2 y D3 aceptados por el usuario.
- Crash del worker deja el job RUNNING: `WI-CORE-030` (IDEA-008).
- Precondiciones de despliegue abiertas heredadas de 023: validar esfuerzos de `gpt-6-luna` con el runtime/API y la migración de 023 en el Postgres real.

## Verificaciones
Desde `app/` con DATABASE_URL/DIRECT_URL = postgresql://nouser:nopass@127.0.0.1:1/none: `pnpm lint` exit 0; `pnpm test` 112 archivos pasan, 1 omitido, 1474 tests pasan, 36 omitidos; `pnpm build` exit 0; `pnpm test:e2e` 7 archivos, 222/222; `node harness/validate-harness.mjs` pasa (corrida final registrada en el commit de cierre).
