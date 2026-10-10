# WI-CORE-022 — Revisión final de contrato (INTEROP-2.7 §6.15)
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Revisado `git show HEAD` (9b7035e: INTEROP líneas 14, §6.15, §8/1377 y CHANGELOG). Sin cambios de texto necesarios; no se editó el contrato.

## Veredicto: APPROVED (breaking=false, sin bump de versión)

## Ratificación
- Informe `wi-core-022-contract-review.md`: aplicados el texto de §6.15 (Implementado en Core), línea 14, §8, tope `groundTruth` 200 con `400`, `failureCode` abierto con los tres valores conocidos y la condición de `failureMessage` sin trazas ni credenciales.
- `wi-core-022-failed-results-review.md` opción (c) / DEC-RC-003: `/results` FAILED -> `409 RETRIEVAL_COMPARISON_FAILED` (mismo cuerpo §4, detalle en el status); `NOT_FINISHED` solo PENDING/RUNNING; `200` siempre exactamente SE y SEM. El `completedAt` no nulo del tipo es coherente porque el 200 solo existe en COMPLETED.
- DEC-RC-001: `409 ANALYSIS_NOT_FINISHED` (Run visible sin `projectVersionId`) y `422 UNSUPPORTED_PROJECT` para PHP, retirado solo en la comparación por WI-CORE-028; coherente con §6.5 (línea 341), que ya usa `UNSUPPORTED_PROJECT`.
- Código: controlador (POST Writer; GET status/results/listado Reader; recursos `analysisRun`/`retrievalComparison`), servicio (`ANALYSIS_NOT_FINISHED` antes de otras comprobaciones, `UNSUPPORTED_PROJECT` PHP, `getResults` con FAILED -> 409 `RETRIEVAL_COMPARISON_FAILED` y no-COMPLETED -> NOT_FINISHED), DTO (`pollAfterMs`, `MAX_GROUND_TRUTH_ITEMS = 200` con `ArrayMaxSize`), scope de idempotencia `RETRIEVAL_COMPARISON_CREATE`.
- `ErrorCode`: `RETRIEVAL_COMPARISON_FAILED` está en el árbol de trabajo (sin commitear, del subagente en paralelo); verificado ahí y contra DEC-RC-003. El commit de código debe incluirlo antes del Contract Sync.

## Observaciones menores (no bloquean)
- `getResults` usa `completedAt ? ... : null` en el 200 (el tipo declara no nulo); solo ocurre si COMPLETED sin `completedAt`, caso no esperado; sin acción de texto.
- El texto lista cinco códigos nuevos en total (4 originales más `RETRIEVAL_COMPARISON_FAILED`); `ANALYSIS_NOT_FINISHED` y `UNSUPPORTED_PROJECT` ya existían en el enum.

## Checkpoints de contenido del Contract Sync a Console (WI-CONSOLE-014)
1. Rutas y roles: `POST /retrieval-comparisons` (Writer, `Idempotency-Key`, 202); `GET /retrieval-comparisons/{id}`, `/results` y `GET /analysis-runs/{id}/retrieval-comparisons?cursor&limit` (Reader, `Page<T>`).
2. DTOs y enums: `RetrievalMode`, `StructuralRelation`, `RetrievalComparisonStatus`, request/accepted/status/results/modo/candidato/métricas; `failureCode: string | null` abierto (conocidos `RETRIEVAL_TARGET_UNRESOLVABLE`, `RETRIEVAL_COMPARISON_FAILED`, `RETRIEVAL_COMPARISON_WORKER_LOST`); `metrics: null` sin `groundTruth`; sin ganador.
3. ErrorCode: `ANALYSIS_SYMBOL_NOT_FOUND` 404, `UNSUPPORTED_SYMBOL_KIND` 422, `RETRIEVAL_COMPARISON_NOT_FOUND` 404, `RETRIEVAL_COMPARISON_NOT_FINISHED` 409; más `403 PROJECT_ROLE_INSUFFICIENT` y los `400` de idempotencia (`IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_KEY_MISMATCH`) y `409 IDEMPOTENCY_CONFLICT`.
4. Tope `groundTruth` 200 (más o mal formado = `400`) y `pollAfterMs` del `202` para el polling.
5. DEC-RC-001: `409 ANALYSIS_NOT_FINISHED` (Run sin `projectVersionId`, solo en creación) y `422 UNSUPPORTED_PROJECT` (PHP; se retira con WI-CORE-028 solo en la comparación).
6. DEC-RC-003: `409 RETRIEVAL_COMPARISON_FAILED` en `/results` de una comparación FAILED (leer `failureCode`/`failureMessage` del status; no reintentar); `NOT_FINISHED` solo PENDING/RUNNING; `200` siempre SE y SEM.

## Texto propuesto para el evento (breaking=false)
changed: "INTEROP-2.7 §6.15 (comparación de retrieval OE2) implementada en Core (WI-CORE-022): POST/GET /retrieval-comparisons, /results y listado por AnalysisRun; resultados SE y SEM sin ganador; métricas P@k/R@k solo con groundTruth (hasta 200); failureCode abierto; nuevos ErrorCode ANALYSIS_SYMBOL_NOT_FOUND, UNSUPPORTED_SYMBOL_KIND, RETRIEVAL_COMPARISON_NOT_FOUND, RETRIEVAL_COMPARISON_NOT_FINISHED y RETRIEVAL_COMPARISON_FAILED; 409 ANALYSIS_NOT_FINISHED y 422 UNSUPPORTED_PROJECT (PHP) en la creación."
requiredAction (Console, WI-CONSOLE-014): "Implementar cliente y tipos según los 6 checkpoints; tratar failureCode como string abierto; limitar groundTruth a 200; manejar 409 RETRIEVAL_COMPARISON_FAILED leyendo el detalle del status sin reintentar, 409 NOT_FINISHED con polling por pollAfterMs, 409 ANALYSIS_NOT_FINISHED y 422 UNSUPPORTED_PROJECT con mensaje de UI propio."
