# providers — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Interfaces `LLMProvider.generate` y `EmbeddingProvider.embedMany`. Model IDs/config desde env. Registrar provider/model version y dimensionalidad efectiva en runs experimentales.

La implementación existente de OpenAI, el default `text-embedding-3-small` y la columna `vector(1536)` se consideran materialización provisional, no cierre de `DEC-EMB-001`. Si la decisión final cambia de modelo o dimensión, el plan debe incluir adaptador, migración de esquema, reindexación y pruebas de compatibilidad; no se realiza ese cambio en este corte SDD.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
