# Dependencias cruzadas — WI-CORE-003

**Fecha:** 2026-09-25
**Resultado:** Core queda planificado y no seleccionable hasta completar los cuatro cortes funcionales locales de GitHub Integration.

## Hallazgo

La secuencia previa esperaba solo `WI-GH-002`, aunque ese WI cubría únicamente acceso a repositorio. Discovery, lecturas del PR, Checks/publicación y webhooks aún no tenían subtarea/WI dueño. Además, `dependsOn` del Harness solo valida WIs del registro local; una condición escrita en `plan.md` no bloqueaba por sí sola la selección.

## Corrección

- GitHub Integration registra `WI-GH-002` a `WI-GH-005`, con sus `ST-GH-*`, rutas cubiertas y Contract Sync de salida.
- `WI-CORE-003` vuelve de `W-SELECTED` a `W-PLANNED`; se limpia `activeWorkItem` y `ST-CORE-003` queda `T-BACKLOGGED`.
- El registro de Core enumera las dependencias GH como `externalDependencies`, incluyendo estado requerido y necesidad de Contract Sync importado/resuelto.
- La comprobación cruzada sigue siendo manual: este Harness no consulta otro repo. Antes de seleccionar Core se inspeccionarán WIs/reportes fuente y se ejecutará el checkpoint Contract Sync local.

## Evidencia

- Revisión de cobertura del plan `WI-GH-002` frente a `GH-INTEROP-1.0`.
- Validación local al aplicar el cambio: `node scripts/sdd-check.mjs`, `node harness/validate-harness.mjs` y Contract Sync `start` se ejecutan solo tras seleccionar un WI activo.

La revisión/aprobación contractual de `GH-INTEROP-1.0` permanece vigente. Este reporte no aprueba implementación ni cierre de `WI-CORE-003`.
