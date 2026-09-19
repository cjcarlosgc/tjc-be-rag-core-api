# 004-rag-retrieval-context — Tareas

- [x] `DEC-CHUNK-001` y `DEC-EMB-001` ya resueltas (`APROBADO`); retrieval/contexto implementado conforme a ese diseño (`RetrievalService`/`ContextBuilder`, `src/retrieval/`).
- [x] Structural retrieval por imports (bidireccional: `IMPORTS`/`IMPORTED_BY`, resuelto por chunk vía `importsUsed`).
- [x] Vector query filtrada por projectVersionId (`CodeChunksRepository.findSimilarByEmbedding`, cosine `<=>`, excluye partes hermanas del propio target).
- [x] Score/dedupe/config (`ContextBuilder`: peso semántico/estructural configurable, dedupe por chunk id, `minimumScore`/`topK`).
- [x] Token budget (`maxContextTokens`, best-effort fill respetando el orden de score).
- [x] GenerationContext y trazabilidad (`target`, `relatedChunks` con `matchedVia`, `metadata`, `retrievedChunks`/`selectedChunks`/`contextTokens` para métricas experimentales de 008).
- [ ] Exponer a `011-context-traces` la decisión completa de cada candidato, incluidos los descartes por mínimo, top-K y token budget (HU27; no cubierto por las métricas agregadas existentes).
- [x] Pruebas de aislamiento entre versiones (`findSimilarByEmbedding`/`findByProjectVersion` siempre filtran por `projectVersionId`; ver `retrieval.service.spec.ts`).
- [ ] Investigar `DEC-RAG-001` después del núcleo de Sprint 2; no implementar test-aware mientras permanezca PENDING.

## Calidad

- [x] Agregar/actualizar pruebas (`retrieval.service.spec.ts`, `context-builder.service.spec.ts`).
- [x] Verificar manejo de errores (`UNRESOLVABLE_TARGET` cuando no hay chunk indexado para el target).
- [x] Verificar observabilidad mínima (hereda correlación/logging del pipeline; sin logging propio adicional necesario en esta capa).
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/` (`004-rag-retrieval-context.md`).
