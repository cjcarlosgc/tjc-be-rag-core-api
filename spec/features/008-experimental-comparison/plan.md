# 008-experimental-comparison — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/features/004-rag-retrieval-context/` para el brazo RAG.
- `spec/transversal/experimental-metrics/` para métricas reproducibles.

## Diseño técnico

`ExperimentRun` agrupa `generalistAgentRuns[]` y `ragRuns[]`. Reutilizar la validación y persistencia productivas mediante `GenerationStrategy`, con ramas `RAG` y `GENERALIST_AGENT`. La divergencia experimental ocurre en la adquisición/construcción de contexto; después de producir la prueba, ambos brazos usan el mismo Sandbox ciego y la misma normalización de resultados.

Persistir configuración y trazas suficientes para reproducibilidad. No asumir que una única interfaz `TestContextStrategy` modela correctamente ambos brazos: el agente generalista puede requerir un loop de herramientas, mientras que RAG produce un `GenerationContext` explícito. El diseño concreto queda fijado por `DEC-EXP-002` (APROBADO, ver `spec.md`): herramientas read-only ampliadas (incluye TS language service), snapshot vía el mismo mecanismo de materialización de workspace ya usado por indexación/generación, trayectoria completa persistida como evidencia, pruebas existentes visibles para el agente (`DEC-EXP-003` reemplaza la exclusión original de `DEC-EXP-002` §4), y límites/paridad simétricos con RAG (`maxContextTokens`, timeout del pipeline, tope ~20 tool calls).

Auditar HU15/HU17 frente a `011-context-traces` al seleccionar la adaptación live; toda brecha se registra como subtarea y WI antes de modificar código.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.

## Cortes SMART V3

Secuencia: `WI-CORE-023` (paridad `LLMProvider`) → `WI-CORE-024` (exploración del agente) → `WI-CORE-025` (pareado, orden, seed, presupuesto y reintentos). `WI-CORE-007` (diagnóstico de fallos) alimenta la evidencia de `WI-CORE-027`. `WI-CORE-029` (OE5 con PHP) queda diferido.

## Diseño técnico SMART V3 (WI-CORE-007, WI-CORE-024 y WI-CORE-025)

- **Agente generalista (`WI-CORE-024`).** Se retiran los filtros de `WorkspaceAgentTools` que ocultan las pruebas que cubren el target (`DEC-EXP-003`), manteniendo la exclusión de rutas fuera del snapshot (`node_modules`, `.git`). El agente expone exactamente cuatro herramientas; `inspect_symbol` cubre definición y referencias. Tope `toolCallCap` = 20, configurable por entorno; al alcanzarlo se hace una última llamada sin herramientas para generar la prueba. Cada resultado de herramienta se trunca para no superar `contextTokenBudget` (= `maxContextTokens` de RAG) y lo truncado se marca en la trayectoria.
- **Pareado (`WI-CORE-025`).** Core genera `randomizationSeed` al crear el experimento (32 bytes aleatorios en hexadecimal) y lo persiste. El orden del par `i` (1..3) lo decide un PRNG determinista sembrado con `SHA-256(seed + ':' + i)` que fija si RAG o GA ocupa `pairPosition` 1. `pairId` es un UUID de Core por par, compartido por las dos estrategias de la misma repetición; el intento 2 reutiliza `pairId` y `pairPosition`.
- **Reintentos.** Un fallo externo demostrado es una repetición `FAILED` por error del proveedor LLM (HTTP 5xx, 429 o timeout de red) o por un fallo de infraestructura del Sandbox (`failureType: INFRASTRUCTURE`); cualquier otro fallo es de la estrategia y no se reintenta. Tras el segundo fallo externo la repetición queda `technicallyEvaluable=false`. El intento 1 conserva la identidad Sandbox `experiment:{jobId}:{strategy}:{repetition}` y el intento 2 usa `experiment:{jobId}:{strategy}:{repetition}:2`.
- **Persistencia.** Columnas aditivas en `ExperimentRun` (`randomizationSeed`, `modelConfig`, `budget`, `executionProfile`, `runnerHint`) y en `ExperimentRepetition` (`pairId`, `pairPosition`, `technicallyEvaluable`). `executionProfile` y `runnerHint` son los valores que Core envía al Sandbox al crear la ejecución. `POST /experiments` mapea el error de configuración del adaptador a `422 REASONING_EFFORT_UNSUPPORTED`.
- **Diagnóstico de fallos (`WI-CORE-007`).** `SandboxFailureFact` se persiste como JSONB nulo `failure` en `ExperimentRepetition`, con `message` saneado de secretos y sin backfill. Solo experimentos; no se toca `TargetRunResult`. El detalle se expone únicamente en la evidencia de `WI-CORE-027`; el DTO `ExperimentRepetitionResponse` no cambia.
