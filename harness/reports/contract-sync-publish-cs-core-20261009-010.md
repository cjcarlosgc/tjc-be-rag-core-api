# Publicación de Contract Sync — CS-CORE-20261009-010
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09 (America/Lima). Origen: WI-CORE-030. Destino: Console. `breaking=false`. Estado inicial `C-PENDING` (Console importa por ruta local desde el outbox de Core y acusa).

`CS-CORE-20261009-010` (`harness/contract-sync/outbox/CS-CORE-20261009-010.yaml`): informativo y aditivo. INTEROP documenta los valores conocidos de `ExperimentStatusResponse.failureCode` (`EXPERIMENT_FAILED`, `EXPERIMENT_WORKER_LOST`); el campo sigue siendo `string | null` abierto. `sourceRevision` `0d64a63` (commit con el texto). Decisión del usuario en chat (2026-10-09); texto ratificado por el contract-reviewer (`harness/reports/wi-core-030-contract-review.md`). Por eso `contractImpact` y `publishesContract` pasaron a `true` en este WI. El código de WI-CORE-030 no cambió el contrato.
