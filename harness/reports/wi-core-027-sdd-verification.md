# WI-CORE-027 — Verificación de suficiencia SDD
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Solo lectura sobre `app/`; sin llamadas reales externas. Se añadió la sección «Detalle técnico verificado (WI-CORE-027)» a `spec/transversal/experimental-metrics/plan.md` (lo vigente separado de lo marcado PROPUESTA). No se tocó código, contrato ni `harness/state.json`.

## Veredicto: DECISION_REQUIRED

La SDD (criterios, plan transversal y §6.16) es suficiente en intención, pero **no es implementable tal cual**: (1) el bundle exige datos que Core hoy no persiste (hechos del Sandbox, generación, `artifactHash`, `snapshotRef`, `executionId` experimental), así que la migración «esperada ninguna» es falsa; (2) §6.16 no puede reflejar la obligación de WI-CORE-025 (`technicallyEvaluable`) ni unir `sandbox[]`/`generation[]` con una repetición sin enmendarse; (3) el saneado de secretos (IDEA-016) está en la ruta de exposición de `failureMessage`/`failureCode` y tiene huecos reproducidos. Seis decisiones PROPOSED (DEC-EVID-001…006). `contractImpact=true` ya declarado; **activar `contract-reviewer` antes del primer corte que toque §6.16 o `StrategyMetricsResponse`**. Los cortes A (saneado) y el modelo de persistencia pueden empezar tras decidir DEC-EVID-003/004.

## Hallazgos (archivo:línea)

### H1. Sin persistencia suficiente: la migración no es «ninguna» (bloqueante de diseño)
- `AnalysisRunExecution` (`app/prisma/schema.prisma:413-429`) solo guarda `executionId`, `attempt`, `executionProfile`, `outcome`. No hay `facts`, `durationMs`, `requestId` ni `correlationId`; el `correlationId` del Sandbox es un `randomUUID()` efímero (`sandbox-execution.service.ts:~70`, dentro de `execute`) y `requestId` es un UUIDv5 de `jobId` que no se persiste en la fila (`sandbox-request-id.util.ts:13-33`).
- `GeneratedTestProposal` (`schema.prisma:472-`) guarda `contentSha256` (sirve de `artifactHash` del Run) pero no proveedor, modelo, tokens ni duración de generación: `llmProvider.generate(prompt)` (`analysis-run-validation-job.handler.ts:~263`) devuelve `inputTokens/outputTokens` y se descartan; el modelo sale de entorno y tampoco se persiste. La propuesta de excepción se guarda con `content: ''` (`:~322`), cuyo SHA-256 no es un artefacto real.
- `ExperimentRepetition` (`schema.prisma:826-`) tiene `compiled/executed/passed`, tokens, duraciones y `failure`, pero **no** `executionId` del Sandbox (el handler nunca lo lee: `experiment-job.handler.ts:763-790`), ni `correlationId`, ni conteos de pruebas (`totalTests`, `passedTests`, `failedTests`, `skippedTests`, `testCasesTruncated`), ni hash del artefacto generado. `failure` solo se escribe cuando el Sandbox no responde `COMPLETED` (`experiment-job.handler.ts:~790-794`): una repetición `COMPLETED` con pruebas fallidas (`TEST_ASSERTION`) tiene `failure = NULL` aunque `failureType` lo indique.
- Sin `snapshotRef` ni `artifactHash` en ningún lugar del código (grep sin coincidencias salvo el contrato). El snapshot del Run es la clave `analysis-runs/{run.id}/snapshot.zip` (`handler.ts:171`), una clave de storage que no debe salir.

