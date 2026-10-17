# Cierre — WI-CORE-030
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09 (America/Lima)
**Estado:** `W-DONE`
**Historias:** HU17
**Subtarea:** ST-CORE-037

## Revisión
- Revisión independiente: el usuario (Human Reviewer) emitió `APPROVED` en chat; registro en `wi-core-030-user-review.md`. Sin revisión delegada a un agente. Ciclos: 0 de 2.
- Contract-reviewer: `APPROVED` sobre el texto documental de INTEROP (`wi-core-030-contract-review.md`).

## Qué entrega
Latido de job y fencing por `lockedBy`; `releaseStale` libera además `experiment-run` (lista cerrada, `DEC-JOBS-001`/`DEC-JOBS-002`); gancho `onExhausted` que cierra el run `FAILED` con `EXPERIMENT_WORKER_LOST`; H3 y H4 de la revisión de WI-CORE-025. Sin migración. `IDEA-011` registra la recuperación por entidad de los cuatro tipos no liberados. Detalle y checks en `wi-core-030-implementation.md`.

## Contratos y sincronización
`CS-CORE-20261009-010` publicado hacia Console (`C-PENDING`), informativo: valores conocidos de `failureCode` de experimentos (`contractImpact`/`publishesContract` a `true` por decisión del usuario). El cierre local no implica push, despliegue ni cutover.

## Deuda aceptada por el usuario
Legado sin semilla termina con `EXPERIMENT_FAILED`; un run `FAILED` conserva el código previo si el worker muere antes de `markStarted`; la trampa de configuración del latido (`JOBS_HEARTBEAT_INTERVAL_MS` exige `JOBS_STALE_LOCK_MS >= 180000`) se deja explícita; fencing con `status: RUNNING`; test conjunto de los cuatro tipos no liberables.
