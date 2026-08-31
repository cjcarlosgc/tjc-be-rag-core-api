# observability — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Structured logs con correlationId, operationId, projectVersionId/runId; métricas de duración por etapa. Redactar secrets/tokens.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
