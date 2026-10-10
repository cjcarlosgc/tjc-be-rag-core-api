# WI-CORE-026 — Verificación de suficiencia SDD
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Solo lectura sobre `app/`; sin llamadas reales a OpenAI ni APIs externas. Se añadió la sección «Detalle técnico verificado (WI-CORE-026)» a `spec/features/011-context-traces/plan.md` (solo lo aprobado como vigente).

## Veredicto: DECISION_REQUIRED (parcial)

Criterios 1, 3 (salvo `publication`), 4 y la obligación de 021 son suficientes y se pueden cortar e implementar. Dos decisiones PROPOSED bloquean únicamente el enlace `publication` / `checkId`. `contractImpact=true` ya declarado; recomendar `contract-reviewer` antes del corte de publicación.

## Decisiones (PROPOSED, no cerradas)

### DEC-TRACE-001 — Origen de `checkId`
**Estado:** PROPOSED
**Blocks:** `WI-CORE-026` (columna `checkId`, `publication.checkId`); `spec/contracts/github-integration-contract.md` (`POST /checks`)
**Hecho:** `POST /internal/v1/github/checks` responde `204 No Content` (github-integration-contract.md:53 y :124) y `GithubChecksService.createCheckRun` devuelve `void` (`app/src/github-app/github-checks.service.ts:25-40`). Hoy Core no puede obtener ni persistir el id del Check; la columna no existe.
**Pregunta:** ¿Se aprueba enmendar `GH-INTEROP` para que `POST /checks` responda `200 { checkId }` (cambio cross-component: handoff al agente de GitHub Integration, tras confirmación del usuario) y que Core lo persista? Alternativa: `checkId = null` hasta esa enmienda, lo que contradice el criterio 2 de aceptación.

### DEC-TRACE-002 — Semántica del enlace `publication`
**Estado:** PROPOSED
**Blocks:** `WI-CORE-026` (enlace 9 `publication`, `freshness`)
**Hecho:** §6.16 agrupa `checkId` (Check del Run, existe sin `TestPublication`) con `companionBranch`/`companionPullRequestUrl`/`sourceHeadSha`/`freshness` (de `TestPublication`), pero marca `NOT_APPLICABLE` «sin TestPublication». Además `TestPublicationStatus` tiene `PENDING|PUBLISHING|PUBLISHED|STALE|FAILED|CLOSED` y el plan solo define STALE y publicada.
**Pregunta:** (a) ¿`publication.status=PRESENT` si existe Check o `TestPublication`, con campos companion en `null` si solo hay Check? (b) `freshness`: `CURRENT` solo con `PUBLISHED`, `STALE` con `STALE`, `null` en `PENDING/PUBLISHING/FAILED/CLOSED` y sin publicación; ante varias `TestPublication` del Run, ¿la más reciente por `createdAt`? Recomendación: sí a ambas.

## Hallazgos (archivo:línea)

