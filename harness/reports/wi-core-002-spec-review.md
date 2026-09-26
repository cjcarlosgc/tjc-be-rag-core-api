# Revisión pre-tarea — WI-CORE-002

Fecha: 2026-09-24. Estado inicial revisado: `W-SELECTED`; Contract Sync `start` vigente.

## Alcance y aceptación

- Core no expone una ruta activa de carga manual de código ni de descarga de artefactos legacy. El ZIP que `analysis-run-validation-job.handler.ts` crea desde el snapshot PR-driven y entrega a Docker/Sandbox se conserva.
- Se retiran únicamente códigos de error sin consumidores vinculados a las superficies manuales: `ZIP_REQUIRED`, `ARTIFACT_NOT_FOUND`, `ZIP_TOO_LARGE`, `GENERATION_FAILED` y `ARTIFACT_PERSISTENCE_FAILED`. Se conservan `INVALID_ZIP` (extracción interna) e `INVALID_GENERATION_TARGET` (experimentos).
- No se migran ni purgan filas, objetos, snapshots, versiones, propuestas o evidencia. La comprobación de endpoints no encontró operaciones manuales en `app/src`.
- No se cambia SYSTEM/INTEROP: los DTOs de versiones, inventario, experimentos, Sandbox y propuestas PR-driven permanecen vigentes.

## Decisiones y riesgos

`DEC-INF-001` (infraestructura remota), `DEC-VAL-001` (ingestión/despliegue de código empresarial) y `DEC-EXP-FK-001` (experimentos con Functional Knowledge) siguen `PENDING`; sus campos `Blocks` no alcanzan este corte. No hay decisión bloqueante. Riesgo de datos: cualquier limpieza persistida requeriría inventario y respaldo separado, fuera de este WI.

## Resultado

Spec revisada contra `spec/features/013-pr-driven-analysis/{spec,plan,tasks}.md`, SYSTEM-2.4 e INTEROP-2.4. La clasificación Contract Sync está anclada por digest en `harness/state.json` y explicada en `harness/reports/contract-sync-relevance-wi002-3.0.md`. El gate SDD y el gate de decisiones pasan; el usuario ya aprobó este alcance en la conversación.
