# providers — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Interfaces `LLMProvider.generate` y `EmbeddingProvider.embedMany`. Model IDs/config desde env. Registrar provider/model version en runs experimentales.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
