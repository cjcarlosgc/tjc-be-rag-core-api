# 003-test-inventory — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

El parser AST alimenta `TestInventory`. Persistir totales y relaciones suficientes para `CLASS_MISSING` y `PROJECT_MISSING`.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
