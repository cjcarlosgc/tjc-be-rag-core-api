# 009-history-realtime-repair — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Agregar gateway/event publisher desacoplado del dominio para el progreso en tiempo real (HU21/HU22). Sin mecanismo de autorreparación: una ejecución en el Sandbox por generación, sin loops de corrección automática (ver spec.md). HU24 (reintento manual) reutiliza el pipeline de generación de un solo target (mismo retrieval/prompt/merge/Sandbox que el primer intento) en un handler dedicado que actualiza el resultado/artefacto existente en vez de crear filas nuevas.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