### H2. §6.16 no cabe para varios datos reales
- `experimental[]` (`interoperability-contract.md:1191`) no trae `technicallyEvaluable`, por lo que el criterio heredado de 025 («refleja … en la evidencia») es **imposible sin enmendar §6.16**.
- `sandbox[]` y `generation[]` no tienen clave de unión con `experimental[]`: en un EXPERIMENT hay hasta 6 intentos vigentes (y filas superseded) y `generation[]` solo lleva `strategy`; una repetición sin invocación al Sandbox no produce entrada y rompe cualquier alineación por índice.
- `durationMs: number`, `requestId: string`, `correlationId: string`, `artifactHash: Sha256`, `executionId: string` son no nulos; para Runs anteriores a 026/027 y para repeticiones donde el Sandbox no se invocó, solo son honestos como `null` (regla «no observable ⇒ null», criterio 4). Hoy `ExperimentsService` emite `?? 0` para duraciones (`experiments.service.ts:~287-290`, y `mean(...) ?? 0` en `:~330-332`).
- `retrieval[].config` y `candidates` usan `RetrievalModeResultResponse['config']` y `RetrievalCandidateResponse` de §6.15 (`rank`, `combinedScore`, `selected`, `finalTopK`, `embeddingModel`). Lo persistido en `analysis_retrievals` es otra forma (`{mode:'SE', vectorTopK, targetChunkIds}` y `RetrievalCandidateEvidence` sin `rank`/`combinedScore`/`selected`: `analysis-trace-evidence.util.ts:9-56`). Debe traducirse en el ensamblado (rank = posición persistida; `selected` desde `selectedChunkIds`; `combinedScore` `null` en SE; pesos `null`; `finalTopK` del `audit.configuration.topK` solo si se persiste, hoy no). En el RAG de experimento el JSONB `detail` sí trae `configuration {minimumScore, topK, maxContextTokens, semanticWeight, structuralWeight}` y `rank/combinedScore/decision` (`experiment-job.handler.ts:1117-1175`), pero también `excerpt` de código: **se copia campo a campo, nunca el `detail`**.
- RETRIEVAL_COMPARISON: `retrieval[]` sale directo de `retrieval_comparison_results` (`toRetrievalModeResultResponse`, `retrieval-comparison.response.ts:~95-103`), pero sin `metrics` (Precision@k/Recall@k, exclusivas de OE2) que el item del bundle no declara. `groundTruth` no debe exportarse (oráculo previo, no entregado a RAG/agente).
- El `retrievalId`/`contextId` del brazo RAG de un experimento no existen: la traza experimental solo tiene `ContextTrace.id`.
- FAILED de experimento/comparación: el bundle no lleva estado ni `failureCode`; el consumidor lo lee de la ruta de estado. Un experimento `FAILED` puede reanudarse (`interoperability-contract.md:~280`), por lo que su bundle no es inmutable (solo `generatedAt` y datos nuevos cambian; el snapshot test debe fijar `generatedAt`).

### H3. Obligación de 025 (estado real)
- Exclusión ya implementada: `experiments.service.ts:314-316` filtra `technicallyEvaluable !== false` antes de tasas, medias y `failures`. Con cero evaluables: `rate()` devuelve `0` (`:86-88`), duraciones `Math.round(mean(...) ?? 0)` = `0`, tokens/costo/chunks `null` (`:328-345`). El contrato lo documenta (`interoperability-contract.md:342`): «`0` = sin datos evaluables», distinguible solo por `repetitions[].technicallyEvaluable`.
- Efecto en CF/CO: ningún campo de §6.5/§6.16 deriva CF/CO; la spec transversal (`spec.md`, «Jerarquía») ya lo prohíbe. La evidencia no incluye `valid` ni tasas; solo hechos por repetición.
- `ExperimentRepetitionResponse` ya emite `valid: repetition.valid ?? false` y `failureType ?? 'UNKNOWN'` (`experiments.service.ts:~284-286`): para una fila no evaluable o sin dato inventa `false`/`UNKNOWN`. Fuera del bundle, pero es la misma regla «no inventar» (se recoge en DEC-EVID-001).

### H4. IDEA-016 (reproducido con la implementación actual)
Probado con `sanitizeFailureMessage` real (script en scratchpad): **no se redacta** `xoxb-…`, `sk_live_…`, `AIza…`, `npm_…`, `Cookie: sid=…`, `Set-Cookie: …`, `credential=…`, `auth=…`, `signature=…`, `password hunter2`, ni secretos en la **ruta** de una URL (`https://hooks.slack.com/services/T000/B000/XXXX`, `https://x.io/token/abc…/path`). Sí se redactan `password=`, `api_key=…` y los patrones 007 (`sanitize-failure-message.util.ts:27-69`). Además:
- Log crudo: `sandbox-execution.service.ts:223-225` registra `failure.message` sin sanear (y `:211-214`, solo timings).
- `failure.code` no se redacta, solo se trunca a 64 (`experiment-failure-fact.ts:~67-72`); es string controlado por el Sandbox y saldría como `failureCode`.
- `ExperimentRepetitionInput` se propaga por spread en `insertRepetition`/`updateRepetitionById` (`experiment-runs.repository.ts:~279`): `failure` no se re-sanea en el límite de escritura.
- Filas ya persistidas con la versión actual conservan lo que esa versión no redactó; ampliar el helper no las corrige. **El export debe re-aplicar el helper (idempotente) al leer.**
- `errorSummary`/`failureSummary` crudos (`map-sandbox-result.ts:55-56,84`; `experiments.service.ts:292`; `analysis-run-validation-job.handler.ts:308,327`) y `failure.category` sin validar (`map-sandbox-result.ts:55`) son IDEA-015. El bundle no los usa.

