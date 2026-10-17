# WI-CORE-026 — Implementación (trace operativo de nueve enlaces con retrieval_id y context_id)
Modelo: implementer-high e implementer · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high y low

Cortes A-D por `implementer-high` (Haiku 5.5 / high; motivo: migraciones, persistencia por target, captura de executionId y endpoint); corte E por `implementer` (Haiku 5.5 / low). Redactado por el leader a partir de los informes; los checks los volvió a correr el leader.

## Commits de código (cada uno compila con `tsc -p tsconfig.build.json`; trailer Haiku 5.5)
- `d91fdac` corte A: migración `20261009140000_analysis_trace_retrieval_context` (analysis_retrievals, analysis_contexts, contextId), `retrieval_id`/`context_id` por target en `generateAndValidate` sin mutar el contexto, obligación de 021 (reglas seleccionadas, conteos y omitidas por TOKEN_BUDGET con `knowledgeId`; el detail experimental añade `functionalRules` sin procedencia ni texto; aserción de ausencia invertida).
- `16978ab` corte B: migración `20261009150000_analysis_run_executions`, `executionId` desde el Sandbox (`SandboxAcceptedExecutionError`), upsert de propuestas por símbolo.
- `5ff4f9d` corte C: `GET /analysis-runs/{id}/trace` (Reader, 404/409 `EVIDENCE_NOT_FINISHED`, NOT_APPLICABLE por enlace, DEC-TRACE-002).
- `468870c` corte D: migración `20261009160000_analysis_run_check_id`, `checkId` persistido (tolera 200 `{checkId}` y 204) y expuesto.
- `8c8839c` corte E: registro de ejecución best-effort en el camino de éxito y 2xx con cuerpo no JSON del Check tratado como `checkId` null.
Documentos: `018c35c` (INTEROP §6.16), `209807f` (corrección y ratificación final), `0a9d5ba` (GH-INTEROP-1.3), `2fb253c` (decisiones).

## Verificación (leader, 2026-10-09)
- lint 0; build 0; `tsc --noEmit` 43 (línea base); `pnpm test` x3: 1683 pasan, 77 omitidos, 1760 total (antes 1648), sin intermitencias; e2e con URL inalcanzable 237 pasan.
- Diff: `git diff f92a746..HEAD -- app` (36 archivos, +2262/-69). El implementer corrió specs pg (77) contra PostgreSQL 14 desechable con shim de pgvector solo en `code_chunks`; las tres migraciones NO se aplicaron a ninguna base real.
- Contract Sync: `CS-CORE-20261009-012` (GH-INTEROP-1.3 hacia github-integration) y `CS-CORE-20261009-013` (§6.16 hacia Console), ambos `C-PENDING`; contract-reviewer APPROVED (`wi-core-026-contract-review.md`, `wi-core-026-gh-interop-review.md`, `wi-core-026-contract-final-review.md`).

## Decisiones del implementer que el usuario debe conocer
`generated_test_proposals.analysisSymbolId` nullable con FK y UNIQUE(analysisRunId, analysisSymbolId) (no estaba en el plan); `checkId` vive en `analysis_runs` (un Check por Run); `attempt = analysis_runs.attemptCount + 1`; `outcome` usa el vocabulario del Run (SUCCESS, BEHAVIORAL_MISMATCH, TECHNICAL_GENERATION_FAILURE); orden de targets por filePath, qualifiedName, id (no hay columna de posición); `retrieval.config = {mode:'SE', vectorTopK:20, targetChunkIds}` y candidates sin código; `EVIDENCE_NOT_FINISHED` como ErrorCode de dominio 409; `persistProposal` pasa de create a upsert por símbolo; el 403 solo como metadato `@RequireProjectRole('READER')`; corte E: la captura de ejecución es best-effort (se loguea solo `error.name`) y un 2xx ilegible da `checkId` null.

