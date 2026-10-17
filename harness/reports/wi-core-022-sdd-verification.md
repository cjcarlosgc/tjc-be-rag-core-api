# WI-CORE-022 — Verificación de suficiencia SDD

Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Solo lectura sobre `app/`; sin llamadas externas. Se añadió el detalle técnico verificado a `spec/features/004-rag-retrieval-context/plan.md`.

## Veredicto: DECISION_REQUIRED (una decisión PROPOSED con Blocks sobre el corte de creación)

Verificaciones del rol: HU05 y HU17 están en HU01-HU18; `ST-CORE-029` existe en el `tasks.md` de 004 (`T-READY`); componente CORE; sin `caseIds` OC; dependencias `WI-CORE-017` y `WI-CORE-019` hechas; `contractSyncReview` de CS-20260920-001 y CS-20260921-003 ya está como NOT_RELEVANT. El alcance está aprobado en `smart-v3-scope-approval.md`. Los cortes 1, 2 y el resto de 3 se pueden implementar ya; solo la validación de creación para un Run sin `projectVersionId` queda bloqueada por DEC-RC-001.

## Decisiones

- **DEC-RC-001 (PROPOSED, Blocks: WI-CORE-022 en `POST /retrieval-comparisons`).** §6.15 define 404/422/403/400 pero no qué responde la creación cuando el `AnalysisRun` existe y es visible pero aún no tiene `projectVersionId` (QUEUED o snapshot sin terminar). La respuesta 202 exige `projectVersionId: Id`, así que no puede aceptarse. Propuesta: `409 ANALYSIS_NOT_FINISHED` (código ya existente en Core y en INTEROP; no hay `ErrorCode` nuevo). Agrega un 409 no listado en §6.15: es un cambio contractual aditivo que el usuario debe aprobar. Pregunta concreta: ¿aprobamos `409 ANALYSIS_NOT_FINISHED` cuando el Run no tiene `projectVersionId`, y se agrega a §6.15?
- **DEC-RC-002 (PROPOSED, NO bloquea): job `retrieval-comparison` fuera de `RELEASABLE_UNKEYED_JOB_TYPES`.** Es solo lectura y su handler es idempotente (escribe resultados por `(comparisonId, mode)` único con upsert), así que liberar un lock obsoleto sería seguro y barato; pero `DEC-JOBS-001` y `async-jobs/spec.md` fijan una lista cerrada (`['experiment-run']`) y extenderla es un cambio de decisión aprobada, fuera de lo autorizado. Recomendación: NO añadirlo en este WI. Un worker caído deja la comparación `RUNNING`; se declara como riesgo y se cubre con `IDEA-011` (recuperación por entidad). Sí se implementa `onExhausted` para cerrar `FAILED` con `RETRIEVAL_COMPARISON_WORKER_LOST` cuando el job agota intentos por fallos normales. Si el usuario prefiere liberarlo, es una enmienda de DEC-JOBS-001 en un WI aparte.
- No se cierra ninguna decisión. `harness/state.json` debe registrar `DEC-RC-001` en `blockingDecisionIds` y `DEC-RC-002` en `nonBlockingDecisionIds`.

## Hallazgos

