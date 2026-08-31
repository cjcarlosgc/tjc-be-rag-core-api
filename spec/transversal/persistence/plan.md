# persistence — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Prisma para relacional; pgvector mediante TypedSQL/raw SQL. Transacciones para captura de currentVersion y cambios de estado críticos.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
