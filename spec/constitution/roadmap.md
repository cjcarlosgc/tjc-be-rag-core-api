# Roadmap de Core

La planificación de producto conserva las seis épicas y 18 HU fijas de `spec/backlog.md`. Los sprints S1–S4 son referencias para conversar con la planificación de la tesis, no certifican que la implementación o aceptación ya ocurrió. La ejecución real se selecciona por subtareas y work items locales con dependencias explícitas.

| Sprint de referencia | Objetivo de producto | HU | Incremento esperado |
| --- | --- | --- | --- |
| S1 | Representar un repositorio vinculado de manera semántico-estructural. | HU01–HU04 | Proyecto, binding, snapshot por commit, índice y tests existentes. |
| S2 | Generar y validar pruebas con contexto técnico. | HU05, HU10–HU12 | Retrieval, Context Builder, generación, Sandbox y evidencia. |
| S3 | Analizar cambios de PR con conocimiento funcional cuando haga falta. | HU06–HU08, HU13–HU14 | AnalysisRun, impacto, Action Required, clasificación y Check. |
| S4 | Consolidar operación y evaluación reproducible. | HU09, HU15–HU18 | Trace, publicación controlada y comparación experimental. |

## Cortes de transición actuales

1. `WI-CORE-001` (P0, cerrado localmente): reordenar SDD/Harness, IDs, estados, gates y contratos sin asumir aceptación de HU antiguas.
2. `WI-CORE-002` (P0, después del 001): retirar carga manual de código ZIP y descarga legacy de artefactos. Conservar snapshot ZIP interno y datos activos; migración/purga solo con inventario y respaldo.
3. `WI-GH-001`–`WI-GH-006`, `WI-CORE-003` y `WI-CONSOLE-003` están cerrados localmente con gates y revisión registrados: la interacción GitHub se separa por cortes verificables. El despliegue, configuración externa, retiro de rutas Core compatibles y cutover siguen pendientes de autorización/corte coordinado.
4. `WI-GH-007` → `WI-CORE-011` (P1): entregar `pullRequest.createdAt`, excluir PRs anteriores al binding y ocultar sin borrar su historial. Ambos quedan planificados; Console tiene `WI-CONSOLE-008` para sincronización contractual sin cambios de UI.
5. `WI-CORE-004` (P2): formalizar OC01–OC15, happy paths primero y subcasos después. El catálogo de nombres no equivale a cobertura validada.

## Backlog técnico P2, no seleccionado

- `WI-CORE-005`: HNSW y reindexación controlada (HU03/HU05); inventario de datos antes de cualquier migración.
- `WI-CORE-006`: trazabilidad de candidatos RAG descartados (HU05/HU15/HU17).
- `WI-CORE-007`: diagnóstico persistido de fallos experimentales (HU12/HU17).
- `WI-CORE-008`: verificación organizacional y Contract Sync de implementación (HU01/HU02/HU14), sin implicar despliegue autorizado.

Estos cortes proceden del triage de casillas antiguas, no se ejecutan automáticamente y pueden repriorizarse sin abrir nuevas HU. Las propuestas condicionales quedan en `spec/ideas.md`.

Los WIs de componentes distintos pueden avanzar en paralelo si `dependsOn` y los contratos lo permiten; el Harness actual admite solo un WI activo por repositorio y sí permite agentes paralelos dentro de ese WI. No se abren nuevas épicas/HU por defecto. Mutation testing se descartó para este alcance. Sandbox conserva su SDD/Harness actual mientras el compañero implementa PHP; se homologará en un corte posterior coordinado.
