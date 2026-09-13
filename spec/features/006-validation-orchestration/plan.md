# 006-validation-orchestration — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/contracts/system-contract.md`, donde `DEC-INT-001` está aprobado.
- `spec/contracts/interoperability-contract.md` para el transporte Core↔Sandbox.

## Diseño técnico

`TestExecutionService -> ObjectStorageService.presignGet -> SandboxExecutionService -> HTTP tjc-be-test-execution-sandbox`. Mantener `202 + polling`, Bearer e idempotencia conforme a `INTEROP-2.0`; enviar referencias de descarga efímeras verificables, mapear `SandboxExecutionResultResponse` y persistirlo en Core sin signed URLs. El adapter deriva una identidad UUID v5 por unidad lógica y reutiliza ese valor en `requestId`/`Idempotency-Key` durante retries.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
