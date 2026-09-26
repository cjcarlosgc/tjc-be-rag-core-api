# Implementación — WI-CORE-009

Fecha: 2026-09-25. Estado: listo para revisión independiente del usuario; no cerrado.

## Alcance ejecutado

- El Harness valida dependencias externas, reporte de atestación, revisiones fuente, inventario de Contract Sync, destino, payload importado y evidencia local. Mientras el gate externo no pase, bloquea la promoción del WI consumidor.
- Contract Sync distingue `C-ACKNOWLEDGED` (aceptar y asignar la obligación) de `C-RESOLVED` (acción implementada con evidencia). Se añadieron `acknowledge`/`resolve`, checkpoints con la semántica correspondiente e import idempotente que preserva el estado local si el payload de origen no cambió.
- El endurecimiento posterior a auditoría impide importar eventos namespaced con estado/evidencia del consumidor premarcados, impide resolver antes de `implementationCompleted: G-PASSED` y su reporte registrado, y evita reemplazar evidencia al repetir transiciones.
- Las dependencias locales incompletas ahora bloquean `W-READY` y fases ejecutables posteriores; `W-BLOCKED`/`W-CANCELLED` permiten conservar explícitamente el estado de espera o descarte.
- La verificación entre repositorios sigue siendo manual y auditable; el Harness no consulta repositorios remotos ni declara que una entrega externa exista por sí sola.
- `WI-CORE-003` permanece `W-PLANNED`. No se modificó código de Console ni Sandbox.

## Evidencia técnica

- `cd app && pnpm lint`: pasa.
- `cd app && pnpm test`: 91 archivos pasan, 1 omitido; 1,131 tests pasan, 36 omitidos.
- `cd app && pnpm build`: pasa.
- `node scripts/sdd-check.mjs`: `SDD check OK`.
- `node harness/validate-work-items.mjs`: pasa (9 WI CORE).
- `node harness/validate-harness.mjs`: `Harness V3 validation passed`.
- Pruebas focalizadas del gate externo, ciclo de vida Contract Sync, CLI y dependencias locales: 11 pasan.
- `git diff --check`: pasa.
- Contract Sync `start`, `implementation-delivery` y `before-review`: sin eventos relevantes pendientes; los dos eventos históricos no aplicables constan con digest y reporte por WI.

Un agente auditó los cuatro hallazgos técnicos, confirmó que están cubiertos con pruebas y recomendó exigir además la referencia de evidencia del gate de implementación; ese requisito adicional también se incorporó y probó. Esta auditoría no es la revisión independiente final. La aprobación del usuario queda pendiente; por ello `independentReviewPassed` permanece `G-NOT_RUN`, la subtarea sigue `T-IN_PROGRESS` y no se ha hecho `before-done` ni se declara el WI terminado.
