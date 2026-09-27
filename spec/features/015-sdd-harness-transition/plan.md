# 015 — Plan de transición Core

1. Alinear backlog, casos, nomenclatura y roadmap con el alcance aprobado.
2. Hacer comprobable la relación subtarea↔work item y corregir validadores heredados.
3. Retirar rutas de producto y código ZIP/artefactos obsoletos por corte seguro, con inventario de datos previo.
4. Trasladar la implementación a GitHub Integration bajo contrato aprobado y WIs locales; código fuente cerrado localmente en Core, Console y GitHub Integration.
5. Registrar evidencia, revisiones y Contract Sync en los cuatro checkpoints; los WIs de migración están cerrados. No publicar sin pedido explícito.

## Corte P1 — frontera GitHub Integration (WI-CORE-003)

- El contrato `GH-INTEROP-1.1` aprobado está en [`spec/contracts/github-integration-contract.md`](../../contracts/github-integration-contract.md). `WI-GH-002`–`WI-GH-006`, `WI-CORE-003` y `WI-CONSOLE-003` migraron las fuentes y cerraron localmente sus gates/revisiones.
- Las capacidades migradas son discovery y acceso App/org; ramas y lectura compare/tree/contenidos por SHA; Checks; Git Data/companion PR; y recepción de webhooks normalizados. Core no entrega tokens de App al consumidor ni conserva credenciales GitHub.
- El webhook público termina en GitHub Integration. Core recibe un evento normalizado con bearer de servicio, conserva la idempotencia durable y encola en su DB existente antes de aceptar. La lógica de AnalysisRun, bindings y acceso permanece en Core.
- Core conserva la materialización de archivos, el snapshot ZIP de uso interno por Docker/Sandbox, Object Storage y URLs firmadas. Console llama directamente al cuarto componente para App info, discovery, verificación GitHub y ramas, y sigue usando Core para dominio. Sandbox no se toca.
- La secuencia de implementación, sincronización contractual y revisión humana se completó localmente. No hacer cambios externos de GitHub App/deploy/secretos, ni retirar rutas Core compatibles, sin corte y autorización expresos.
