# async-jobs — Especificación

**Estado:** vigente para jobs del flujo PR-driven; adapters legacy se retiran en WI-CORE-002.
**Historias:** capacidad técnica transversal

## Objetivo

Garantizar que indexación, generación, validación y experimentos ligados a `AnalysisRun` sobrevivan al ciclo HTTP y reinicios razonables.

## Reglas y comportamiento

- Indexación, generación, experimento y validación sobreviven al request HTTP mediante la cola DB-backed aprobada.
- Las operaciones asíncronas expuestas responden según `INTEROP-2.6`, con identidad estable y `pollAfterMs` cuando el contrato lo declara.
- Los handlers son idempotentes frente a reintentos y los estados terminales permanecen consultables.
- `POST /experiments` y las demás operaciones que el contrato vigente declara idempotentes reservan `Idempotency-Key` y huella canónica bajo unicidad; recurso y job se crean atómicamente o de modo recuperable. Un replay equivalente no agenda trabajo adicional.
- Los jobs que hacen fan-out derivan UUID v5 por unidad lógica para Sandbox y los conservan durante cualquier retry.
- **Recuperación de locks vencidos (`DEC-JOBS-001`, `DEC-JOBS-002`, `WI-CORE-030`):** el worker renueva `lockedAt` mientras el handler corre (latido de job, `JOBS_HEARTBEAT_INTERVAL_MS`, ≤ `JOBS_STALE_LOCK_MS/3`) y `complete/fail/reschedule` solo escriben si `lockedBy` sigue siendo ese worker. `releaseStale` libera los `RUNNING` con latido vencido de los jobs con `dedupeKey` y de una lista cerrada de tipos sin clave, hoy `experiment-run` y, por enmienda de `DEC-RC-002` (2026-10-09, `WI-CORE-022`), `retrieval-comparison` (solo lectura e idempotente); no se liberan `snapshot-analysis`, `functional-continuation`, `analysis-run-validation` ni `test-publication` (gates de estado, costo LLM o escrituras externas; recuperación por entidad: `IDEA-011`). Cada liberación consume un intento y respeta `JOBS_MAX_ATTEMPTS`; al agotarlos, el handler del tipo cierra su entidad (`ExperimentRun` queda `FAILED` con `failureCode` `EXPERIMENT_WORKER_LOST`).
- Los resultados detallados se consultan por una ruta separada y antes de terminar responden `409 *_NOT_FINISHED`.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.

`JobsService.enqueue`/`JobsRepository.create` aceptan un `Prisma.TransactionClient` opcional para encolar en la misma transacción que crea recurso e `IdempotencyRecord`. La identidad hija UUID v5 de Sandbox se deriva del job durable y de la unidad lógica; los handlers exclusivos del flujo manual se retiran en WI-CORE-002 después de inventariar datos.
