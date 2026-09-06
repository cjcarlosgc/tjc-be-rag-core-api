# providers — Tareas

- [x] Interfaces (`EmbeddingProvider.embedMany`).
- [x] OpenAI implementations iniciales (`OpenAiEmbeddingProvider`, cliente lazy, batching).
- [ ] Resolver `DEC-EMB-001` antes de implementar definitivamente la consulta vectorial de `004-rag-retrieval-context`.
- [ ] Si cambia modelo/dimensionalidad, planificar y ejecutar adaptador, migración pgvector y reindexación; no hacerlo por inferencia.
- [ ] Timeouts/retry policy.
- [ ] Usage metadata.

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
