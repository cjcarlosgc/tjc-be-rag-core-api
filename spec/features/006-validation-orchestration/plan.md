# 006-validation-orchestration — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

`TestExecutionService -> SandboxExecutionService -> HTTP tjc-be-test-execution-sandbox`. Mapear `TestRunnerResult` a `TestValidationResult` sin perder evidence IDs/log refs.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
