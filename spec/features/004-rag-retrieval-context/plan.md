# 004-rag-retrieval-context — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/features/002-project-version-indexing/spec.md` para `DEC-CHUNK-001` y el contrato vigente de chunks.
- `spec/transversal/providers/spec.md` para `DEC-EMB-001`.

## Diseño técnico

`RetrievalService` obtiene candidatos mediante señales semánticas y estructurales; vector query usa pgvector cosine. `ContextBuilder` aplica selección, deduplicación, orden, etiquetas y presupuesto. Para HU27 debe producir además una decisión auditable por candidato, sin cambiar el `GenerationContext` consumido por el prompt; `011-context-traces` es propietario de su persistencia y transporte.

`DEC-EMB-001` y `DEC-CHUNK-001` quedaron `APROBADO` (ver `spec/transversal/providers/spec.md` y `spec/features/002-project-version-indexing/spec.md`): modelo `text-embedding-3-small`/1536 dimensiones y diseño de chunking jerárquico + oversized structured chunks con `maxChunkTokens` configurable. `ContextBuilder` debe soportar expansión dinámica a partes vecinas (`partIndex`/`partsTotal`) de un chunk oversized cuando lo necesite. `DEC-RAG-001` no bloquea esta base: prohíbe únicamente añadir silenciosamente una señal test-aware sin su investigación y aprobación.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
