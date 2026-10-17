# WI-CORE-060 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (AskUserQuestion «Confirmo #5 y #6»), en orden #5 → #6 (después de `WI-CORE-059`), un WI activo a la vez, sin push ni despliegue; no el ítem #4. Base: `harness/reports/fase2-diagnostico-items-4-5-6.md` y `harness/reports/fase2-correccion-evidencia-sandbox.md`.

## Alcance (aditivo e INTERNO: sin DTO público, sin §6.16, sin cambiar el Sandbox)
- `ExperimentRun.analysisRunId` y `ExperimentRun.commitSha` (copia del `commitSha` de la versión).
- Marcas de tiempo de inicio y fin por intento en `ExperimentRepetition`.
- `ExperimentRepetition.promptSha256`: **solo el hash** (`DEC-VAL-001` PENDING: no se guarda el texto del prompt).
- En `experiment_repetition_artifacts`: la evidencia acotada que el Sandbox YA devuelve (`evidence[]`: `COMPILER_STDOUT`/`COMPILER_STDERR`/`TEST_STDOUT`/`TEST_STDERR`/`RUNNER_REPORT` con `truncated`/`originalBytes`), saneada y con tope total explícito, y `startedAt`/`completedAt` del Sandbox. Core hoy la descarta en `sandbox.types.ts` y `sandbox-execution.service.ts` (`fetchResult`): se amplía el tipo y la lectura sin romper `mapSandboxResult`.
- Migración aditiva y nullable creada y probada en local (Postgres desechable), **no aplicada** a la base real; filas previas sin dato (sin backfill). Best-effort: un fallo al persistir evidencia no altera el resultado de la repetición (patrón de `WI-CORE-053`); sin NUL en el texto (`IDEA-030`).
- Si algo tocara contrato: contract-reviewer antes de editar y Contract Sync (se espera que no).
