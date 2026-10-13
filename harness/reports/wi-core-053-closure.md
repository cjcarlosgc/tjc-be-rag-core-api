# Cierre — WI-CORE-053
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Estado:** `W-DONE` (código y migración listos; la migración NO está aplicada a ninguna base) · **Subtarea:** ST-CORE-060

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-053-independent-review.md` (agente `reviewer`, ciclo 1 de 2, APPROVED, 13 de 13 mutantes detectados; SQL probado solo en un Postgres desechable local). Alcance y límites aprobados por el usuario («WI-053 tal cual»). El usuario es informado y puede reabrirlo. No autoriza push.

## Migración (la aplica el coordinador)
Nombre: **`20261013100000_experiment_repetition_artifacts`** (`app/prisma/migrations/20261013100000_experiment_repetition_artifacts/migration.sql`). Estrictamente aditiva: CREATE TABLE, índice único por repetición, FK `ON DELETE CASCADE`, RLS con REVOKE a `anon`/`authenticated`; sin DROP/ALTER/UPDATE/DELETE sobre tablas existentes. Rollback manual: `DROP TABLE "experiment_repetition_artifacts";`. Core no la aplicó; el coordinador hace `pg_dump` previo y `prisma migrate deploy`. Hasta entonces el cableado best-effort fallaría al escribir (solo se pierde la evidencia, con warn): conviene aplicarla antes de desplegar el código.

## Qué entrega
Tabla privada con el contenido exacto de la prueba enviada y los hechos normalizados del runner, con sha256 y límites explícitos; cableado best-effort que no altera el resultado de la repetición. Código en `a6fc363f7b12284d3781acd7f771be35f34158da` (corte A) y `896cd86e83c3b24f1265033bf3f98ecb5ab38630` (cortes B y C); spec 008 y CHANGELOG consolidados. Sin DTO público, §6.16, sandbox/ ni clasificación.

## Notas
F1 y F2 (suitePath/name sin sanear; NUL hace fallar el upsert): `IDEA-030`. F3 consolidado en este cierre. Salida cruda stdout/stderr: pedido aparte al Sandbox, con confirmación del usuario.