1. **Retrieval/contexto se generan solo en `AnalysisRunValidationJobHandler.generateAndValidate`** (`app/src/validation/analysis-run-validation-job.handler.ts:219-248`): `retrievalService.retrieve` (232), `functionalRulesRetriever.retrieve` (233), `contextBuilder.build` (234) y luego `promptBuilder.build`/`llmProvider.generate`. Los símbolos con test existente (`:134-137`) y sin framework (`:139-150`) no recuperan: sus enlaces `retrieval`/`context` son `NOT_APPLICABLE` legítimos. No hay `retrieval_id`/`context_id` en el schema (`app/prisma/schema.prisma`, sin tablas `analysis_retrievals`/`analysis_contexts`).
2. **`executionId` no sale del servicio**: `SandboxExecutionService.execute` lo recibe (`app/src/sandbox/sandbox-execution.service.ts:83-99`) pero `SandboxExecutionResult` (`app/src/sandbox/sandbox.types.ts:52-57`) no lo incluye; hay que extender el tipo (aditivo). `executionProfile` se deriva en `:79` (`EXECUTION_PROFILE_BY_RUNNER`). Si el Sandbox acepta y luego falla/expira, `execute` lanza y el `executionId` se perdería: conviene exponerlo también en el error.
3. **`GeneratedTestProposal` no tiene `contextId`** (`schema.prisma:394-412`); `persistProposal` (`handler.ts:342-364`) es el único creador y se llama tras el Sandbox, luego `proposalId` está disponible para ligar la ejecución.
4. **`checkId` no existe**: ver DEC-TRACE-001; `AnalysisRunChecksService.publishForRun` (`app/src/checks/analysis-run-checks.service.ts:28-60`) es best-effort y no guarda nada.
5. **Obligación de 021**: `GenerationContext.functionalRules` (`app/src/retrieval/generation-context.ts:64-70`) y `audit.functionalRules{retrieved,selected,tokenCount,omitted[{knowledgeId,tokenCount,reason:'TOKEN_BUDGET'}]}` (`:103-117`) existen en memoria; el orden determinista lo fija el retriever (createdAt, knowledgeId; `context-builder.service.ts:133-155`). `makeRagDetail` del experimento (`app/src/experiments/experiment-job.handler.ts:1102-1160`) no persiste nada de esto y la aserción a invertir está en `app/src/experiments/experiment-job.handler.spec.ts:1385-1395` (`not.toContain('functionalRules')`; el test de entrega al prompt está en `:1352-1384`).
6. **La traza experimental no expone campos extra al contrato**: `ContextTracesService` mapea el JSONB con campos explícitos (`app/src/context-traces/context-traces.service.ts:221-233`), de modo que añadir `functionalRules` al `detail` no cambia §6.7.
7. **Endpoint**: `AnalysisRunsController` usa `@RequireProjectRole('READER', ProjectTargets.param('analysisRun','id'))` (`app/src/analysis-runs/analysis-runs.controller.ts:49-58`); el patrón sirve para `GET analysis-runs/:id/trace` (la matriz §6.13 ya lista `/trace` como Reader, interoperability-contract.md:~979). `404` sin visibilidad lo resuelve el guard.
8. **Matriz de roles de §6.16**: no hay decisión abierta ni texto pendiente sobre ella en spec/harness; `/trace` y `/evidence` ya figuran en la fila Reader. Lo «pendiente» es solo el estado de implementación (§6.16 dice «pendiente de implementar»). **No bloquea 026**: se cubre con prueba de autorización (Reader 200, sin rol 403 `PROJECT_ROLE_INSUFFICIENT`, no visible 404) y actualizando el texto de estado. Si el usuario se refería a otra cosa, debe precisarlo.
9. **Idempotencia/retry**: el job puede reintentarse y la continuación desde `ACTION_REQUIRED` vuelve a `PROCESSING` (`analysis-runs.service.ts:67,184`). `persistProposal` no es idempotente hoy; sin clave única, un reintento duplicaría filas de trace. Ver diseño (upsert por clave natural).
10. **Interop §6.16**: ya incluye `context.functionalRuleIds` y bundle `context[]` con `functionalRuleIds`; `NOT_APPLICABLE` y 409 están definidos. Los conteos/omitidas/`knowledgeId` de la obligación NO están en §6.16.

## Riesgos
- Duplicados de `retrieval_id`/`context_id` en reintentos si no se usa upsert por (`analysisRunId`, `analysisSymbolId`).
- Perder `executionId` cuando el Sandbox falla tras aceptar (hallazgo 2).
- No hay backfill: Runs previos devolverán `NOT_APPLICABLE` en retrieval/context/executions solo si están terminados; es la regla del WI, no un error.
- Un Run terminal por fallo de infraestructura antes de recuperar, con símbolos candidatos, muestra `NOT_APPLICABLE` (único estado disponible junto a `PRESENT`): se documenta como «terminó antes de recuperar» (criterio 3).
- `contextTokens`/prompt no deben cambiar: persistir tras `build` sin mutar `GenerationContext`.

## Verificaciones reales pendientes (no ejecutadas en este análisis)
Migración aplicada sobre PostgreSQL real (aditiva y reversible), prueba con persistencia real de `context_id` incluida omisión `TOKEN_BUDGET`, `lint`, `test`, `build` y `node harness/validate-harness.mjs` al cierre de cada corte, y los cuatro checkpoints de Contract Sync.

## Cortes propuestos
1. **Corte A — modelo y persistencia de retrieval/contexto (sin contrato nuevo):** migración aditiva `analysis_retrievals`/`analysis_contexts`, `GeneratedTestProposal.contextId`, persistencia en el handler con upsert, obligación de 021 (persistencia real + omisión TOKEN_BUDGET) e inversión de la aserción del experimento.
2. **Corte B — ejecuciones:** tabla de ejecuciones, `executionId` en `SandboxExecutionResult`, captura con `proposalId/attempt/executionProfile/outcome`.
3. **Corte C — endpoint `GET /analysis-runs/{id}/trace`:** servicio de armado, Reader, 409, `NOT_APPLICABLE`, pruebas de Run sin targets y en `ACTION_REQUIRED`; `publication` con `checkId=null` y `freshness` según DEC-TRACE-002 una vez cerrada.
4. **Corte D — `checkId` y Contract Sync:** solo tras cerrar DEC-TRACE-001 (handoff a GitHub Integration confirmado por el usuario); actualizar §6.16 (conteos/omitidas si se exponen, estado implementado, `outcome`), CHANGELOG y Contract Sync a Console.

## Handoff
`status`: DECISION_REQUIRED · `blockers`: DEC-TRACE-001, DEC-TRACE-002 (solo enlace publication/checkId) · `filesAffected`: este reporte y `spec/features/011-context-traces/plan.md` · `recommendedNextStep`: el usuario decide DEC-TRACE-001/002; mientras tanto se pueden seleccionar los cortes A y B.
