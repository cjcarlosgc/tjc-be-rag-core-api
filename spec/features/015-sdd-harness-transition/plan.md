# 015 — Plan de transición Core

1. Alinear backlog, casos, nomenclatura y roadmap con el alcance aprobado.
2. Hacer comprobable la relación subtarea↔work item y corregir validadores heredados.
3. Retirar rutas de producto y código ZIP/artefactos obsoletos por corte seguro, con inventario de datos previo.
4. Trasladar la implementación a GitHub Integration bajo contrato aprobado y WIs locales; el código fuente migrado está en su fase de verificación/cierre.
5. Registrar evidencia, revisión independiente y Contract Sync en los cuatro checkpoints; no publicar sin pedido explícito.

## Corte P1 — frontera GitHub Integration (WI-CORE-003)

- El contrato privado aprobado está en [`spec/contracts/github-integration-contract.md`](../../contracts/github-integration-contract.md). Su aprobación fijó el diseño; `WI-GH-002`–`WI-GH-005` y `WI-CORE-003` migraron las fuentes, y Core mantiene sus gates hasta la revisión humana final.
- Las capacidades migradas son discovery y acceso App/org; ramas y lectura compare/tree/contenidos por SHA; Checks; Git Data/companion PR; y recepción de webhooks normalizados. Core no entrega tokens de App al consumidor ni conserva credenciales GitHub.
- El webhook público termina en GitHub Integration. Core recibe un evento normalizado con bearer de servicio, conserva la idempotencia durable y encola en su DB existente antes de aceptar. La lógica de AnalysisRun, bindings y acceso permanece en Core.
- Core conserva la materialización de archivos, el snapshot ZIP de uso interno por Docker/Sandbox, Object Storage y URLs firmadas. Console conserva rutas/DTOs Core; no incorpora cliente directo al cuarto componente. Sandbox no se toca.
- Secuencia ya ejecutada en código fuente: aprobar contrato; hacer IDs Contract Sync únicos por emisor en Core/Console y adoptar el formato en GH; inicializar SDD/Harness y espejo del contrato en el repo hermano; implementar proveedor GitHub allí; reemplazar adapters en Core; verificar compatibilidad Console. Restan checks, Contract Sync resuelto y aprobación humana de `WI-CORE-003`. No hacer cambios externos de GitHub App/deploy/secretos sin solicitud expresa.
