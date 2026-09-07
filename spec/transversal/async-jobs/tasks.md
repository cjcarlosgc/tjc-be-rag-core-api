# async-jobs — Tareas

- [x] Seleccionar mecanismo durable (cola DB-backed en PostgreSQL de Supabase).
- [x] Job dispatcher/worker (`JobsService`, polling con `SELECT ... FOR UPDATE SKIP LOCKED`).
- [x] Idempotencia/retry/backoff (`operationId` = `projectVersionId`; backoff exponencial acotado).
- [x] Recuperación tras restart (estado persistido en `jobs`/`project_versions`; el poller retoma trabajo `PENDING` al reiniciar).
- [x] Permitir encolar dentro de la misma transacción que crea recurso + `IdempotencyRecord`, retornando el `jobId` durable al caller interno (`JobsService.enqueue(type, payload, tx?)`).
- [x] Derivar y probar los UUID v5 Sandbox con namespace/nombres exactos de `DEC-IDEMP-001`; el retry del job debe reutilizarlos (`sandbox-request-id.util.ts`, derivado del `jobId` estable pasado por `JobsService.runOnce` a `handler.handle(payload, jobId)`).

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
