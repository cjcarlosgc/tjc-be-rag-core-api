# 008-experimental-comparison — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/features/004-rag-retrieval-context/` para el brazo RAG.
- `spec/transversal/experimental-metrics/` para métricas reproducibles.

## Diseño técnico

`ExperimentRun` agrupa `generalistAgentRuns[]` y `ragRuns[]`. Reutilizar la validación y persistencia productivas mediante `GenerationStrategy`, con ramas `RAG` y `GENERALIST_AGENT`. La divergencia experimental ocurre en la adquisición/construcción de contexto; después de producir la prueba, ambos brazos usan el mismo Sandbox ciego y la misma normalización de resultados.

Persistir configuración y trazas suficientes para reproducibilidad. No asumir que una única interfaz `TestContextStrategy` modela correctamente ambos brazos: el agente generalista puede requerir un loop de herramientas, mientras que RAG produce un `GenerationContext` explícito. El diseño concreto queda fijado por `DEC-EXP-002` (APROBADO, ver `spec.md`): herramientas read-only ampliadas (incluye TS language service), snapshot vía el mismo mecanismo de materialización de workspace ya usado por indexación/generación, trayectoria completa persistida como evidencia, exclusión de tests existentes del target, y límites/paridad simétricos con RAG (`maxContextTokens`, timeout del pipeline, tope ~20 tool calls).

Auditar HU15/HU17 frente a `011-context-traces` al seleccionar la adaptación live; toda brecha se registra como subtarea y WI antes de modificar código.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
