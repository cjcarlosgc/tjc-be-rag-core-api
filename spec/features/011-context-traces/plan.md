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
