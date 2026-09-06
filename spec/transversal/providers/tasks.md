# providers — Tareas

- [x] Interfaces (`EmbeddingProvider.embedMany`).
- [x] OpenAI implementations iniciales (`OpenAiEmbeddingProvider`, cliente lazy, batching).
- [ ] `DEC-EMB-001` ya resuelta (`APROBADO`: `text-embedding-3-small`, 1536); implementar definitivamente la consulta vectorial de `004-rag-retrieval-context` bajo ese modelo.
- [ ] Si una reevaluación futura con evidencia del experimento cambiara modelo/dimensionalidad, planificar y ejecutar adaptador, migración pgvector y reindexación; no hacerlo por inferencia.
- [ ] Timeouts/retry policy.
- [ ] Usage metadata.

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
