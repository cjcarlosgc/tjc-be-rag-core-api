# 008-experimental-comparison — Tareas

- [x] `DEC-EXP-002` ya resuelta (`APROBADO`); agente generalista implementado conforme al diseño en `spec.md`.
- [x] GenerationStrategy `RAG|GENERALIST_AGENT` (`ExperimentJobHandler.runRagArm`/`runAgentArm`, reutilizando `RetrievalService`/`ContextBuilder`/`PromptBuilder`/`LLMProvider` para RAG).
- [x] GeneralistAgentGenerationStrategy con el set de herramientas read-only aprobado (`WorkspaceAgentTools`: `list_files`, `read_file`, `search_text`, `inspect_symbol` — este último cubre ir a definición + buscar referencias vía ts-morph, combinado en una sola herramienta como simplificación documentada), acotado al snapshot materializado (`ZipExtractionService`, mismo mecanismo que indexación/generación) y con tope configurable de tool calls (`AGENT_MAX_TOOL_CALLS`, default 20).
- [x] Excluir `*.test.ts`/`*.spec.ts` del target actual de la vista de archivos del agente (`WorkspaceAgentTools` recibe `target.testFilePaths` como exclusión explícita).
- [x] Persistir trayectoria completa de tool calls (orden, argumentos, resultado resumido) como evidencia auditable (`ExperimentRepetition.trajectory`, JSON).
- [x] ExperimentRun/Result (`ExperimentRun`, `ExperimentRepetition` en Prisma; `ExperimentRunsRepository`).
- [x] Ejecución de 3x2 runs por target (`ExperimentJobHandler`: 2 strategies × 3 repeticiones = 6, cada una con workspace propio fresco).
- [x] Captura de tokens/costos/tiempos (`generationDurationMs`/`executionDurationMs`/`totalDurationMs`, `inputTokens`/`outputTokens`/`totalTokens`, `estimatedCost` vía `cost-calculator.ts`, configurable por `LLM_INPUT_COST_PER_1K_TOKENS`/`LLM_OUTPUT_COST_PER_1K_TOKENS`, null — nunca 0 — cuando el proveedor no reporta tokens).
- [x] Agregación y endpoint de resultados (`GET /experiments/:id/results`: tasas, medias redondeadas de tiempos/tokens/chunks/tool calls, media sin redondear de `estimatedCost`, distribución de `failureType` por estrategia).
- [x] Garantizar auto-repair OFF en experimento (no existe autorreparación implementada en ningún punto del pipeline; nada que desactivar).
- [x] Captura de tool calls/archivos inspeccionados/contexto del agente generalista (`toolCallCount`/`filesInspected` derivados de la trayectoria completa, no un conteo independiente).
- [x] Tests de aislamiento del snapshot, límites de exploración (tope de tool calls, paridad de presupuesto de tokens/timeout con RAG) y paridad experimental (`experiment-job.handler.spec.ts`, `generalist-agent.service.spec.ts`, `workspace-agent-tools.spec.ts`; timeout compartido `GENERATION_TIMEOUT_MS` aplicado a ambos brazos vía `withTimeout`).

## Calidad

- [x] Agregar/actualizar pruebas (`workspace-agent-tools.spec.ts`, `generalist-agent.service.spec.ts`, `cost-calculator.spec.ts`, `experiment-job.handler.spec.ts`, `experiments.service.spec.ts`, `map-sandbox-result.spec.ts`, e2e `experiments.e2e-spec.ts`).
- [x] Verificar manejo de errores (`EXPERIMENT_NOT_FOUND`, `EXPERIMENT_NOT_FINISHED`, `INVALID_GENERATION_TARGET` para target CLASS, fallos de Sandbox/LLM por repetición sin abortar el experimento).
- [x] Verificar observabilidad mínima (`Logger.warn` por repetición fallida, con estrategia/número de repetición).
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/` (`008-experimental-comparison.md`).

## Simplificaciones deliberadas de V1 (documentadas, no son bugs)

- **`inspect_symbol` combina 3 sub-capacidades del punto 1 de `DEC-EXP-002`** ("ir a definición, buscar referencias, inspeccionar tipos") en una sola herramienta: devuelve la declaración completa (incluye su firma/tipos) y una lista de archivos que referencian el símbolo por coincidencia textual — no se construyó un `ts.LanguageService` incremental completo con "find all references" basado en el compilador.
- **Paridad de límites**: se comparte el mismo presupuesto orientativo (`RETRIEVAL_MAX_CONTEXT_TOKENS`, mencionado en las instrucciones del agente) y el mismo timeout de generación (`GENERATION_TIMEOUT_MS`, aplicado a ambos brazos vía `withTimeout`). No se implementó un contador exacto de tokens de contexto consumidos por el agente (el modelo no expone eso directamente); la paridad es de presupuesto orientativo y límite de tool calls, no de conteo exacto de tokens de exploración.
- **Batch validation**: cada repetición valida un target aislado (`scope: TARGET`), igual que en `005/006`. No existe una fase de validación batch adicional.
- **`Coverage` como métrica secundaria**: no implementado (la propia spec lo declara Sprint 4, fuera de alcance de PI1).
