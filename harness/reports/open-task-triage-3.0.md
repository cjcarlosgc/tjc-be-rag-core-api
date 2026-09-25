# Triage de casillas antiguas — SDD 3.0 Core

Las casillas de los `tasks.md` anteriores no son work items ejecutables. La revisión de 2026-09-24 las separó antes de retirar los checklists de la spec vigente; Git y los reportes anteriores preservan texto y evidencia.

| Grupo anterior | Destino | Justificación |
| --- | --- | --- |
| HNSW e indexación de versiones existentes | ST-CORE-005 / WI-CORE-005, P2 | Mejora de rendimiento y migración condicionada a inventario de datos. |
| Decisiones de candidatos descartados de RAG | ST-CORE-006 / WI-CORE-006, P2 | Falta traza completa; requiere contrato y pruebas. |
| Mensaje persistido de fallos Sandbox/experimento | ST-CORE-007 / WI-CORE-007, P2 | Requiere migración y revisión contractual; no tocar datos antes de inventario. |
| Matriz organizacional, Contract Sync y precondiciones de despliegue | ST-CORE-008 / WI-CORE-008, P2 | Verificación pendiente, no prueba de despliegue actual ni autorización de push. |
| Investigación test-aware, cambio de embeddings, cobertura secundaria | IDEA-002–IDEA-004 | Propuestas condicionales, no ejecución aprobada. |
| `Project.ownerUserId` y `ContextTrace` repetidos en persistencia | Historia en Git/reportes | El código y la spec actual ya los contemplan; la vieja casilla abierta no se toma como evidencia de trabajo pendiente ni de HU terminada. |
| Casillas marcadas de features/transversales anteriores | Git, CHANGELOG y reportes | Evidencia histórica, no planificación SDD 3.0 ni aceptación automática de HU01–HU18. |
