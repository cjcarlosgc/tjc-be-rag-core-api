# WI-CORE-022 — Implementación (comparación de retrieval OE2, SE vs SEM)
Modelo: implementer-high y implementer · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high y low

Cortes 1-3 por `implementer-high` (Haiku 5.5 / high; motivo: migración, modo de recuperación y job con concurrencia); cortes 3b, 3c y 3d por `implementer` (Haiku 5.5 / low). Redactado por el leader a partir de los informes; los checks los volvió a correr el leader.

## Commits de código (cada uno compila con `tsc -p tsconfig.build.json`; trailer con el modelo real)
- `172937a` corte 1: migración aditiva `20261009130000_retrieval_comparisons` (enums, tablas, UNIQUE(comparisonId, mode), FK en cascada, RLS), `RetrievalService.retrieve` con modo SE|SEM, `resolveWeights`/`scoreCandidate` en `ContextBuilder`, `rankComparisonCandidates` y `computeRetrievalMetrics` puros, repositorio.
- `1d9a421` corte 2: job `retrieval-comparison` sin `dedupeKey`, handler idempotente, servicio de creación con scope `RETRIEVAL_COMPARISON_CREATE`, tipo añadido a `RELEASABLE_UNKEYED_JOB_TYPES` (DEC-RC-002).
- `a7725fd` corte 3: controlador con las 4 rutas de §6.15, DTOs (`groundTruth` máx. 200), recurso `retrievalComparison` en project-access, listado `Page<T>`, matriz e2e.
- `dba731f` corte 3b: DEC-RC-001 (409 `ANALYSIS_NOT_FINISHED`, 422 `UNSUPPORTED_PROJECT` para PHP, orden de validación acordado).
- `25d291a` corte 3c: `onExhausted` conserva `RETRIEVAL_COMPARISON_FAILED`; `WORKER_LOST` solo sin fallo registrado.
- `d3829fc` corte 3d: DEC-RC-003 (results de una comparación FAILED → 409 `RETRIEVAL_COMPARISON_FAILED`; sin `new Date()` en `completedAt`).
Documentos: `9b7035e` (INTEROP §6.15 a Implementado), `dd7e526` (ratificación final), `ada31dc`/`d8cbd5e`/`1589863` (decisiones).

## Verificación (leader, 2026-10-09)
- lint 0; build 0; `tsc --noEmit` 43 (línea base); `pnpm test` x3: 1648 pasan, 69 omitidos, 1717 total (antes 1545 tras 031), sin intermitencias; e2e con URL inalcanzable: 234 pasan.
- Diff: `git diff 87a91b4..HEAD -- app` (34 archivos, +3083/-34 incl. docs de rango; código en `app/`). Specs pg corridos por el implementer en PostgreSQL 14 desechable: `retrieval-comparisons.repository.pg.spec` 9/9 y `jobs.repository.pg.spec` 60/60 (UTC y America/Bogota); la migración no se aplicó a ninguna base real.
- Sin LLM, Functional Knowledge, ACTION_REQUIRED, generación, Sandbox ni publicación en el handler; no escribe el `AnalysisRun`.
- Contract Sync `CS-CORE-20261009-011` publicado hacia Console (`harness/reports/contract-sync-publish-cs-core-20261009-011.md`).

## Decisiones y lista de jobs liberables
DEC-RC-001, DEC-RC-002 y DEC-RC-003 aprobadas por el usuario. `RELEASABLE_UNKEYED_JOB_TYPES` es ahora `['experiment-run', 'retrieval-comparison']`; `snapshot-analysis`, `functional-continuation`, `analysis-run-validation` y `test-publication` siguen sin liberarse.

## Decisiones del implementer que el usuario debe conocer
hits@k sobre elementos distintos de `groundTruth`; desempate por `semanticScore` con null último y luego `chunkId` asc; SEM derivado de la misma recuperación que SE; `symbol` como jsonb; `embeddingModel` sin llamar al proveedor; `pollAfterMs` con `INDEXING_POLL_AFTER_MS`; cambios de fixtures en `test/support`.

## Deudas
- Verificación contra Postgres con pgvector real pendiente (la hace el agente principal); migración `20261009130000` no aplicada a Supabase.
- Un flake `socket hang up` en `test/access-webhooks.e2e-spec.ts` (aislado 41/41; corridas completas posteriores verdes).
- `requireNotPhpVersion` no rechaza una versión inexistente (la FK lo impide).
- En COMPLETED con `completedAt` null el DTO lo permite (`string | null`) aunque el contrato lo declara no nulo; no debería ocurrir.
