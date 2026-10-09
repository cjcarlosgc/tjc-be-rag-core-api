# 011-context-traces — Plan

## Dependencias

- `004-rag-retrieval-context`, `008-experimental-comparison` y el pipeline PR-driven de `013-pr-driven-analysis`; la evidencia de generación/validación pertenece al `AnalysisRun`, sin revivir features de generación manual ni descarga legacy.
- `spec/transversal/persistence/` para almacenamiento e índices.
- `INTEROP-2.6`, sección 6.7.

## Diseño técnico

- Agregar una cabecera relacional `ContextTrace` indexada por `projectVersionId`, `targetId`, `experimentId`, `experimentRepetitionId`, `attempt` y `current`. El detalle versionado se guarda como JSONB validado por tipo (`RAG` o `AGENT`); los archivos descubiertos se conservan en filas paginables o una estructura equivalente que no obligue a devolverlos todos.
- Extender `ContextBuilder` para producir, junto con `GenerationContext`, decisiones explícitas para candidatos bajo mínimo, fuera de top-K y excluidos por presupuesto. La selección usada por el prompt no cambia.
- Persistir la traza RAG antes de invocar el LLM, de forma atómica o recuperable con el resultado del target. Si el pipeline falla después, la evidencia adquirida sigue consultable al llegar el run a estado terminal.
- Normalizar las respuestas de `WorkspaceAgentTools` en observaciones estructuradas sin alterar el texto efectivamente entregado al modelo. Calcular hashes sobre ese resultado y conservar truncamiento/rangos.
- Resolver hasta tres líneas circundantes desde `ProjectVersion`/`CodeChunk` o desde el snapshot privado mediante un servicio de lectura segura; nunca devolver paths absolutos, signed URLs ni storage keys.
- Implementar el listado paginado de trazas de Experiments, el detalle y el listado paginado de archivos descubiertos, siguiendo exactamente `INTEROP-2.6` §6.7.
- Autorizar consultas con el acceso Reader vigente al Project del experimento y filtrar en repositorio por el experimento visible.

## Validación

- Pruebas de cada motivo de descarte, combinación dual de señales y respeto exacto al token budget.
- Pruebas de orden, vacío, error, truncamiento, hashes, líneas circundantes y paginación de `list_files`.
- Pruebas de retry: historial conservado y último intento por defecto.
- Pruebas de aislamiento entre ProjectVersion y Project autorizado, redacción de secretos y ausencia de chain-of-thought.
- `lint`, `test`, `build` y SDD check antes de cierre.

## Corte SMART V3

`WI-CORE-026` depende de `WI-CORE-021` (el `context_id` incluye `functionalRules`) y precede a `WI-CORE-027`.

## Diseño técnico SMART V3 (WI-CORE-026)

`retrieval_id` y `context_id` son UUID generados por Core y persistidos en tablas aditivas `analysis_retrievals` y `analysis_contexts`, ligadas a `AnalysisSymbol` (target) y a `AnalysisRun`; `GeneratedTestProposal` referencia `contextId`. Core captura el `executionId` que devuelve el Sandbox y lo guarda con `proposalId`, `attempt`, `executionProfile` y `outcome` en una tabla de ejecuciones del Run. `checkId` es el identificador del Check devuelto por GitHub Integration al publicar (si Core no lo persiste hoy, este WI añade la columna) y `freshness` es `STALE` si la publicación consta `STALE`, `CURRENT` si consta publicada y `null` sin publicación. Persistir el trace no altera el contexto entregado al LLM; migración reversible y sin backfill de Runs anteriores. Reglas de estado: `changeset` es `NOT_APPLICABLE` si no hay targets; `retrieval` y `context`, si el Run terminó antes de recuperar; `generation`, si quedó en `ACTION_REQUIRED` antes de generar; `executions`, si no hubo propuesta ejecutada; `publication`, mientras no exista `TestPublication`. Pruebas a tocar: `analysis-run-validation-job.handler.spec.ts` y `context-traces.service.spec.ts`; se crea la del endpoint `trace`.

### Obligación heredada de WI-CORE-021 (reglas funcionales en el contexto persistido)

`WI-CORE-021` construye en memoria `GenerationContext.functionalRules` con su procedencia y su auditoría (`retrieved`, `selected` y omitidas con cantidad y motivo), pero no persiste nada: el `ContextTrace` experimental y su prueba actual exigen la ausencia de `functionalRules`. El usuario (Human Reviewer) aprobó 021 condicionado a que `WI-CORE-026` asuma la persistencia, con este alcance verificable:

