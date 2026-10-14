# Cierre — WI-CORE-061
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14 · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-068

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-061-independent-review.md` (agente `reviewer`, ciclo 1 de 2, APPROVED; hash idéntico a la base sin tiempos; mutantes principales detectados). Alcance aprobado por el usuario (mensaje directo). El usuario es informado y puede reabrirlo. No autoriza push ni despliegue.

## Qué entrega
Core conserva `startedAt`/`completedAt` opcionales por etapa de `stageDurations[]` (válidos ISO-8601 UTC; inválidos se omiten sin error) y los persiste de forma interna en `runnerReport.stageDurations` del artefacto de la repetición; Sandboxes anteriores sin los campos siguen funcionando y sus reportes y hashes no cambian. Sin migración, DTO público, §6.16, contrato canónico ni cambios en el Sandbox. Código `3f9e9d812f3d45d1779233994851b1a7a30a3481`. Criterio de verificación post-despliegue en `harness/reports/wi-core-061-technical-checks.md`.

## Contract Sync y decisiones pendientes
`CS-SANDBOX-20261014-001` (sourceRevision `19dfde456795c0a533d4823c25b546f3d372a970`, existente) **no se importó**: está en JSON sin `sourceWorkItem` y el importador de Core solo lee YAML con `sourceWorkItem`; no se fabricaron campos ni se tocó el Sandbox. Decisión pendiente: (a) el Sandbox republica en YAML con `sourceWorkItem: WI-SANDBOX-007`, o una transcripción autorizada; (b) por separado, incorporar los campos opcionales a INTEROP §7.3 (INTEROP-2.16, con contract-reviewer y Contract Sync a Console). Hallazgos menores en `IDEA-034`.
