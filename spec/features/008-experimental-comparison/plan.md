# 008-experimental-comparison — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/features/004-rag-retrieval-context/` para el brazo RAG.
- `spec/transversal/experimental-metrics/` para métricas y `DEC-MET-001`.

## Diseño técnico

`ExperimentRun` agrupa `generalistAgentRuns[]` y `ragRuns[]`. Reutilizar la validación y persistencia productivas mediante `GenerationStrategy`, con ramas `RAG` y `GENERALIST_AGENT`. La divergencia experimental ocurre en la adquisición/construcción de contexto; después de producir la prueba, ambos brazos usan el mismo Sandbox ciego y la misma normalización de resultados.

Persistir configuración y trazas suficientes para reproducibilidad. No asumir que una única interfaz `TestContextStrategy` modela correctamente ambos brazos: el agente generalista puede requerir un loop de herramientas, mientras que RAG produce un `GenerationContext` explícito. El diseño concreto permanece bloqueado por `DEC-EXP-002`.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