- `analysis_contexts` (el `context_id`) conserva `functionalRuleIds` (los `knowledgeId` seleccionados, en el orden determinista de 021), `retrievedCount`, `selectedCount`, `omittedCount` y la lista de omitidas con su `knowledgeId` y `reason` (al menos `TOKEN_BUDGET`); distingue las reglas aplicables recuperadas de las que entraron por presupuesto.
- La procedencia autoritativa (`confirmedByUserId`, `confirmedRole`, `originHeadSha`, `source`, `sourceRef`) permanece en Functional Knowledge y se reconstruye por `knowledgeId`; no se copia completa a cada fila de trace ni al prompt. Si una regla fue supersedida o cambió después, el trace sigue resolviendo por `knowledgeId` sin reescribir el contexto histórico.
- Persistir estos campos no cambia el contexto entregado al LLM ni los conteos de tokens de 021.
- Si `GET /analysis-runs/{id}/trace` o el bundle de evidencia exponen estos campos, se actualiza `INTEROP-2.7` §6.16 y se emite el Contract Sync a Console en el mismo WI; si no se exponen, el WI lo declara y registra por qué no hay impacto contractual adicional.
- Prueba exigida: persistencia real de un `context_id` con reglas seleccionadas y con al menos una regla omitida por `TOKEN_BUDGET`; lectura que reconstruye la procedencia por `knowledgeId`; y la aserción actual de `experiment-job.handler.spec.ts` sobre la ausencia de `functionalRules`/procedencia en la traza se invierte o se reemplaza por esta verificación.

## Detalle técnico verificado (WI-CORE-026)

Verificado el 2026-10-09 contra `app/src` (reporte `harness/reports/wi-core-026-sdd-verification.md`). Vigente salvo `DEC-TRACE-001` y `DEC-TRACE-002` (PROPOSED, `Blocks: WI-CORE-026` solo para el enlace `publication` y `checkId`).

- **Generación de ids:** `retrieval_id` y `context_id` (UUID) los crea `AnalysisRunValidationJobHandler.generateAndValidate`, tras `retrievalService.retrieve` y `contextBuilder.build` y antes de `promptBuilder.build`; se persiste sin mutar `GenerationContext` ni el prompt. Los símbolos con test existente o sin framework no recuperan y sus enlaces constan `NOT_APPLICABLE`.
- **Tablas aditivas:** `analysis_retrievals(id, analysisRunId→AnalysisRun, analysisSymbolId→AnalysisSymbol, mode, config JSONB, candidates JSONB sin contenido de código, createdAt)` con `UNIQUE(analysisRunId, analysisSymbolId)`; `analysis_contexts(id, analysisRunId, analysisSymbolId, retrievalId→analysis_retrievals, selectedChunkIds, discardedChunkIds, selectedTokens, tokenBudget, functionalRuleIds[], functionalRulesRetrieved, functionalRulesSelected, functionalRulesOmitted, omittedFunctionalRules JSONB [{knowledgeId, reason}], createdAt)` con `UNIQUE(analysisRunId, analysisSymbolId)`; índices por `analysisRunId`. Escritura por upsert para que un reintento del job conserve una fila por target. `GeneratedTestProposal.contextId` nullable (FK a `analysis_contexts`). Tabla `analysis_run_executions(id, analysisRunId, proposalId→GeneratedTestProposal, executionId, attempt, executionProfile, outcome, createdAt)`. `executionId` se captura extendiendo `SandboxExecutionResult` (y el error de ejecución aceptada). Migración aditiva, reversible y sin backfill.
- **Obligación de 021:** `analysis_contexts` guarda `functionalRuleIds` (`knowledgeId` seleccionados en el orden del retriever), los tres conteos y las omitidas con `knowledgeId` y `reason` (`TOKEN_BUDGET` como mínimo). La procedencia (`confirmedByUserId`, `confirmedRole`, `originHeadSha`, `source`, `sourceRef`) no se copia; se reconstruye por `knowledgeId` desde Functional Knowledge. El `ContextTrace` experimental añade el mismo bloque al JSONB `detail` en `makeRagDetail`; el mapeo explícito de `ContextTracesService` no lo expone, por lo que §6.7 no cambia, y se invierte la aserción de `experiment-job.handler.spec.ts` para exigir su presencia sin procedencia ni texto de la regla.
- **Endpoint:** `GET /analysis-runs/{id}/trace` en `AnalysisRunsController`, `@RequireProjectRole('READER', ProjectTargets.param('analysisRun','id'))`; `409 EVIDENCE_NOT_FINISHED` en `QUEUED`/`PROCESSING`; forma exacta de §6.16; sin chain-of-thought, secretos ni código. `targets` son los símbolos `DIRECTLY_CHANGED` `METHOD`/`FUNCTION`; `changeset.status=NOT_APPLICABLE` si no hay. Un enlace sin fila en un Run no activo es `NOT_APPLICABLE`.
- **Contrato:** los conteos y las omitidas no están en §6.16; si se exponen en el trace o el bundle se enmienda §6.16 y se emite Contract Sync a Console; si no, el WI declara por qué no hay impacto adicional. La matriz de roles ya lista `/trace` como Reader; no hay decisión abierta sobre ella.
- **Pruebas:** `analysis-run-validation-job.handler.spec.ts`, `context-traces.service.spec.ts`, nueva del endpoint (Reader, 403, 404, 409, Run sin targets, Run en `ACTION_REQUIRED`) y persistencia real de `context_id` con omisión por `TOKEN_BUDGET`.