1. **§6.15 vs WI.** El WI implementa exactamente §6.15 (4 rutas, shapes, errores, métricas, sin ganador). No hay `ErrorCode` nuevos por inventar: faltan en `error-code.enum.ts` los ya definidos en INTEROP: `ANALYSIS_SYMBOL_NOT_FOUND` (404), `UNSUPPORTED_SYMBOL_KIND` (422), `RETRIEVAL_COMPARISON_NOT_FOUND` (404) y `RETRIEVAL_COMPARISON_NOT_FINISHED` (409); `PROJECT_ROLE_INSUFFICIENT` ya existe. Hay que añadirlos al enum y a §4 del contrato si §4 los lista por código (verificar con el contract-reviewer).
2. **Anchor y embeddings: NO hay llamada a OpenAI en la operación.** `RetrievalService` usa el embedding ya almacenado del chunk ancla (`findSimilarByEmbedding` compara `a.embedding`). `embeddingModel` se reporta desde `EMBEDDING_MODEL` (`text-embedding-3-small`). No hay verificación real pendiente de OpenAI para este WI; las pruebas con pgvector sobre Postgres real (`<=>`) sí son una verificación real pendiente si el repo tiene pruebas pg (patrón `jobs.repository.pg.spec.ts`).
3. **Pesos.** «Pesos por defecto de ContextBuilder» = constantes 0.7/0.3, pero `ContextBuilder.resolveConfig` los lee de `RETRIEVAL_SEMANTIC_WEIGHT`/`RETRIEVAL_STRUCTURAL_WEIGHT`. Se toma `resolveConfig` (env con default 0.7/0.3), y se reportan en `config` del modo SE. Hay que exponer una API pública pequeña en `ContextBuilder` (p. ej. `resolveWeights()` y `scoreCandidate(...)`); el orden del producto NO cambia (sigue `sort` solo por score).
4. **Orden.** El orden de comparación (score desc, semanticScore desc, chunkId asc) es nuevo y NO se aplica al flujo del producto (que solo ordena por score, desempate por inserción). Se implementa como función pura nueva (`rankComparisonCandidates`) reutilizando la fórmula; así el producto y sus trazas no cambian.
5. **`selected` y `minimumScore`.** `selected = rank ≤ 10` sin aplicar `minimumScore` ni presupuesto de tokens (no es el flujo del producto). `finalTopK` = 10 fijo.
6. **Top semántico.** `retrieve(..., vectorTopK = 20)` ya usa 20; SEM toma esos 20 y devuelve los 10 primeros. La SQL ya excluye el mismo símbolo y partes hermanas.
7. **Estructurales.** Hoy `StructuralMatch` es `'IMPORTS' | 'IMPORTED_BY'` (suficiente para TypeScript). `StructuralRelation` del contrato añade las relaciones PHP, diferidas a `WI-CORE-028`: no ampliar el tipo interno aquí, sí el tipo de respuesta.
8. **Símbolo → target.** Reusar `toRetrievalTarget` (`validation/symbol-target.util.ts`) sobre el `AnalysisSymbol` DIRECTLY_CHANGED METHOD/FUNCTION; símbolo ausente → 404; otro kind o changeKind no elegible → 422. Lenguaje PHP: tratar como no soportado en este WI (422 UNSUPPORTED_SYMBOL_KIND no aplica; ver riesgo R4).
9. **Guards.** `@RequireProjectRole('WRITER', ProjectTargets.body('analysisRun','analysisRunId'))` en el POST; `READER` con `ProjectTargets.param('retrievalComparison', 'retrievalComparisonId')` en los GET por id y `param('analysisRun','analysisRunId')` en el listado. Requiere añadir el recurso `retrievalComparison` a `ProjectResourceKind` (`project-access.errors.ts` y el switch de `project-access.repository.ts`), con su 404 `RETRIEVAL_COMPARISON_NOT_FOUND`, y su spec.
10. **Listado paginado.** Mismo patrón `Page<>` con cursor/limit de `common/dto/page.response.ts`; orden `createdAt desc, id desc`.

## Detalle técnico (resumen; versión vigente en `plan.md`)

- **Modelo.** `retrieval_comparisons(id uuid pk, analysisRunId fk analysis_runs, projectId fk projects, projectVersionId fk project_versions, symbolFilePath, symbolQualifiedName, symbolKind, idempotencyKey nullable, status enum PENDING|RUNNING|COMPLETED|FAILED default PENDING, failureCode, failureMessage, groundTruth jsonb null, startedAt, completedAt, createdAt, updatedAt; índices (analysisRunId, createdAt), (projectId))`. `retrieval_comparison_results(id uuid pk = retrievalId, comparisonId fk ON DELETE CASCADE, mode enum SE|SEM, config jsonb, candidates jsonb, metrics jsonb null, createdAt; UNIQUE(comparisonId, mode))`. Enums Prisma nuevos `RetrievalComparisonStatus` y `RetrievalMode`. Migración aditiva `YYYYMMDDHHMMSS_retrieval_comparisons` (solo CREATE TYPE/TABLE/INDEX, sin tocar tablas existentes), con el patrón de `20261009100000_experiment_run_pair_budget`. El `symbol` de respuesta se reconstruye desde el `AnalysisSymbol` (language, kind, changeKind) o se persiste en `symbol jsonb`; elegir `symbol jsonb` snapshot para que el resultado no dependa de re-lecturas.
- **Repositorio.** `RetrievalComparisonsRepository`: `create(input, tx)`, `findById`, `listByAnalysisRun(analysisRunId, cursor, limit)`, `markRunning` (solo PENDING/FAILED→RUNNING, setea startedAt si nulo), `saveResultsAndComplete` (tx: upsert por `(comparisonId, mode)` x2 + COMPLETED + completedAt), `markFailed(code, message)`, `findResults`.
- **Job.** Tipo `retrieval-comparison` (constante `RETRIEVAL_COMPARISON_JOB_TYPE`, kebab como los demás tipos de dominio), payload `{retrievalComparisonId, projectId, projectVersionId, analysisRunId}`, sin `dedupeKey`, `maxAttempts` por defecto. Handler: carga la comparación; si COMPLETED sale (idempotente); marca RUNNING; resuelve target; ejecuta `retrieve` una sola vez y deriva SE y SEM del mismo resultado semántico (garantiza «mismos 20»); calcula métricas; persiste en tx. Errores: `UNRESOLVABLE_TARGET`/falta de chunks → FAILED con `failureCode=RETRIEVAL_TARGET_UNRESOLVABLE`; error inesperado → `RETRIEVAL_COMPARISON_FAILED` y se relanza para reintento hasta agotar. `onExhausted` → FAILED `RETRIEVAL_COMPARISON_WORKER_LOST`. Es idempotente: reejecutarlo produce los mismos resultados (determinista) y el upsert evita duplicados. No inyecta LLM, Functional Knowledge, Sandbox ni publicaciones; no toca `AnalysisRun`.
- **Idempotencia.** Ampliar `IdempotencyScope` con `'RETRIEVAL_COMPARISON_CREATE'`; `IdempotencyService.run` con `fingerprintInput=dto` (incl. groundTruth), `create` inserta comparación + encola job en la misma tx, `rebuildResponse` desde `operationId` = `retrievalComparisonId`. Si el modelo de datos de `IdempotencyRecord` tiene enum/columna acotada de scope, verificar en el esquema (es `String`; comprobar al implementar).
- **Métricas.** Función pura `computeRetrievalMetrics(candidates, groundTruth)`: top-k por rank; coincidencia exacta `(filePath, symbolQualifiedName)` donde `symbolQualifiedName` de un candidato = `parent.symbol` (METHOD) o `symbolName` (qualifiedName del símbolo) y `null` no coincide; groundTruth deduplicado antes de contar; `P@k = hits/k` (k fijo 5 y 10 aunque haya menos candidatos), `R@k = hits/|groundTruth|`. `null` si no hay groundTruth o está vacía.

