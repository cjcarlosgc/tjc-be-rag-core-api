# async-jobs — Tareas

- [x] Seleccionar mecanismo durable (cola DB-backed en PostgreSQL de Supabase).
- [x] Job dispatcher/worker (`JobsService`, polling con `SELECT ... FOR UPDATE SKIP LOCKED`).
- [x] Idempotencia/retry/backoff (`operationId` = `projectVersionId`; backoff exponencial acotado).
- [x] Recuperación tras restart (estado persistido en `jobs`/`project_versions`; el poller retoma trabajo `PENDING` al reiniciar).

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
