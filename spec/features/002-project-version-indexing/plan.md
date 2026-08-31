# 002-project-version-indexing — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Pipeline asíncrono durable. Parsers separados: TypeScriptParserService, PackageJsonParserService, TsConfigParserService, TestConfigParserService. Snapshot `source.zip` primero; workspace temporal siempre limpiado. Chunking estructural y embeddings batch. pgvector filtrado por projectVersionId.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
