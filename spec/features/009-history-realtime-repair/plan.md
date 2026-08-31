# 009-history-realtime-repair — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Agregar gateway/event publisher desacoplado del dominio. `RepairService` separado del generation first-shot. Mantener attempts persistidos y evitar loops ilimitados.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