### H5. Lo que sí está listo
- Trace ya implementado y reutilizable: `AnalysisRunTraceService.getTrace` (`analysis-run-trace.service.ts:60-135`) ya resuelve targets (`isTraceTarget`, `compareSymbolPosition` `:32-45`), retrieval/context por símbolo, propuestas, ejecuciones por `attempt` y `toPublication` (`:143-159`). El bundle de ANALYSIS_RUN debe reutilizar ese ensamblado (extraer a un colaborador, sin duplicar la regla de publicación).
- 409: `NOT_FINISHED_STATUSES = {QUEUED, PROCESSING}` (`:16`) y `ErrorCode.EVIDENCE_NOT_FINISHED` existe (`error-code.enum.ts:37`).
- Controladores: patrón `@RequireProjectRole('READER', ProjectTargets.param(...))` en `analysis-runs.controller.ts:72-73`, `experiments.controller.ts:47-48`, `retrieval-comparisons.controller.ts:33-40`. `correlationId` lo garantiza `CorrelationIdMiddleware` (`common/middleware/correlation-id.middleware.ts:5-14`): se lee de `x-correlation-id`.
- §6.16 y la matriz Reader (`interoperability-contract.md:980`) ya listan `/evidence` de las tres rutas como Reader; no hay decisión de roles abierta. `403 PROJECT_ROLE_INSUFFICIENT` no es alcanzable con Reader como mínimo (igual que `/trace`); la prueba cubre 200/404/409 y el metadato `@RequireProjectRole('READER', …)`.

## Detalle técnico (resumen; versión completa en `spec/transversal/experimental-metrics/plan.md`)

### 1. Forma del bundle por kind y origen
| Sección | ANALYSIS_RUN | EXPERIMENT | RETRIEVAL_COMPARISON |
|---|---|---|---|
| `analysisRun` | `AnalysisRun` (repositoryName, prNumber, headSha, projectVersionId, createdAt) + targets del trace; `snapshotRef` opaco | `null` | `null` |
| `retrieval[]` | `analysis_retrievals` por target (mode SE) | un item por repetición RAG vigente, de `ContextTrace.detail` (campo a campo) | los 2 `retrieval_comparison_results` (SE, SEM) |
| `context[]` | `analysis_contexts` (`selectedChunkIds`, `discardedChunkIds`, `selectedTokens`, `tokenBudget`, `functionalRuleIds`) | de `detail.candidates[].decision` y `detail.functionalRules.functionalRuleIds`; budget de `run.budget.contextTokenBudget` | `[]` |
| `generation[]` | strategy `PRODUCT`; datos nuevos persistidos; `artifactHash` = `contentSha256` | por repetición (RAG y agente): `modelConfig` + tokens + `generationDurationMs`; hash nuevo | `[]` |
| `agentExploration[]` | `[]` | del `detail.budget` y `trajectory` de trazas AGENT (`step`, `toolName`, `status`; sin argumentos ni resultados) | `[]` |
| `sandbox[]` | por `analysis_run_executions` con hechos nuevos | por repetición con invocación al Sandbox | `[]` |
| `experimental[]` | `[]` | por repetición vigente (+`technicallyEvaluable`, DEC-EVID-002) | `[]` |
| `publication` | `toPublication` del trace | `null` | `null` |

