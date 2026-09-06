# providers — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Interfaces `LLMProvider.generate` y `EmbeddingProvider.embedMany`. Model IDs/config desde env. Registrar provider/model version y dimensionalidad efectiva en runs experimentales.

La implementación existente de OpenAI, `text-embedding-3-small` y la columna `vector(1536)` son ahora la materialización del modelo definitivo (`DEC-EMB-001`, APROBADO); no requieren migración de modelo/dimensión. Si en el futuro una reevaluación con evidencia del experimento cambiara el modelo (ej. `voyage-code-4`), esa nueva decisión debería incluir adaptador, migración de esquema, reindexación y pruebas de compatibilidad.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
