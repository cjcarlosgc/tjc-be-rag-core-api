# WI-CORE-053 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low) en tres cortes; verificación del leader.
- **Corte A** (`a6fc363f7b12284d3781acd7f771be35f34158da`): modelo `ExperimentRepetitionArtifact`, migración `20261013100000_experiment_repetition_artifacts` (CREATE TABLE, índice único, FK `ON DELETE CASCADE`, RLS; SQL idéntico a `prisma migrate diff`), `buildRepetitionArtifact` y `upsertRepetitionArtifact`. El implementer declaró que escribió pruebas e implementación en la misma pasada (sin captura roja previa); la revisión independiente debe aportarla por mutación.
- **Corte B/C** (`896cd86e83c3b24f1265033bf3f98ecb5ab38630`): cableado en `experiment-job.handler.ts`; escritura best-effort tras `updateRepetitionById`; `safeBuildArtifact` evita que un fallo de la evidencia convierta la repetición en fallo de infraestructura (prueba roja→verde).
- `npx vitest run` (app): 142 archivos pasan, 6 omitidos; 2242 pruebas pasan, 104 omitidas. `oxlint src/experiments` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base). `prisma validate` y `prisma generate` correctos; `validate-harness` y `node --test harness/*.test.mjs` pasan.
- Sin build; `app/.env` no tocado; **la migración no se aplicó a ninguna base** (la aplica el coordinador con `pg_dump` previo y `prisma migrate deploy`).
- Alcance: tabla privada nueva y repetición; DTO público, §6.16, evidence/, sandbox/, ranking y clasificación sin cambios. Contenido del test guardado tal como se envió (hasta 256 KiB); mensajes saneados (≤500 caracteres); sin stdout/stderr (el Sandbox no los devuelve; pedido aparte). Sin purga (DEC-VAL-001 PENDING).
