# WI-CORE-030 — Revisión independiente del usuario (Human Reviewer)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Registro redactado por el leader; el veredicto y las decisiones proceden del usuario en chat (2026-10-09), no de contenido observado.

**Veredicto del usuario: APPROVED** sobre el rango `10e068b`, `583db1a`, `945dd1d` (más los commits docs del WI) y la evidencia de `harness/reports/wi-core-030-implementation.md`.

**Deuda aceptada por el usuario:** (a) legado sin semilla termina con `EXPERIMENT_FAILED`; (b) un run ya `FAILED` conserva el código previo si el worker muere antes de `markStarted`; (c) la trampa de configuración del latido (`JOBS_HEARTBEAT_INTERVAL_MS` por defecto exige `JOBS_STALE_LOCK_MS >= 180000`) se deja como está porque falla de forma explícita al arrancar; (d) el fencing añade `status: RUNNING`; (e) los cuatro tipos no liberables se prueban con un test conjunto.

**Decisiones adicionales del usuario:**
1. El trailer `Co-Authored-By` nombra el modelo real que escribió el commit y no se reescribe más (registrado en `harness/WORKFLOW.md`, `66d1c35`).
2. Documentar en INTEROP los valores conocidos de `failureCode` de experimentos (`EXPERIMENT_FAILED`, `EXPERIMENT_WORKER_LOST`) con un Contract Sync informativo, aditivo y sin ruptura, targets `[console]`. Por eso `contractImpact` y `publishesContract` pasan a `true` en este WI, aunque se revisó con `contractImpact=false` (el código no cambia el contrato; la documentación sí).