`sandbox.facts` = lista cerrada de 14 claves de §6.16 (criterio 2), construida por función explícita (nunca spread del JSON): `executionProfile`/`runner` de la fila o `runnerHint`; `compiled/executed/passed` y conteos de `RunnerFacts`; `failureStage/Category/Code/Message` del `failure` persistido y re-saneado al leer; `null` donde no hay dato. `testCases` (con `errorMessage`) **no** se persiste ni se exporta.

### 2. Rutas, roles, 404/409, correlationId, generatedAt
`GET /analysis-runs/:id/evidence`, `GET /experiments/:id/evidence`, `GET /retrieval-comparisons/:id/evidence`; Reader. 404 de la ruta de estado homónima (`ANALYSIS_RUN` por `getById`, `EXPERIMENT_NOT_FOUND`, `RETRIEVAL_COMPARISON_NOT_FOUND`). 409 `EVIDENCE_NOT_FINISHED` (AnalysisRun en `QUEUED`/`PROCESSING`; experimento y comparación en `PENDING`/`RUNNING`; `COMPLETED` y `FAILED` son terminales y responden 200, también `FAILED` de comparación sin `retrieval`). `correlationId` = valor de `x-correlation-id`; `generatedAt` = instante de ensamblado (no se persiste).

### 6. IDEA-016: qué es prerrequisito de 027
| Parte | ¿Prerrequisito? | Motivo |
|---|---|---|
| Ampliar patrones del helper (xox, sk_live/test, AIza, npm_, Cookie/Set-Cookie, credential/auth/signature, `password hunter2`, secretos en ruta URL) | **Sí** | está en la ruta de `failureMessage` |
| Redacción/validación de `code` (`^[A-Za-z0-9_.:-]{1,64}$`, si no, `null`) | **Sí** | sale como `failureCode` |
| Re-sanear al leer en el export | **Sí** | filas ya persistidas con reglas antiguas |
| Log crudo `sandbox-execution.service.ts:223-225` | Sí (mismo corte, bajo coste) | es el mismo dato; el usuario pidió acotarlo antes de exponer |
| Guarda en el límite de escritura (`ExperimentRepetitionInput` spread) | Sí | cierra el hueco por el que `failure` entraría sin normalizar |
| Validar `failure.category` (IDEA-015, solo enum) | Sí si el bundle usa `failureType` como respaldo | `map-sandbox-result.ts:55` castea sin validar |
| Sanear `errorSummary`/`failureSummary` en DTO públicos (IDEA-015) | **No** | el bundle no los usa; toca contrato de `/results` |

Propuesta única (DEC-EVID-004): **corte A previo dentro de 027**, que bloquea todo corte que exponga `failureMessage`/`failureCode`; no WI aparte.

## Riesgos
- Migración sobre tablas con Runs/experimentos existentes: columnas nullable, sin backfill; la evidencia de filas previas lleva `null` honestos (no 0 ni vacío).
- Divulgación por spread/`JSON` crudo: ensamblar solo por mapeo explícito; test de «claves prohibidas» recorre el bundle buscando `excerpt`, `content`, `url`, `signedUrl`, `storageKey`, `EV-OE`, `chainOfThought`, `reasoning`, tokens/credenciales de muestra.
- Cambiar tipos a `| null` en §6.5 es ampliación visible para Console (TypeScript estricto): requiere Contract Sync y verificación de WI-CONSOLE-017/020 antes de publicar.
- Un único `generatedAt` en el snapshot hace flaky la prueba si no se inyecta reloj.
- Costo: ensamblado de experimento lee hasta ~12 trazas; paginar no aplica (bundle completo), pero hay que limitarse a intentos vigentes y no leer `discovered_files`.

## Decisiones (PROPOSED; no cerradas; una por una)

### DEC-EVID-001 — `validRate` y agregados sin slots evaluables (obligación de WI-CORE-025)
**Estado:** PROPOSED · **Veredicto:** DECISION_REQUIRED
**Blocks:** `WI-CORE-027` (cambio de `StrategyMetricsResponse` y de INTEROP §6.5 línea 281/342; Contract Sync a Console). No bloquea los cortes de evidencia.
**Hecho:** con cero evaluables hoy `validRate/compilationRate/executionRate/passedRate = 0` y duraciones `0` (`experiments.service.ts:86-88,330-332`); §6.5 línea 342 declara que `0` = «sin datos evaluables».
**Opciones:** (A) mantener `0` y añadir solo `evaluableRepetitions`/`nonEvaluableRepetitions` por estrategia; (B) tasas y medias de duración `number | null`, `null` sin evaluables (más contadores aditivos); (C) mantener todo, solo reflejar en la evidencia.
**Recomendación:** B: es coherente con «valores no observables son null» y evita que `0` se lea como 0 %; los contadores dan el denominador. Coste: ampliación de tipo visible para Console (Contract Sync, contract-reviewer). Si el usuario prefiere no tocar §6.5, C es válida y cumple el criterio mínimo.

