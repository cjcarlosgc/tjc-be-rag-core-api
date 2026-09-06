# 002-project-version-indexing — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/transversal/providers/` para el modelo de embeddings definitivo (`DEC-EMB-001`, APROBADO).

## Diseño técnico

Pipeline asíncrono durable. Primero se persiste el snapshot en `repositories/{projectId}/versions/{projectVersionId}/original.zip` con `upsert=false`; el workspace temporal siempre se limpia. La base conserva la key interna, no URLs firmadas.

Responsabilidades implementadas:

- `FileDiscoveryService`: pool/ignore list y rutas relativas normalizadas.
- `TypeScriptParserService`: parsing ts-morph y chunks por declaración top-level, con fallback `FILE`.
- `TestTargetExtractorService`: inventario `CLASS|METHOD|FUNCTION` sobre archivos de producción.
- `ExistingTestResolverService`: relación heurística entre targets y archivos Jest/Vitest existentes.
- `EmbeddingProvider`: embeddings batch, sin filtrar tipos del proveedor al pipeline.
- `CodeChunksRepository` y `TestTargetsRepository`: persistencia separada.
- `IndexingJobHandler`: estados, orquestación, consistencia terminal y cleanup.

`DEC-CHUNK-001` y `DEC-EMB-001` quedaron `APROBADO` (ver `spec.md` y `spec/transversal/providers/spec.md`): modelo `text-embedding-3-small` (1536 dimensiones) y diseño de chunking jerárquico + oversized structured chunks. La implementación actual (IDs nuevos por reindexación, estimación heurística de tokens, chunk único por declaración top-level) debe refinarse para: (a) generar chunks hijos por método/constructor con `parentSymbolName`, (b) dividir declaraciones que superen `maxChunkTokens` en partes ordenadas sin overlap, (c) agregar `importsUsed`, (d) calcular `tokenCount` real con tokenizer en vez de heurística. pgvector siempre se consulta filtrando por `projectVersionId`.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
