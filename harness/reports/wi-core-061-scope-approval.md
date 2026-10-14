# WI-CORE-061 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (mensaje directo): «importar CS-SANDBOX-20261014-001 y leer y persistir de forma aditiva e interna los startedAt/completedAt por etapa del Sandbox, sin cambiar DTO público ni contrato; sin push ni despliegue sin mi orden».

## Evento de origen
`CS-SANDBOX-20261014-001` (Sandbox `WI-SANDBOX-007`, `sourceRevision` `19dfde456795c0a533d4823c25b546f3d372a970`, existente en el historial del Sandbox; aditivo, `breaking: false`): `StageDuration` (INTEROP §7.3) gana `startedAt` y `completedAt` opcionales (ISO-8601 UTC) por etapa, junto a `durationMs` sin cambio. El Sandbox emite los campos desde ese commit una vez desplegado.

## Estado del import (Contract Sync)
El evento está en el outbox del Sandbox en **JSON** (formato anterior, sin `sourceWorkItem`); el `import` de Core solo lee YAML con `sourceWorkItem` y namespace válido, y no se puede fabricar ese campo ni modificar el repositorio del Sandbox. **No se importó**: ver el reporte del WI y la decisión pendiente (el Sandbox republica en YAML con `sourceWorkItem`, o una transcripción autorizada). El cambio de código es tolerante (los campos son opcionales y una versión anterior del Sandbox no los envía).

## Alcance
Ampliar el tipo (`sandbox.types.ts` `StageDuration`) y la lectura (`sandbox-execution.service.ts` `fetchResult`) para conservar `startedAt`/`completedAt` por etapa en `stageDurations[]` (tolerando Sandboxes sin los campos y valores inválidos) y persistirlos de forma aditiva e interna dentro de `runnerReport.stageDurations` de `experiment_repetition_artifacts` (JSON existente, sin migración). Sin DTO público, §6.16, contrato canónico ni cambios en el Sandbox; la incorporación documental a INTEROP §7.3 queda para una decisión aparte con contract-reviewer.