## Deudas
- Migraciones `20261009130000` (022), `140000`, `150000` y `160000` sin aplicar a ninguna base real; verificación con Postgres/pgvector real pendiente del agente principal.
- Ejecución aceptada que luego falla deja la propuesta `HELD` con contenido vacío; conviene guardar el hash del artefacto ejecutado (`IDEA-013`).
- Runs y propuestas previos a cada migración quedan `NOT_APPLICABLE` o con `analysisSymbolId` NULL y sus ejecuciones sin enlazar (sin backfill).
- `WI-CORE-027` no debe exponer conteos ni omitidas sin enmendar el contrato.
- `checkId` solo será no nulo cuando GitHub Integration implemente `CS-CORE-20261009-012`.
- El corte E no tuvo mutation test.

## Corte F — hallazgos de la revisión independiente (CHANGES_REQUESTED, ciclo 1 de 2)
Reporte del reviewer: `harness/reports/wi-core-026-independent-review.md`. Corte F por `implementer` (Haiku 5.5 / low, esfuerzo low):
- `b03ae56` (hallazgos 1, 2, 3): columna nullable `analysis_runs.checkPublishedAt` (migración `20261009170000_analysis_run_check_published_at`, sin backfill, rollback documentado); `markCheckPublished(id, checkId|null)` se escribe tras un `createCheckRun` exitoso aunque el id sea null (best-effort); `publication.status = PRESENT` si hay `checkId`, `checkPublishedAt` o `TestPublication`, `NOT_APPLICABLE` si ninguno (DEC-TRACE-002); `context` comparado con `toEqual` sobre filas completas y aserción de no exposición de conteos/omitidas/`knowledgeId`; prueba del desempate por `qualifiedName`.
- `70b10d3` (hallazgos 4 y 5): `recordExecution` best-effort también en la rama HELD y en el catch (la propuesta conserva contenido y clasificación); prueba dividida para coincidir con su título.
- `c37b27d` (cambio mínimo declarado del leader, `executedBy agent: leader`, motivo «cambio mínimo»): una línea `checkPublishedAt: null` en el fixture de `app/src/github-webhooks/github-webhooks.service.spec.ts` (solo prueba, 1 línea, 1 archivo) que corrige un error de tipos introducido por `b03ae56`.

### Medición de `tsc --noEmit` (worktree desechable con `prisma generate` en cada commit)
| Commit | errores |
|---|---|
| `f92a746` (base de 026) | 43 |
| `d91fdac` (corte A) | 44 (un error adicional en `analysis-run-validation-job.handler.spec.ts`: fixture del binding sin `disabledReason`) |
| `8c8839c` (corte E) | 43 |
| `70b10d3` (corte F) | 44 (nuevo error en `github-webhooks.service.spec.ts`: `checkPublishedAt` ausente en el fixture) |
| `c37b27d` (HEAD) | 43 |
Conclusión: el 44 en `d91fdac` fue una regresión real de fixture (solo spec) corregida después; el 44 en `70b10d3` era una regresión real de fixture de `b03ae56`, corregida en `c37b27d`. La línea base de 43 se mantiene en HEAD; una medición con cliente Prisma desactualizado puede dar 44.

### Verificación del leader tras el corte F (HEAD `c37b27d`)
lint 0; build 0; `tsc --noEmit` 43 con cliente regenerado; `pnpm test` x3: 1689 pasan, 82 omitidos, 1771 total (antes 1683/77); e2e con URL inalcanzable 237 pasan. El implementer corrió 82 specs pg en PostgreSQL 14 desechable con las 45 migraciones (aplica, rollback válido, `migrate diff` sin diferencias en `analysis_runs`) y 4 mutaciones temporales detectadas.

### Deuda añadida
La migración `20261009170000` no está aplicada a ninguna base real; la verificación sobre Postgres real sigue pendiente del agente principal. `checkPublishedAt` queda NULL en Runs previos (sin backfill: su `publication` solo será `PRESENT` si tienen `checkId` o `TestPublication`).
