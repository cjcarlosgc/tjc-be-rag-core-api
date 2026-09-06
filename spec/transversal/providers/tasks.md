# providers — Tareas

- [x] Interfaces (`EmbeddingProvider.embedMany`).
- [x] OpenAI implementations iniciales (`OpenAiEmbeddingProvider`, cliente lazy, batching).
- [x] `DEC-EMB-001` ya resuelta (`APROBADO`: `text-embedding-3-small`, 1536); consulta vectorial definitiva de `004-rag-retrieval-context` implementada bajo ese modelo (`CodeChunksRepository.findSimilarByEmbedding`, cosine `<=>`).
- [ ] Si una reevaluación futura con evidencia del experimento cambiara modelo/dimensionalidad, planificar y ejecutar adaptador, migración pgvector y reindexación; no hacerlo por inferencia.
- [x] Timeouts/retry policy (`createOpenAiClient`, compartido por `OpenAiEmbeddingProvider`/`OpenAiLLMProvider`/`GeneralistAgentService`: `OPENAI_TIMEOUT_MS`, `OPENAI_MAX_RETRIES`).
- [x] Usage metadata (`OpenAiEmbeddingProvider` loguea `usage.total_tokens` por batch; `OpenAiLLMProvider`/`GeneralistAgentService` devuelven `inputTokens`/`outputTokens` ya consumidos por 005/008 para métricas de costo).

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