## Pruebas requeridas

`retrieval.service.spec.ts` (modo SE por defecto sin argumento == flujo actual; SEM sin estructurales, top 10 por semántico; SE une/deduplica; empates por chunkId), `context-builder.service.spec.ts` (nueva API de pesos/score sin cambiar el ranking del producto), spec del ranking/métricas puros, repositorio (pg si el patrón existe), handler (idempotencia, FAILED/onExhausted, mocks de que no se inyecta ni llama a LLM/FK/Sandbox/publicación, `AnalysisRun` intacto), servicio (404/422/409/403, replay de idempotencia, 409 not finished en results), controlador/guards, y una prueba de que el producto sigue llamando `retrieve` sin modo. Cero llamadas reales.

## Impacto contractual

Se implementa EXACTAMENTE §6.15, más DEC-RC-001 si se aprueba. Al implementar: marcar §6.15 como **Implementado** en `WI-CORE-022` con fecha, actualizar la línea de `INTEROP-2.7` (sección de estado, línea 14) y la 1377 (hoy dice 6.15/6.16 pendientes), reflejar la lista de errores nuevos si §4 los enumera, y el CHANGELOG. Es una nota de estado dentro de INTEROP-2.7, no un cambio de versión. Contract Sync de implementación a Console (para `WI-CONSOLE-014`) con los cuatro checkpoints; activar `contract-reviewer` antes de implementar por el 409 propuesto y por los `ErrorCode`.

## Riesgos

- R1: DEC-RC-001 sin resolver deja indefinido el comportamiento de creación para un Run sin versión.
- R2: lock RUNNING obsoleto sin recuperación (DEC-RC-002); la comparación puede quedar RUNNING tras caída del worker.
- R3: escalabilidad: `findByProjectVersion` carga todos los chunks para resolver estructurales (igual que el producto); aceptable en V1.
- R4: símbolos PHP: sin chunks/retrieval PHP aún; el Run PHP debe fallar controladamente (`422 UNSUPPORTED_SYMBOL_KIND` es de tipo, no de lenguaje; el desempate de lenguaje no está en §6.15). Propuesta: rechazar `language=PHP` con `422 UNSUPPORTED_SYMBOL_KIND` hasta `WI-CORE-028`; si el usuario no lo acepta, incorporarlo a DEC-RC-001.
- R5: `groundTruth` grande: validar tamaño máximo en el DTO (p. ej. ≤ 200 elementos) sin cambiar el contrato (se rechaza con 400 de validación).

## Cortes propuestos

1. Migración + enums Prisma + `RetrievalComparisonsRepository` + `RETRIEVAL_MODE` SE/SEM en `RetrievalService` + API de pesos/score en `ContextBuilder` + función de ranking y métricas puras (con sus specs).
2. Job `retrieval-comparison` + handler + servicio de creación + `IdempotencyScope` (sin controlador).
3. Controlador, DTOs, `ErrorCode`, recurso `retrievalComparison` en project-access, listado paginado (depende de DEC-RC-001 para el 409 de creación).
4. Cierre: documentos (INTEROP/plan/tasks/CHANGELOG), Contract Sync a Console, harness, lint, test y build, revisión del usuario.

## Verificaciones reales pendientes para el agente principal

Ninguna con OpenAI. Opcional: ejecutar la comparación contra Postgres/pgvector real (pruebas `*.pg.spec.ts` o humo local) para confirmar el ordenamiento coseno y la migración aplicada.
