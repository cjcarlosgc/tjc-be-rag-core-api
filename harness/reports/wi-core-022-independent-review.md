# WI-CORE-022 - Revision independiente

Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

- Work item: WI-CORE-022 (comparacion de retrieval OE2, SE contra SEM), W-IN_REVIEW.
- HU: HU05, HU17.
- Rango de codigo: `git diff 87a91b4..HEAD -- app` (34 archivos). Commits de codigo: 172937a, 1d9a421, a7725fd, dba731f, 25d291a, d3829fc. Commits de spec/harness: 9b7035e, ba033b6, dd7e526, d8cbd5e, ada31dc y los de Harness del WI.
- Revision delegada por el usuario (Human Reviewer) en chat. Este veredicto no sustituye la aprobacion humana de alcance/arquitectura (DEC-RC-001/002/003 y smart-v3-scope-approval.md).

## Veredicto

**APPROVED** (sin blockers ni hallazgos importantes; dos observaciones menores no bloqueantes).

## Verificado ejecutando

Desde `app/` con `DATABASE_URL`/`DIRECT_URL` = `postgresql://nouser:nopass@127.0.0.1:1/none`:

| Comprobacion | Resultado |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm test` (2 corridas) | 120 archivos / 1648 tests pasan, 2 archivos y 69 tests omitidos (pg); ambas corridas iguales |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | corrida 1: 234/234. Corrida 2: 1 fallo `socket hang up` en `access-matrix.e2e-spec.ts` (POST context-questions answers), coincidente con una carga paralela mia (initdb/psql); repetida 2 veces despues: 234/234 y 234/234. Es el mismo flake intermitente conocido de supertest, no ligado al WI |
| `npx tsc --noEmit -p tsconfig.json` | 43 errores, todos en specs/test (igual a la linea base); ninguno en `retrieval-comparisons` |
| `node harness/validate-harness.mjs` | `Harness V3 validation passed.` |
| `node harness/contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-022` | `relevantPendingSyncIds: []`, sin pendientes; no se registro nada |
| Compilacion por commit (worktree desechable, `prisma generate` por commit): 172937a, 1d9a421, a7725fd, dba731f, 25d291a, d3829fc | `tsc -p tsconfig.build.json` 0 errores y 43 en `tsconfig.json` (linea base) en cada uno; tests de retrieval-comparisons/jobs/retrieval/project-access/prisma pasan en cada uno (221, 252, 275, 281, 285 y el de d3829fc) |
| Higiene de commits | todos los commits del rango llevan `Refs: HU05, HU17` y trailer `Co-Authored-By` (Haiku 5.5 en los de codigo, Sonnet 5.5 en los docs). Excepcion legitima: 13dc31a y 1322cda declaran `Refs: ninguna` (cambio transversal de Harness) |
| Ramas / worktrees | tras la revision solo queda el worktree principal; mis worktrees desechables se eliminaron. `git status` limpio salvo este reporte |

### Postgres desechable (k)

PostgreSQL 14.18 local en 127.0.0.1:55439 dentro del scratchpad. Sin pgvector: copia del historial de migraciones con `vector(1536)` -> `double precision[]` y sin el indice HNSW solo en el historial previo (la migracion 20261009130000 se aplico tal cual).

- La migracion 20261009130000 aplica limpia sobre el historial completo.
- `retrieval-comparisons.repository.pg.spec.ts` + `jobs.repository.pg.spec.ts`: 2 archivos, 69 tests pasan.
- `prisma migrate diff --from-config-datasource --to-schema schema.prisma` no muestra ninguna diferencia en `retrieval_comparisons`/`retrieval_comparison_results` (las unicas diferencias son la columna vector por el shim y renombres de indices preexistentes).
- RLS habilitado en ambas tablas (`relrowsecurity = t`); UNIQUE(comparisonId, mode) y FK en cascada de results presentes. La migracion es aditiva (2 CREATE TYPE, 2 CREATE TABLE, 3 CREATE INDEX, FKs) y trae rollback manual documentado.
- Servidor detenido y datos borrados al terminar (ver final).

## Mutaciones (worktree desechable, spec relevantes: retrieval-comparisons, jobs, project-access)

Cada mutante rompe al menos una prueba, salvo dos:

| Mutante | Resultado |
| --- | --- |
| Quitar el 409 RETRIEVAL_COMPARISON_FAILED | 3 tests fallan |
| Validar el simbolo antes del 422 PHP (orden DEC-RC-001) | 2 fallan |
| Quitar el `validateKey` previo (orden 400 antes de 409/422/404) | 3 fallan |
| Liberar `snapshot-analysis` en RELEASABLE_UNKEYED_JOB_TYPES | 1 falla |
| Desempate por chunkId descendente | 1 falla |
| Null de semanticScore ordenado primero | 1 falla |
| Desempate por semanticScore ascendente | 2 fallan |
| Hits contados sobre elementos repetidos (sin Set) | 1 falla |
| onExhausted ignora RETRIEVAL_COMPARISON_FAILED ya registrado | 1 falla |
| onExhausted pisa FAILED / pisa COMPLETED | 2 / 4 fallan |
| Acceso `retrievalComparison` roto en project-access | 1 falla |
| failureMessage con stack | 1 falla |
| `selected` con `<` en lugar de `<=` | 2 fallan |
| Quitar 409 ANALYSIS_NOT_FINISHED / 422 PHP | 2 / 3 fallan |
| candidato sin symbolQualifiedName coincide como `''` | sobrevive: es un mutante equivalente, el DTO exige `symbolQualifiedName` no vacio, asi que `''` nunca esta en la verdad de terreno |
| scope de idempotencia cambiado a otro valor | sobrevive (ver M-2) |

Las pruebas nuevas no usan tiempos reales (sin sleep, timers ni `Date.now`).

## Conformidad con §6.15 y decisiones (razonado y comprobado contra el codigo)

- Cuatro rutas con roles correctos (POST Writer sobre `body('analysisRun','analysisRunId')`; GET Reader sobre `retrievalComparison` y `analysisRun`); 202 con `pollAfterMs`; `Page<T>` con `createdAt desc, id desc`; 404 de comparacion y de Run sin filtrar existencia; matriz e2e de roles actualizada (`interop-role-matrix.ts` ya no marca las cuatro como pendientes).
- DEC-RC-001: orden en `create` = guard (rol, 404 Run) -> validacion de cuerpo -> `validateKey` -> 409 sin projectVersionId -> 422 PHP -> 404 simbolo -> 422 tipo/changeKind -> idempotencia. Conforme.
- DEC-RC-002: lista exacta `['experiment-run','retrieval-comparison']`, congelada; probado.
- DEC-RC-003: FAILED -> 409 RETRIEVAL_COMPARISON_FAILED; PENDING/RUNNING -> NOT_FINISHED; 200 solo COMPLETED con SE y SEM ordenados; `completedAt` no se inventa.
- Sin OpenAI: ancla = primer chunk con embedding guardado (`findSimilarByEmbedding`); el handler solo depende de JobsService, repositorio, RetrievalService, ContextBuilder y Config; la prueba estatica existente lo verifica; no escribe el AnalysisRun.
- Ranking: SE por score combinado (misma formula, `ContextBuilder.scoreCandidate`, refactor sin cambio de comportamiento para el producto) con desempate semanticScore desc (null ultimo) y chunkId asc; SEM = subconjunto con `semanticScore` de la misma recuperacion SE. Equivalente al modo SEM de `RetrievalService` (mismos 20 candidatos semanticos menos el mismo simbolo, sin estructurales); `RetrievalService.retrieve` conserva modo SE por defecto.
- Metricas: hits sobre elementos distintos, groundTruth deduplicada, k fijo 5 y 10, cotas [0,1], `null` sin groundTruth; match exacto; `selected = rank <= 10`.
- Handler: `markRunning` acepta PENDING/RUNNING/FAILED y limpia el fallo; error inesperado -> `recordFailure` (estado RUNNING, sin cerrar) y relanza un error saneado (no queda texto crudo en `lastError`); `onExhausted` conserva RETRIEVAL_COMPARISON_FAILED, usa WORKER_LOST solo sin fallo registrado y nunca pisa COMPLETED/FAILED; `saveResultsAndComplete` transaccional, condicionado a estado abierto, upsert por (comparisonId, mode).
- Idempotencia: scope `RETRIEVAL_COMPARISON_CREATE`, replay misma respuesta y sin segundo job (probado en HTTP spec); un rechazo de validacion ocurre antes de `idempotencyService.run`, por lo que no consume la clave.
- Contract Sync CS-CORE-20261009-011: Console, breaking false, sourceRevision d3829fc, 5 ErrorCode nuevos; consistente con el codigo y con §6.15.

## Hallazgos

Ninguno blocker ni importante.

- M-1 (menor, limpieza): `finalTopK: 10` esta como literal en `retrieval-comparison-job.handler.ts` (config de ambos modos) pese a existir `COMPARISON_FINAL_TOP_K` en `retrieval-comparison-ranking.ts`; riesgo de divergencia futura entre `config.finalTopK` y `selected`. Tambien `retrieval-comparisons.service.ts` importa dos veces desde `../generated/prisma/client.js` (lineas ~7 y ~14). No cambia comportamiento.
- M-2 (menor, prueba): ninguna prueba afirma el literal del scope `'RETRIEVAL_COMPARISON_CREATE'` (el mutante que lo cambia sobrevive; el servicio de idempotencia en los specs usa un Prisma en memoria que acepta cualquier scope). Impacto solo si se cambia por error el scope, que ademas esta en el contrato.

## Limitaciones conocidas aceptadas (sin cambios)

Verificacion con pgvector real pendiente (el agente principal); migracion no aplicada a Supabase; flake `socket hang up` (visto de nuevo una vez bajo carga paralela, no reproducido en 2 corridas posteriores); `requireNotPhpVersion` no rechaza versiones inexistentes por la FK; `completedAt` nullable en el DTO de results; PHP hasta WI-CORE-028; worker caido sin latido cubierto por WI-CORE-030.

## Proximo paso

El usuario puede revisar diff y este reporte y cerrar WI-CORE-022 (`DONE`) segun el flujo. M-1 y M-2 pueden resolverse en un corte posterior sin bloquear.
