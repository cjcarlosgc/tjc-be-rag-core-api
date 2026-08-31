# 004-rag-retrieval-context — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

`RetrievalService` obtiene candidatos; vector query usa pgvector cosine; `ContextBuilder` aplica presupuesto. Trazar score y chunks seleccionados para experimento/UX. `BaselineContextStrategy` NO usa este retrieval.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
