# 002-project-version-indexing — Tareas

- [x] DTO/endpoint 202 y polling (`POST /projects/index`, `GET /project-versions/:id`).
- [x] ZIP validation/extracción segura (tamaño/extensión/MIME, Zip Slip, cleanup garantizado).
- [x] ProjectVersion y estados (`PENDING..COMPLETED|FAILED`).
- [x] Parsers y file discovery (pool V1, ignore list, ts-morph).
- [x] Chunking + metadata (por declaración top-level, fallback a archivo completo).
- [x] EmbeddingProvider.embedMany (OpenAI, batched).
- [x] Persistencia pgvector (`Unsupported("vector")` + SQL crudo, índice HNSW).
- [x] Result summary y cleanup (`GET /project-versions/:id/results`, workspace temporal siempre limpiado).
- [x] Resolver mecanismo durable de jobs antes de worker productivo.

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
