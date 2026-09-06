# Evidencia — 008-experimental-comparison (HU19)

**Sprint:** Sprint 2 (cierre) · **Historia:** HU19 · **Estado:** DONE (código); validación end-to-end contra un Sandbox y un LLM reales queda pendiente (misma limitación que 005-006-007)

## Contexto

Última pieza de Sprint 2. `DEC-EXP-002` (contrato operativo del agente generalista) quedó `APROBADO` en SDD 1.9; esta feature lo implementa y lo compara contra el brazo RAG ya construido en `005-006-007`.

## Cambios de código

- **`src/generation/agent/`** (nuevo):
  - `WorkspaceAgentTools`: 4 herramientas read-only acotadas al snapshot materializado — `list_files`, `read_file`, `search_text` (grep), `inspect_symbol` (ir a definición + referencias vía ts-morph, combinado). Los archivos `*.test.ts`/`*.spec.ts` que cubren el target actual se excluyen de las 4 herramientas (constructor recibe `excludedTestFiles`).
  - `GeneralistAgentService`: loop de tool-calling real contra la API de OpenAI (`tool_choice: 'auto'`), acumula tokens de entrada/salida por llamada, registra la trayectoria completa (herramienta, argumentos, resultado truncado a 2000 caracteres) y fuerza una respuesta final sin herramientas al agotar `AGENT_MAX_TOOL_CALLS`.
- **`src/experiments/`** (nuevo módulo):
  - `ExperimentJobHandler`: para un target, ejecuta 2 estrategias × 3 repeticiones = 6 corridas, cada una en un workspace fresco extraído del snapshot original (sin acumular estado entre repeticiones, a diferencia del pipeline "producto" de 005). Arma RAG: reutiliza `RetrievalService`/`ContextBuilder`/`PromptBuilder`/`LLMProvider` tal cual el pipeline de generación. Brazo `GENERALIST_AGENT`: construye instrucciones que **no** incluyen el código del target (a diferencia del prompt de RAG) — el agente debe descubrirlo con sus herramientas, que es la variable experimental de interés. Ambos brazos comparten el mismo timeout de generación (`GENERATION_TIMEOUT_MS`, `withTimeout`) y la misma validación en el Sandbox (`SandboxExecutionService`, `scope: 'TARGET'`, reutilizando `mapSandboxResult` ya extraído a `src/sandbox/map-sandbox-result.ts`).
  - `ExperimentsService`: validaciones síncronas (proyecto existe, sin indexación activa, versión `COMPLETED`, target existe y es `METHOD`/`FUNCTION` — nunca `CLASS`), `POST /experiments`, `GET /experiments/:id`, `GET /experiments/:id/results` con agregación por estrategia (tasas, medias redondeadas de tiempos/tokens/chunks/tool calls, media sin redondear de `estimatedCost`, distribución de `failureType`).
  - `cost-calculator.ts`: `estimatedCost` es `null` (nunca `0`) cuando el proveedor no reporta tokens suficientes, configurable por `LLM_INPUT_COST_PER_1K_TOKENS`/`LLM_OUTPUT_COST_PER_1K_TOKENS`.
- **`src/sandbox/map-sandbox-result.ts`** (extraído): la lógica de mapeo `RunnerFacts`/`SandboxFailureFact` → veredicto de producto, antes privada en `TestGenerationJobHandler`, ahora es una función pura compartida por 005 y 008.
- **Prisma**: `ExperimentRun`, `ExperimentRepetition` + enums `ExperimentStatus`, `ExperimentStrategy`. Migración `20260906140641_experiment_comparison`, generada con `prisma migrate diff --from-config-datasource` y aplicada contra la Supabase real.
- **Config nueva**: `AGENT_MAX_TOOL_CALLS` (default 20), `GENERATION_TIMEOUT_MS` (default 60000, compartido por ambos brazos), `LLM_INPUT_COST_PER_1K_TOKENS`/`LLM_OUTPUT_COST_PER_1K_TOKENS` (valores aproximados de referencia, documentados como configurables).
- **Error nuevo**: `EXPERIMENT_NOT_FOUND`, `EXPERIMENT_NOT_FINISHED` (mismo patrón `409 *_NOT_FINISHED` que `TEST_RUN_NOT_FINISHED`).

## Verificación

- `pnpm lint` → OK.
- `pnpm test` → 161/161 (nuevas: `workspace-agent-tools.spec.ts` 7, `generalist-agent.service.spec.ts` 4, `cost-calculator.spec.ts` 3, `map-sandbox-result.spec.ts` 5, `experiment-job.handler.spec.ts` 8, `experiments.service.spec.ts` 9).
- `pnpm test:e2e` → 11/11 (nuevo `experiments.e2e-spec.ts`, 2 casos), contra la Supabase real, con `LLM_PROVIDER`, `SandboxExecutionService` y `GeneralistAgentService` reemplazados por fakes. El caso principal indexa un proyecto real, obtiene un target `FUNCTION` vía el inventario, crea un experimento, espera `COMPLETED` y verifica: 6 repeticiones (3 RAG + 3 agente), métricas específicas correctas por estrategia (RAG con `retrievedChunks`/`selectedChunks`/`contextTokens` y `toolCalls`/`filesInspected` en `null`; agente al revés), y que ambos servicios fake fueron invocados el número esperado de veces.
- `pnpm build` → OK.
- `npx tsc --noEmit` → sin errores nuevos.

## Limitación real — no resuelta en este corte

Misma limitación que `005-006-007`: **sin verificación contra un Sandbox real** (otro repositorio, ausente en este workspace) ni contra la API real de OpenAI para el loop de tool-calling del agente (`GeneralistAgentService` está probado con el SDK de OpenAI mockeado). El diseño del cliente/loop es real y reutilizable tal cual contra los servicios reales cuando estén disponibles.

`inspect_symbol` es una simplificación deliberada de las 3 sub-capacidades de TS language service mencionadas en `DEC-EXP-002` (ver `tasks.md` para el detalle). La paridad de presupuesto de contexto entre RAG y el agente es orientativa (se le indica el mismo número en las instrucciones), no un conteo exacto de tokens de exploración consumidos.

## Cierre de Sprint 2

Con esta feature, Sprint 2 (HU08-HU19) queda completo en código: `004-rag-retrieval-context`, `005-test-generation` + `006-validation-orchestration` + `007-artifacts`, y `008-experimental-comparison`. Pendiente transversal a las tres entregas: verificación end-to-end contra el Sandbox real (`tjc-be-test-execution-sandbox`, otro repositorio) y contra la API real de OpenAI, ninguna disponible en este workspace.