### DEC-EVID-002 — Enmienda aditiva de §6.16 para cumplir los criterios
**Estado:** PROPOSED · **Veredicto:** DECISION_REQUIRED
**Blocks:** `WI-CORE-027` (forma de `experimental[]`, `sandbox[]`, `generation[]`, `retrieval[]`; Contract Sync). §6.16 aún no está implementado: la enmienda es barata ahora y rompe a Console después.
**Hecho:** H2.
**Opciones:** (A) mínima: `experimental[].technicallyEvaluable: boolean`, `durationMs/requestId/correlationId/artifactHash/executionId` pasan a `| null` y regla de orden documentada; (B) A + claves de unión `repetition: number | null` y `strategy` en `sandbox[]`, `repetition`/`attempt` en `generation[]`, y `retrieval[].metrics: RetrievalMetricsResponse | null` (OE2); (C) no enmendar y exportar solo lo que cabe (incumple el criterio heredado de 025).
**Recomendación:** B. Todos los campos nuevos son aditivos o `null`; `metrics` queda `null` sin `groundTruth` y `groundTruth` no se exporta.

### DEC-EVID-003 — Persistencia necesaria: migración aditiva (el plan decía «ninguna»)
**Estado:** PROPOSED · **Veredicto:** DECISION_REQUIRED
**Blocks:** `WI-CORE-027` (cortes B–D; `schema.prisma`).
**Hecho:** H1.
**Opciones:** (A) una migración aditiva, reversible, sin backfill: `analysis_run_executions` (`requestId`, `correlationId`, `durationMs`, `facts` JSONB, `failure` JSONB), `generated_test_proposals` (`generation` JSONB: proveedor, modelo, `modelVersion`, esfuerzo, tokens, `durationMs`), `experiment_repetitions` (`sandboxExecutionId`, `sandboxRequestId`, `sandboxCorrelationId`, `sandboxFacts` JSONB, `artifactHash`); escritura con valores ya saneados y cerrados a la lista de §6.16; (B) sin migración: facts/generación `null` en todo (incumple el criterio 2 y vacía la evidencia).
**Recomendación:** A. `sandboxFacts` guarda solo conteos y banderas (nunca `testCases`).

### DEC-EVID-004 — IDEA-016: corte previo dentro de 027 o WI aparte
**Estado:** PROPOSED · **Veredicto:** DECISION_REQUIRED
**Blocks:** `WI-CORE-027` (todo corte que exponga `failureMessage`/`failureCode`).
**Opciones:** (A) corte A de 027, previo y bloqueante (helper ampliado y probado, `code` validado, log saneado, guarda de escritura, validación de `category`); IDEA-015 `errorSummary` sigue como WI aparte; (B) WI aparte para IDEA-016 completo, 027 espera; (C) diferir y exportar `failureMessage` `null`.
**Recomendación:** A. Es pequeño, el helper ya declara que 027 es su segundo consumidor, y un WI aparte añadiría ceremonia sin reducir riesgo. Bloquea: sí, a los cortes de evidencia con `sandbox`.

### DEC-EVID-005 — Identificadores derivados en EXPERIMENT y `snapshotRef`
**Estado:** PROPOSED · **Veredicto:** DECISION_REQUIRED
**Blocks:** `WI-CORE-027` (campos `retrievalId`, `contextId`, `snapshotRef`).
**Hecho:** §6.16 prohíbe «otros identificadores»; el RAG de experimento no tiene `retrieval_id`/`context_id`; `snapshotRef` debe ser opaco y nunca URL firmada.
**Opciones:** (A) `retrievalId = contextId = ContextTrace.id` (id existente, estable por intento) y `snapshotRef` = UUIDv5 determinista de `urn:tjc:snapshot-ref:v1:{projectVersionId}:{headSha}` (ANALYSIS_RUN) sin clave de storage; (B) generar UUID nuevos por repetición (identificadores nuevos, contradice §6.16); (C) exponer la clave de storage.
**Recomendación:** A.

