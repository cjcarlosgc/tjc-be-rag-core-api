# WI-CORE-024 — Verificación de suficiencia SDD

Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-08. Solo lectura sobre `app/`, `state.json` y `work-items.json`; se añadió "Detalle técnico verificado (WI-CORE-024)" a `spec/features/008-experimental-comparison/plan.md` y una referencia en su `tasks.md`.

## Resultado: SPEC_VERIFIED (sin bloqueos)

HU17 está en HU01–HU18; `ST-CORE-031` existe en `008/tasks.md` (`T-READY`); componente CORE; sin `caseIds`; dependencia `WI-CORE-023` ya cerrada; `contractSyncReview` revisa CS-20260920-001 y CS-20260921-003 como NOT_RELEVANT. Los specPaths de 011 aplican solo como contexto de trazas.

## decisionGate: PASS

| ID | Estado | Alcance / Blocks | ¿Bloquea? |
|---|---|---|---|
| DEC-EXP-003 | APROBADO | pruebas existentes visibles; es la regla a implementar | No |
| DEC-EXP-002 | APROBADO | contrato operativo del agente; §4 reemplazado por 003; §1 (language service completo) acotado por 003 a `inspect_symbol` | No |
| DEC-EXP-004 | APROBADO | modelo/esfuerzo; ya consumido vía `config` de WI-CORE-023 | No |
| DEC-EXP-FK-001 | APROBADO | el agente no recibe Functional Knowledge; no se toca | No |
| DEC-INF-001, DEC-VAL-001 | PENDING | Blocks: Sandbox remoto / código empresarial | No |
| DEC-RAG-001 | PENDING | solo prohíbe señal test-aware en RAG; el agente no usa retriever | No |

Registrar en `state.json`: bloqueantes `[]`; no bloqueantes `DEC-EXP-002`, `DEC-EXP-003`, `DEC-EXP-004`, `DEC-EXP-FK-001`. Sin pregunta de decisión.

## contractImpact = false (confirmado)

Sin DTO, ruta, enum, ErrorCode ni header nuevos. La trayectoria y `budget` extra viven en `ContextTrace.detail` (JSONB interno); `ContextTracesService` mapea campo a campo, así que `AgentContextTraceDetailResponse` no cambia. `agentExploration`/`contextTokenBudget` de INTEROP-2.7 §6.16 y `ExperimentRun.budget` son de WI-CORE-025/026/027. Sin migración. Contract-reviewer no requerido; Contract Sync solo en checkpoints (el de experimentos lo emite WI-CORE-025).

## Código actual vs. brecha

- `workspace-agent-tools.ts`: constructor filtra `excludedTestFiles`; descripción de `list_files`, mensaje de `read_file` y comentario de clase mencionan la exclusión. `inspect_symbol` ya existe (declaración + referencias).
- `generalist-agent.service.ts`: ya usa `LLMProvider` (WI-023) y la llamada final sin herramientas. Brecha: el bucle cuenta turnos, no tool calls (un turno con N llamadas excede el tope); sin truncado por tokens (solo `slice(0, 2000)` en el resumen); sin contador de presupuesto.
- `experiment-job.handler.ts` `runAgentArm`: pasa `target.testFilePaths` a las herramientas; lee `AGENT_MAX_TOOL_CALLS` (20) y `RETRIEVAL_MAX_CONTEXT_TOKENS` (6000), pero este último solo como texto "orientativo" en las instrucciones; no persiste tope ni presupuesto.
- `env.validation.ts`: `AGENT_MAX_TOOL_CALLS` ya existe (`@Min(1)`, default 20); sin `@Max`.

## Ambigüedades cerradas (plan.md)

1. Filtro: se elimina el parámetro y el handler deja de pasar `testFilePaths`; `node_modules`/`.git` siguen fuera por `FileDiscoveryService`. "Sin entregar directamente" = ni prompt ni instrucciones incluyen pruebas.
2. `inspect_symbol`: sin cambios funcionales; limitación (solo clases/funciones/interfaces/tipos/enums) aceptada.
3. `toolCallCap` = `AGENT_MAX_TOOL_CALLS` contando tool calls ejecutadas; sobrantes del último turno reciben mensaje fijo sin despacho; última llamada con `[]` y misma config.
4. Presupuesto: acumulativo, `contextTokenBudget` = `RETRIEVAL_MAX_CONTEXT_TOKENS`, contado con `countTokens` cl100k (el de RAG); el texto recortado es el que se hashea y entrega.
5. Persistencia: por paso `truncated`, `contextTokens`, `truncationReason`; en `detail.budget` tope, presupuesto, tokens entregados, `capReached`, `truncatedSteps`. Sin chain-of-thought.

## Hallazgos / riesgos

- (No bloqueante, interpretación) "Cada resultado se trunca para no superar contextTokenBudget" se cerró como presupuesto acumulativo (paridad con RAG). Si el Human Reviewer prefiere tope por resultado, es un cambio menor en el plan.
- (No bloqueante) Con budget 6000 y `read_file` de hasta 20 000 chars, el presupuesto se agotará pronto en repos grandes; es el efecto buscado por la paridad.
- (No bloqueante) `RETRIEVAL_MAX_CONTEXT_TOKENS` compartido: no hay variable separada para el agente; WI-CORE-025 persistirá el valor efectivo en `budget`.
- Sin riesgo de datos ni secretos.

## Cortes recomendados

1. `WorkspaceAgentTools`: retirar el filtro, actualizar descripciones/mensajes, spec (listar/leer pruebas, enumeración de herramientas, exclusión de `node_modules`/`.git`). Refs: HU17.
2. `GeneralistAgentService`: tope por tool calls, truncado por tokens acumulado, campos nuevos de paso y resultado, `@Max` en env; `generalist-agent.service.spec.ts`. Refs: HU17.
3. `experiment-job.handler`: dejar de pasar `testFilePaths`, pasar presupuesto, persistir `detail.budget`, instrucciones sin "orientativo"; specs de handler y context-traces; cierre documental y Contract Sync. Refs: HU17.

Perfil: `implementer` (low) basta; `implementer-high` solo si el cambio del conteo de tool calls rompe pruebas existentes del bucle.
