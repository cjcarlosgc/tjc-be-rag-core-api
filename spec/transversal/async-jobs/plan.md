# async-jobs — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

POST 202 crea estado persistido antes de despachar. Prohibido fire-and-forget in-memory. Mecanismo durable PENDING: DB-backed queue vs broker. Workers idempotentes por operationId.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
