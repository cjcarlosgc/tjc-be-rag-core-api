# 008-experimental-comparison — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

`ExperimentRun` agrupa `baselineRuns[]` y `ragRuns[]`. Reutilizar TestGenerationRun/pipeline productivo con `GenerationStrategy`. La única divergencia funcional ocurre en `TestContextStrategy`. Persistir configuración experimental para reproducibilidad.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