### DEC-EVID-006 — `failureStage/Category/Code/Message` en repeticiones que terminan `COMPLETED` con pruebas fallidas
**Estado:** PROPOSED · **Veredicto:** DECISION_REQUIRED
**Blocks:** `WI-CORE-027` (valores de `sandbox.facts.failure*` en OE5).
**Hecho:** `failure` es `NULL` si el Sandbox responde `COMPLETED` aunque `failureType = TEST_ASSERTION`.
**Opciones:** (A) `failureCategory = failureType` (validado, sin `NONE`) y `failureStage/Code/Message = null`; (B) todo `null` salvo que exista `failure` persistido; (C) sintetizar `stage`.
**Recomendación:** A: `failureType` es un hecho observado y no se inventa `stage`/`code`.

## Cortes propuestos
1. **A — Saneado (IDEA-016, DEC-EVID-004):** helper ampliado (casos negativos y de idempotencia), validación de `code` y `category`, log de `sandbox-execution.service.ts:223-225`, guarda de escritura. Sin contrato ni migración. Bloquea B–D.
2. **B — Persistencia y captura (DEC-EVID-003):** migración aditiva y captura en `analysis-run-validation-job.handler.ts` y `experiment-job.handler.ts` de ejecución, hechos, generación y hashes; extender `SandboxExecutionResult` con `correlationId`/`requestId`/`durationMs`. Pruebas con PostgreSQL real.
3. **C — Ensamblado y rutas:** `EvidenceBundleService` con tres ensambladores (ANALYSIS_RUN reutiliza el colaborador del trace), tres rutas Reader, 404/409, prueba de esquema estable (snapshot), prueba de claves prohibidas. Requiere DEC-EVID-002/005/006 y contract-reviewer.
4. **D — Jerarquía de agregados (DEC-EVID-001) y cierre:** ajuste de `StrategyMetricsResponse` según la decisión; INTEROP §6.16 `/evidence` a **Implementado** (línea 14, línea ~913/§6.13 «`/evidence` sigue pendiente», línea ~1132, línea ~1379), CHANGELOG, Contract Sync a Console (WI-CONSOLE-017) y, si DEC-EVID-001 es B, §6.5.

## Pruebas, migración e impacto contractual
- Nuevas: `evidence-bundle.service.spec.ts` (por kind, nulos, `NOT_APPLICABLE`, no evaluables), `evidence.controller` (200/404/409, metadato Reader), `evidence-bundle.schema.spec.ts` (snapshot con reloj y UUID fijos; las llaves se verifican sin `toMatchSnapshot` sobre datos variables), `sanitize-failure-message.util.spec.ts` (ampliado: una fila por patrón de H4, redactar-antes-de-truncar, idempotencia), `experiment-failure-fact.spec.ts` (`code`), `sandbox-execution.service.spec.ts` (log saneado), specs de handlers de captura, `analysis-trace.repository` y `experiment-runs.repository` (nuevas columnas, filas previas `null`), `experiments.service.spec.ts` (DEC-EVID-001), integración PostgreSQL de la migración y rollback.
- Contrato: `contractImpact=true`, `publishesContract=true`. Cambia §6.16 (DEC-EVID-002), posiblemente §6.5 (DEC-EVID-001) y su estado; Contract Sync a Console; ninguno a Sandbox ni GitHub Integration.

## Verificaciones reales pendientes (no ejecutadas)
Migración y rollback en PostgreSQL real, pruebas de rendimiento del ensamblado de experimento, `lint`, `test`, `build` y `node harness/validate-harness.mjs` por corte, y los cuatro checkpoints de Contract Sync.

## Handoff
`status`: DECISION_REQUIRED · `blockers`: DEC-EVID-001…006 (001 solo el corte D; 004 el corte A y los que exponen `failure*`) · `filesAffected`: este reporte y `spec/transversal/experimental-metrics/plan.md` · `recommendedNextStep`: el usuario decide DEC-EVID-004 y 003 (habilitan A y B), luego 002/005/006 con el `contract-reviewer`, y 001 antes del corte D.
