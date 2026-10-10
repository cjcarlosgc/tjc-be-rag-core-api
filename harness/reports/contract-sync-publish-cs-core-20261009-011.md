# Publicación de Contract Sync — CS-CORE-20261009-011
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09 (America/Lima). Origen: WI-CORE-022. Destino: Console (`WI-CONSOLE-014`). `breaking=false`. Estado inicial `C-PENDING`.

`CS-CORE-20261009-011` (`harness/contract-sync/outbox/CS-CORE-20261009-011.yaml`): INTEROP-2.7 §6.15 implementada en Core, con los 6 checkpoints de contenido de `harness/reports/wi-core-022-contract-final-review.md` (rutas y roles; DTOs y enums con `failureCode` abierto; 5 ErrorCode nuevos más `PROJECT_ROLE_INSUFFICIENT` y los 400 de idempotencia; tope `groundTruth` 200 y `pollAfterMs`; 409 `ANALYSIS_NOT_FINISHED` y 422 `UNSUPPORTED_PROJECT` de DEC-RC-001; 409 `RETRIEVAL_COMPARISON_FAILED` de DEC-RC-003). `sourceRevision` `d3829fc` (commit final con código; el texto de INTEROP está en `9b7035e`, ratificado en `dd7e526`). Texto ratificado por el contract-reviewer.
