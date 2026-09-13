# async-jobs — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Garantizar que indexaciones y generaciones sobrevivan al ciclo HTTP y reinicios razonables.

## Reglas y comportamiento

- Indexación, generación, experimento y validación sobreviven al request HTTP mediante la cola DB-backed aprobada.
- Toda aceptación devuelve `202`, identidad estable y `pollAfterMs` según `INTEROP-2.0`.
- Los handlers son idempotentes frente a reintentos y los estados terminales permanecen consultables.
- `POST /test-runs`, `POST /experiments` y el POST de retry reservan `Idempotency-Key` + huella canónica bajo unicidad y crean el recurso/job de forma atómica o recuperable. Un replay equivalente no agenda trabajo adicional.
- Los jobs que hacen fan-out derivan UUID v5 por unidad lógica para Sandbox y los conservan durante cualquier retry.
- Los resultados detallados se consultan por una ruta separada y antes de terminar responden `409 *_NOT_FINISHED`.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.

## Cierre de la brecha de implementación SDD 1.14

Resuelto en SDD 1.15. `JobsService.enqueue`/`JobsRepository.create` aceptan un `Prisma.TransactionClient` opcional, permitiendo encolar el job dentro de la misma transacción que crea el recurso y el `IdempotencyRecord` (`IdempotencyService`). `TestGenerationJobHandler`, `ExperimentJobHandler` y `RetryTargetJobHandler` derivan y reutilizan las identidades hijas UUID v5 exactas de `DEC-IDEMP-001` (namespace `6ba7b811-9dad-11d1-80b4-00c04fd430c8`, `sandboxGenerationRequestId`/`sandboxExperimentRequestId`/`sandboxManualRetryRequestId`) a partir del `jobId` (segundo parámetro de `JobHandler.handle`, estable entre reintentos internos del mismo job).
