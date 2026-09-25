# 013 — Plan de análisis PR-driven

## Dependencias

SYSTEM-2.4/INTEROP-2.4, Project/binding, jobs durables, snapshots, índice, retrieval, Functional Knowledge, generación, Sandbox y propuestas. El contrato futuro Core↔GitHub Integration se aprueba en `WI-CORE-003`; no se inventa desde este plan.

## Cortes

1. Conservar el pipeline vigente AnalysisRun por PR/HEAD, CHANGESET frente a INDEX DELTA y autorización por Project.
2. En `WI-CORE-002`, retirar rutas y persistencia legacy sin afectar snapshot ZIP interno, ContextTrace, experimentos ni propuestas.
3. En `WI-CORE-003`, definir y verificar el contrato de servicio; mover SDK, App, webhooks, discovery, repositorios, Checks y publicación GitHub al cuarto componente. Core retiene estado de dominio, decisiones RAG y orquestación.
4. En `WI-CORE-004`, especificar happy paths OC01–OC15 y luego subcasos elegidos; cada uno con entrada, resultado, invariantes, evidencia y pruebas.

## Verificación

Contract tests por frontera, idempotencia, seguridad, freshness de HEAD, no publicación sobre Run obsoleto, fallos de Sandbox/Storage y ausencia de secretos en Console/Sandbox. Lint, tests, build, revisión independiente y cuatro checkpoints Contract Sync antes de cerrar cada WI.
