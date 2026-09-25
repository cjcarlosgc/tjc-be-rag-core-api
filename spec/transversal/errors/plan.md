# errors — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

El envelope y los códigos públicos vigentes pertenecen a `spec/contracts/interoperability-contract.md`. Los errores de snapshot interno se clasifican como fallos de materialización, integridad, Storage o Sandbox; no existe validación HTTP de un ZIP suministrado por el usuario ni una API de descarga de artefactos legacy.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
