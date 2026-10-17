# Cierre — WI-CORE-060
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Estado:** `W-DONE` (código y migración listos; la migración NO está aplicada a ninguna base) · **Subtarea:** ST-CORE-067

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-060-independent-review.md` (agente `reviewer`, ciclo 1 de 2, APPROVED; 16 de 17 mutantes detectados; migración probada en un Postgres desechable local). Alcance aprobado por el usuario («Confirmo #5 y #6»). El usuario es informado y puede reabrirlo. No autoriza push ni despliegue.

## Migración (la aplica quien tenga la orden del usuario, con `pg_dump` previo)
Nombre: **`20261013110000_experiment_trial_reconstruction`**. Diez `ALTER TABLE … ADD COLUMN` nullables sobre `experiment_runs`, `experiment_repetitions` y `experiment_repetition_artifacts`; sin DEFAULT, DROP, UPDATE ni DELETE; idéntica a `prisma migrate diff`; aplicar después de `20261013100000_experiment_repetition_artifacts` (si esa no está aplicada, aplicar ambas en orden). Rollback manual documentado en la cabecera. Sin aplicarla, el cableado best-effort pierde solo la evidencia con un warn y no altera resultados.

## Qué entrega
Core conserva `evidence[]`, `startedAt` y `completedAt` que el Sandbox ya devuelve y persiste, de forma interna: `ExperimentRun.analysisRunId`/`commitSha`; por intento `startedAt`/`finishedAt` y `promptSha256` (solo hash); y la evidencia acotada y saneada del Sandbox en `experiment_repetition_artifacts` (8 KiB por entrada, 40 KiB total, sin NUL). Código `70b772f168f171066d7a56129ecb0701befd50f4` (corte A) y `9917a3faa6b2dca202848b5d7dd96ed8e2be9959` (corte B). Sin DTO público, §6.16, contrato ni cambios en el Sandbox. Spec 008 consolidada.

## Notas
Hallazgos menores en `IDEA-033` (hash del prompt antes de generar, tope total, `startedAt`). Los trials del piloto V1 no tendrán salida del Sandbox (sin backfill).
