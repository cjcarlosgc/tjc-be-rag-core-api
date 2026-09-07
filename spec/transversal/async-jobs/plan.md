# async-jobs — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

POST 202 crea estado persistido antes de despachar. Prohibido fire-and-forget in-memory. Mecanismo durable: cola DB-backed en PostgreSQL de Supabase (tabla `jobs`), despacho con `SELECT ... FOR UPDATE SKIP LOCKED`. Workers idempotentes por operationId (p. ej. `projectVersionId`). Para generación, experimento y retry, la misma transacción crea el recurso, reserva `IdempotencyRecord` y crea el job; el UUID primario del job participa en el nombre canónico UUID v5 de cada subejecución Sandbox.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
