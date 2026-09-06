# 004-rag-retrieval-context — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/features/002-project-version-indexing/spec.md` para `DEC-CHUNK-001` y el contrato vigente de chunks.
- `spec/transversal/providers/spec.md` para `DEC-EMB-001`.

## Diseño técnico

`RetrievalService` obtiene candidatos mediante señales semánticas y estructurales; vector query usa pgvector cosine. `ContextBuilder` aplica selección, deduplicación, orden, etiquetas y presupuesto. Trazar score, procedencia/señales y chunks seleccionados para experimento/UX.

Antes de implementar la consulta semántica y consolidar el contrato de contexto deben resolverse `DEC-EMB-001` y `DEC-CHUNK-001`. `DEC-RAG-001` no bloquea esta base: prohíbe únicamente añadir silenciosamente una señal test-aware sin su investigación y aprobación.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
