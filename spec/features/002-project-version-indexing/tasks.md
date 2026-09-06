# 002-project-version-indexing — Tareas

- [x] DTO/endpoint 202 y polling (`POST /projects/index`, `GET /project-versions/:id`).
- [x] ZIP validation/extracción segura (tamaño/extensión/MIME, Zip Slip, cleanup garantizado).
- [x] ProjectVersion y estados (`PENDING..COMPLETED|FAILED`).
- [x] Parsers y file discovery (pool V1, ignore list, ts-morph).
- [x] Chunking jerárquico + metadata (`CLASS` completo + hijos `METHOD`/`CONSTRUCTOR` con `parentSymbolName`, fallback a archivo completo).
- [x] EmbeddingProvider.embedMany (OpenAI, batched).
- [x] Persistencia pgvector (`Unsupported("vector(1536)")` + SQL crudo) con el modelo definitivo (`DEC-EMB-001`).
- [ ] Reintroducir/ajustar el índice vectorial definitivo (HNSW); la migración vigente lo retiró y `004-rag-retrieval-context` por ahora consulta sin índice ANN dedicado (aceptable en el volumen de datos de V1).
- [x] Refinar chunking conforme a `DEC-CHUNK-001` (APROBADO): chunks hijos `METHOD`/`CONSTRUCTOR` con `parentSymbolName` dentro de cada `CLASS`.
- [x] Implementar "oversized structured chunks": dividir declaraciones que superen `maxChunkTokens` (parámetro configurable, default 1500) en partes ordenadas (`partIndex`/`partsTotal`) sin solapamiento textual, conservando identidad de símbolo y metadata de adyacencia.
- [x] Agregar metadata `importsUsed` a cada chunk.
- [x] Sustituir la estimación heurística de `tokenCount` por un conteo real con el tokenizer del modelo de embeddings vigente (`gpt-tokenizer`, encoding `cl100k_base`).
- [ ] Reindexar chunks de `ProjectVersion` ya existentes bajo el nuevo diseño (si hay datos de demo que el usuario quiera conservar coherentes); no bloquea `004`, que opera correctamente sobre versiones nuevas.
- [x] Result summary y cleanup (`GET /project-versions/:id/results`, workspace temporal siempre limpiado).
- [x] Resolver mecanismo durable de jobs antes de worker productivo.

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
