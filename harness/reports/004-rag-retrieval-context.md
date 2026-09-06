# Evidencia — 004-rag-retrieval-context

**Sprint:** Sprint 2 · **Historias:** HU08, HU09, HU10, HU11, HU12, HU19 (base de retrieval; no implica que esas HU estén completas) · **Estado:** DONE (esta feature)

## Contexto

`DEC-CHUNK-001` y `DEC-EMB-001` quedaron `APROBADO` en SDD 1.9. Esta feature implementa `RetrievalService` y `ContextBuilder` sobre el diseño de chunking jerárquico + oversized structured chunks ya construido en `002-project-version-indexing`.

## Cambios de código

- **Nuevo módulo `src/retrieval/`**: `RetrievalService`, `ContextBuilder`, tipos (`GenerationContext`, `RetrievalTarget`, `ContextChunk`), `RetrievalModule` (registrado en `AppModule`).
- **`CodeChunksRepository`**: nuevos métodos `findByProjectVersion`, `findBySymbol` (resuelve el/los chunk(s) — todas las partes ordenadas por `partIndex` — de un símbolo METHOD/FUNCTION exacto) y `findSimilarByEmbedding` (similitud coseno pgvector `<=>` contra un chunk ancla, filtrado por `projectVersionId`, excluyendo partes hermanas del mismo símbolo oversized).
- **`ProjectVersionsModule`**: exporta `CodeChunksRepository`/`TestTargetsRepository` para reuso desde `RetrievalModule`.
- **Retrieval estructural (V1, "principalmente imports")**: bidireccional y resuelto por chunk (no por archivo completo) usando el `importsUsed` ya calculado en 002 — `IMPORTS` (el target referencia un módulo relativo que resuelve a otro chunk) e `IMPORTED_BY` (otro chunk referencia, dentro de su propio contenido, un módulo relativo que resuelve al archivo del target).
- **`ContextBuilder`**: score = peso configurable × señal semántica + peso configurable × boost estructural (`RETRIEVAL_SEMANTIC_WEIGHT`/`RETRIEVAL_STRUCTURAL_WEIGHT`, default 0.7/0.3); filtra por `RETRIEVAL_MINIMUM_SCORE`, corta en `RETRIEVAL_TOP_K`, ajusta a `RETRIEVAL_MAX_CONTEXT_TOKENS` (best-effort: si un candidato no cabe, prueba el siguiente en vez de cortar la lista). El target siempre entra completo, sin pasar por el filtro de score/topK. Expone `retrievedChunks`/`selectedChunks`/`contextTokens` para las métricas explicativas de RAG que pedirá `008-experimental-comparison`.
- **Config nueva** (`env.validation.ts`, `.env`, `.env.example`): `RETRIEVAL_MINIMUM_SCORE`, `RETRIEVAL_TOP_K`, `RETRIEVAL_MAX_CONTEXT_TOKENS`, `RETRIEVAL_SEMANTIC_WEIGHT`, `RETRIEVAL_STRUCTURAL_WEIGHT`.
- **Error**: `UNRESOLVABLE_TARGET` (409, ya existía en `ErrorCode`) cuando no hay chunk indexado para el target solicitado.

## Fuera de alcance de esta feature

- No hay endpoint HTTP propio: `RetrievalService`/`ContextBuilder` son consumidos por `005-test-generation` (próxima feature), que aún no existe.
- No se implementa `DEC-RAG-001` (señal test-aware): sigue `PENDING`, investigación pospuesta a después del núcleo de Sprint 2 según su propio texto.
- Índice HNSW definitivo para el vector query: no reintroducido en esta migración (la consulta funciona por table scan + `ORDER BY <=>`, aceptable en el volumen de datos de V1); queda como tarea abierta en `002/tasks.md`.

## Verificación

- `pnpm lint` → OK.
- `pnpm test` → 80/80 (11 nuevas: `retrieval.service.spec.ts` 6, `context-builder.service.spec.ts` 5).
- `pnpm test:e2e` → 7/7 OK (sin cambios funcionales visibles vía HTTP todavía; confirma que el nuevo módulo no rompe el arranque de la app).
- `pnpm build` → OK.
- `npx tsc --noEmit` → sin errores nuevos (los 5 preexistentes en `zip-validation.service.spec.ts`/`projects.service.spec.ts` no están relacionados con este cambio).
