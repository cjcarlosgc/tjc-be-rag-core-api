# 013 — Plan de análisis PR-driven

## Dependencias

SYSTEM-2.5/INTEROP-2.6, Project/binding, jobs durables, snapshots, índice, retrieval, Functional Knowledge, generación, Sandbox y propuestas. `GH-INTEROP-1.1` gobierna las operaciones privadas del pipeline y las rutas autenticadas de usuario Console→GitHub Integration, y se describe en `016-github-integration`; este plan no crea otro contrato.

## Cortes

1. Conservar el pipeline vigente AnalysisRun por PR/HEAD, CHANGESET frente a INDEX DELTA y autorización por Project.
2. En `WI-CORE-002`, retirar rutas y persistencia legacy sin afectar snapshot ZIP interno, ContextTrace, experimentos ni propuestas.
3. La separación definida en `spec/features/016-github-integration/` está implementada y cerrada localmente: `WI-GH-*` posee SDK/App/webhooks/discovery/repositorios/Checks/publicación; `WI-CORE-003` adapta consumidores y recibe eventos normalizados. Core retiene estado de dominio, decisiones RAG y orquestación; deploy/cutover siguen pendientes.
4. En `WI-CORE-004`, especificar happy paths OC01–OC15 y luego subcasos elegidos; cada uno con entrada, resultado, invariantes, evidencia y pruebas.
5. `WI-CORE-003` incluye la corrección del lifecycle de `ACTION_REQUIRED` (HU08/HU14): evaluación concurrente con un HEAD nuevo no puede dejar preguntas pendientes ni intentar reabrir como fallo un Run ya obsoleto.
6. El corte planificado `WI-CORE-011` depende de `WI-GH-007`: comparar `pullRequest.createdAt` contra `RepositoryBinding.createdAt`, excluir PRs anteriores incluso ante eventos posteriores y clasificar el historial existente sin borrarlo. Las fechas no verificables quedan ocultas y se reintenta su recuperación. `WI-CONSOLE-008` sincroniza/valida el contrato resultante sin cambio funcional de UI.

## Verificación

Contract tests por frontera, idempotencia, seguridad, freshness de HEAD, no publicación sobre Run obsoleto, fallos de Sandbox/Storage y ausencia de secretos en Console/Sandbox. Lint, tests, build, revisión independiente y cuatro checkpoints Contract Sync antes de cerrar cada WI.
