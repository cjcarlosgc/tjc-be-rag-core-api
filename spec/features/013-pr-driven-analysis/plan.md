# 013 — Plan de análisis PR-driven

## Dependencias

SYSTEM-2.6/INTEROP-2.7, Project/binding, jobs durables, snapshots, índice, retrieval, Functional Knowledge, generación, Sandbox y propuestas. `GH-INTEROP-1.2` gobierna las operaciones privadas del pipeline y las rutas autenticadas de usuario Console→GitHub Integration, y se describe en `016-github-integration`; este plan no crea otro contrato.

## Cortes

1. Conservar el pipeline vigente AnalysisRun por PR/HEAD, CHANGESET frente a INDEX DELTA y autorización por Project.
2. En `WI-CORE-002`, retirar rutas y persistencia legacy sin afectar snapshot ZIP interno, ContextTrace, experimentos ni propuestas.
3. La separación definida en `spec/features/016-github-integration/` está implementada y cerrada localmente: `WI-GH-*` posee SDK/App/webhooks/discovery/repositorios/Checks/publicación; `WI-CORE-003` adapta consumidores y recibe eventos normalizados. Core retiene estado de dominio, decisiones RAG y orquestación; deploy/cutover siguen pendientes.
4. En `WI-CORE-004`, especificar happy paths OC01–OC15 y luego subcasos elegidos; cada uno con entrada, resultado, invariantes, evidencia y pruebas.
5. `WI-CORE-003` incluye la corrección del lifecycle de `ACTION_REQUIRED` (HU08/HU14): evaluación concurrente con un HEAD nuevo no puede dejar preguntas pendientes ni intentar reabrir como fallo un Run ya obsoleto.
6. Corte completado localmente: `WI-CORE-014` publicó `GH-INTEROP-1.2`; `WI-GH-007` implementó y sincronizó la fecha original en webhook y lectura histórica; `WI-CORE-011` compara `pullRequest.createdAt` con `RepositoryBinding.createdAt`, excluye PRs anteriores y clasifica el historial sin borrarlo, con recuperación durable para fechas no verificables; `WI-CONSOLE-008` validó el corte previo de sincronización y el consumo por Project sin cambios funcionales de UI. La corrección narrativa de los contratos se redistribuye ahora mediante Contract Sync. El cierre local no espera despliegue ni cutover, que requieren autorización posterior.
7. Corte SMART V3 (SDD preparada en `WI-CORE-017`): `WI-CORE-018` corrige `UNKNOWN` y la activación de `ACTION_REQUIRED`; `WI-CORE-019` añade el rol Writer y la procedencia de reglas; `WI-CORE-020` permite varias reglas `ACTIVE` por `scenarioKey`. Orden estricto por dependencias porque comparten migraciones de Functional Knowledge.

## Verificación

Contract tests por frontera, idempotencia, seguridad, freshness de HEAD, no publicación sobre Run obsoleto, fallos de Sandbox/Storage y ausencia de secretos en Console/Sandbox. Lint, tests, build, revisión independiente y cuatro checkpoints Contract Sync antes de cerrar cada WI.
