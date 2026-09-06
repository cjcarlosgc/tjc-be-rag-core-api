# 005-test-generation — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/contracts/interoperability-contract.md` para rutas, DTOs y estados externos.

## Diseño técnico

`GapAnalyzer` resuelve targets. `PromptBuilder` común. Cada target: retrieval/context -> generation -> validation. Estados globales PENDING, RESOLVING_TARGETS, PROCESSING_TARGETS, BATCH_VALIDATING, FINALIZING, COMPLETED|PARTIAL|FAILED.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
