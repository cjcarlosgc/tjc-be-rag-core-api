# 002-project-version-indexing — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/transversal/providers/` para el default provisional y `DEC-EMB-001`.

## Diseño técnico

Pipeline asíncrono durable. Snapshot `source.zip` primero; workspace temporal siempre limpiado.

Responsabilidades implementadas:

- `FileDiscoveryService`: pool/ignore list y rutas relativas normalizadas.
- `TypeScriptParserService`: parsing ts-morph y chunks por declaración top-level, con fallback `FILE`.
- `TestTargetExtractorService`: inventario `CLASS|METHOD|FUNCTION` sobre archivos de producción.
- `ExistingTestResolverService`: relación heurística entre targets y archivos Jest/Vitest existentes.
- `EmbeddingProvider`: embeddings batch, sin filtrar tipos del proveedor al pipeline.
- `CodeChunksRepository` y `TestTargetsRepository`: persistencia separada.
- `IndexingJobHandler`: estados, orquestación, consistencia terminal y cleanup.

La implementación actual usa IDs nuevos al persistir cada conjunto de chunks, estima tokens aproximadamente y almacena un vector de 1536 dimensiones por compatibilidad con el default provisional existente. `DEC-CHUNK-001` y `DEC-EMB-001` deben resolverse antes de convertir esas elecciones provisionales en el contrato definitivo de retrieval. pgvector siempre se consulta filtrando por `projectVersionId`.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
