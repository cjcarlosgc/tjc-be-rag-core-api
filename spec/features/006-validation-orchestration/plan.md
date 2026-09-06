# 006-validation-orchestration — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/contracts/system-contract.md`, donde `DEC-INT-001` está aprobado.
- `spec/contracts/interoperability-contract.md` para el transporte Core↔Sandbox.

## Diseño técnico

`TestExecutionService -> SandboxExecutionService -> HTTP tjc-be-test-execution-sandbox`. Implementar `202 + polling` e idempotencia conforme a `INTEROP-1.0`; mapear `SandboxExecutionResultResponse` a `TestValidationResult` sin perder evidence IDs/log refs.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
