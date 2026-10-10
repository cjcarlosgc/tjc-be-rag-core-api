# experimental-metrics — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Guardar métricas por repetición, configuración del modelo y estrategia. No calcular conclusiones académicas dentro del backend; exponer datos/agregados reproducibles.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.

## Corte SMART V3

`WI-CORE-027` depende de `WI-CORE-007`, `WI-CORE-025` y `WI-CORE-026`.

## Diseño técnico SMART V3 (WI-CORE-027)

El bundle de evidencia se compone por `kind`: `ANALYSIS_RUN` puebla `analysisRun`, `retrieval`, `context`, `generation`, `sandbox` y `publication`; `EXPERIMENT` puebla `experimental`, `generation`, `agentExploration`, `sandbox` y `retrieval`/`context` del brazo RAG, con `analysisRun` nulo; `RETRIEVAL_COMPARISON` puebla `retrieval`, con `analysisRun` nulo. `sandbox.facts` se limita a la lista cerrada `executionProfile`, `runner`, `compiled`, `executed`, `passed`, `totalTests`, `passedTests`, `failedTests`, `skippedTests`, `testCasesTruncated`, `failureStage`, `failureCategory`, `failureCode` y `failureMessage` (saneado), derivada de `RunnerFacts` y `SandboxFailureFact`; nunca logs, evidencias ni URLs. Estados: la evidencia de un `AnalysisRun` está disponible en cualquier estado salvo `QUEUED` y `PROCESSING`; experimento y comparación, en `COMPLETED` y `FAILED`; en otro caso `409 EVIDENCE_NOT_FINISHED`. `snapshotRef` es una referencia interna opaca y `artifactHash` el SHA-256 del artefacto. Se añade una prueba de esquema estable (snapshot) del bundle. La jerarquía CF/CO/VT se documenta en `spec.md` de esta transversal.

## Detalle técnico verificado (WI-CORE-027)

Verificado contra el código existente (WI-CORE-007, 025 y 026); el informe con hallazgos y decisiones está en `harness/reports/wi-core-027-sdd-verification.md`. **Vigente** es lo que se deriva de los criterios aprobados y de §6.16; lo marcado **PROPUESTA** depende de una decisión PROPOSED (DEC-EVID-001…006) y no es comportamiento vigente.

### Vigente

1. **Rutas y estados.** `GET /analysis-runs/{id}/evidence`, `GET /experiments/{id}/evidence` y `GET /retrieval-comparisons/{id}/evidence` (Reader; `@RequireProjectRole('READER', …)` como `/trace`). 404 de la ruta de estado homónima; `409 EVIDENCE_NOT_FINISHED` en `QUEUED`/`PROCESSING` (AnalysisRun) y en `PENDING`/`RUNNING` (experimento, comparación); `COMPLETED` y `FAILED` de experimento y comparación son terminales y responden 200 (una comparación `FAILED` devuelve `retrieval: []`). `403 PROJECT_ROLE_INSUFFICIENT` no es alcanzable con Reader como rol mínimo. `correlationId` es el valor de `x-correlation-id` (lo garantiza el middleware) y `generatedAt` es el instante de ensamblado; ninguno se persiste.
2. **Ensamblado por mapeo explícito.** El bundle se construye campo a campo; nunca se copian JSONB crudos (`ContextTrace.detail` incluye `excerpt` de código; `testCases` incluye mensajes de error). `ANALYSIS_RUN` reutiliza el ensamblado del trace de WI-CORE-026 (targets, retrieval, context, executions, `toPublication`); `EXPERIMENT` lee solo el intento vigente de cada repetición y sus trazas; `RETRIEVAL_COMPARISON` lee `retrieval_comparison_results` y no exporta `groundTruth`.
3. **Procedencia de cada sección.** `retrieval`: `analysis_retrievals` (Run), `ContextTrace.detail` RAG (experimento) o `retrieval_comparison_results` (comparación). `context`: `analysis_contexts` o `detail.candidates[].decision` + `detail.functionalRules.functionalRuleIds`; no se exponen conteos, omitidas ni `knowledgeId`. `generation`: `strategy: PRODUCT` en el Run; en el experimento, `modelConfig` + tokens y `generationDurationMs` de la repetición. `agentExploration`: `detail.budget` y `trajectory` de trazas AGENT (`step`, `toolName`, `status`; sin argumentos, resultados ni razonamiento). `sandbox`: por ejecución. `experimental`: por repetición vigente. `publication`: la del trace; `null` fuera de ANALYSIS_RUN. Un dato no observado es `null`, nunca `0` ni cadena vacía.
4. **`sandbox.facts`.** Objeto con exactamente las 14 claves cerradas del plan; construido por función explícita, nunca spread. `failureMessage` pasa por `sanitizeFailureMessage` también al leer (el helper es idempotente y cubre filas persistidas con reglas anteriores). No se exportan `testCases`, logs, evidencias ni URLs.
5. **Jerarquía CF/CO/VT.** El bundle y los DTO no contienen CF ni CO ni ganador ni significancia; `valid` no se exporta en el bundle y no se usa para derivar CF/CO. Los agregados de `StrategyMetricsResponse` ya excluyen `technicallyEvaluable=false` (WI-CORE-025); `validRate`, `compilationRate`, `executionRate` y `passedRate` son diagnóstico técnico, y tokens, costo, duraciones, `toolCalls` y archivos son descriptivos. Precision@k y Recall@k solo existen en OE2 (comparación de retrieval).
6. **Prueba de esquema estable.** Snapshot de las claves y tipos del bundle por kind con reloj y UUID inyectados; falla ante cualquier clave nueva sin subir `schemaVersion`. Una prueba adicional recorre el bundle y exige ausencia de `excerpt`, `content`, `url`, `signedUrl`, `storageKey`, `EV-OE`, `chainOfThought`, `reasoning` y credenciales de muestra.
7. **Límites.** Sin llamadas externas ni al Sandbox al exportar; solo lectura. Sin cambio de contexto entregado al LLM.

### Decisiones DEC-EVID (aprobadas por el usuario el 2026-10-09, salvo `DEC-EVID-001`)

Estado: `DEC-EVID-001` a `007` **APROBADAS** el 2026-10-09 por el usuario en chat (`DEC-EVID-001`: opción A, «null + contadores»; sin decisiones pendientes). `DEC-EVID-004` se amplía por decisión del usuario para incluir `IDEA-015` en el corte A: validar `failure.category` y sanear `errorSummary`/`failureSummary` (en escritura y al mapear el DTO de `/results`); cambia el contenido, no la forma de `/results` (sin cambio de DTO ni de INTEROP salvo una nota).

- **DEC-EVID-001** (APROBADA 2026-10-09, usuario, opción A «null + contadores») — con cero slots evaluables, `validRate` y las demás tasas (y las medias de duración) pasan a `number | null` y se añaden contadores `evaluableRepetitions`/`nonEvaluableRepetitions`; alternativa: mantener `0`. Toca §6.5 y exige Contract Sync.
- **DEC-EVID-002** (APROBADA 2026-10-09, usuario) — enmienda aditiva de §6.16: `experimental[].technicallyEvaluable`, `| null` en `durationMs`/`requestId`/`correlationId`/`artifactHash`/`executionId`, claves de unión `repetition`/`strategy` en `sandbox[]` y `generation[]`, y `retrieval[].metrics` (OE2).
- **DEC-EVID-003** (APROBADA 2026-10-09, usuario) — una migración aditiva, reversible y sin backfill: `analysis_run_executions` (`requestId`, `correlationId`, `durationMs`, `facts`, `failure`), `generated_test_proposals` (`generation`) y `experiment_repetitions` (`sandboxExecutionId`, `sandboxRequestId`, `sandboxCorrelationId`, `sandboxFacts`, `artifactHash`). Hoy esos datos no se persisten; sin esta migración la evidencia saldría vacía.
- **DEC-EVID-004** (APROBADA 2026-10-09, usuario) — corte previo A dentro de 027 que amplía el saneado (IDEA-016): helper (Slack `xox`, Stripe `sk_live_`/`sk_test_`, Google `AIza`, `npm_`, `Cookie`/`Set-Cookie`, `credential|auth|signature=`, `password hunter2` sin separador, secretos en la ruta de una URL), validación y redacción de `code`, log de `sandbox-execution.service.ts` saneado, guarda en el límite de escritura de `failure` y validación de `category`; bloquea los cortes que exponen `failure*`. IDEA-015 (validar `failure.category` y sanear `errorSummary`/`failureSummary`) **queda incluida** en este corte por decisión del usuario (2026-10-09).
- **DEC-EVID-005** (APROBADA 2026-10-09, usuario) — `retrievalId = contextId = ContextTrace.id` en EXPERIMENT y `snapshotRef` = UUIDv5 determinista de `urn:tjc:snapshot-ref:v1:{projectVersionId}:{headSha}` (nunca clave de storage ni URL).
- **DEC-EVID-006** (APROBADA 2026-10-09, usuario) — repetición `COMPLETED` con pruebas fallidas: `failureCategory = failureType` (validado, sin `NONE`) y `failureStage`/`failureCode`/`failureMessage` `null`.

### Cortes (propuestos)

A saneado (IDEA-016) → B persistencia y captura (migración) → C ensamblado, rutas, snapshot y claves prohibidas → D agregados (DEC-EVID-001), INTEROP §6.16 `/evidence` a Implementado (cabecera línea 14, nota de la matriz de roles §6.13, §6.16 y la nota final de estados), CHANGELOG y Contract Sync a Console.

### Notas de la ampliación de DEC-EVID-004 (IDEA-015 en el corte A)
Criterio del leader sobre `contractImpact`: sanear `errorSummary`/`failureSummary` y validar `failure.category` (valor fuera de `FailureType` pasa a `UNKNOWN`, que ya pertenece al enum) cambia solo el contenido de campos ya emitidos (redactados y truncados a 500) y no la forma de `/results`: sin enmienda de DTO ni Contract Sync propio; se documenta con una nota en INTEROP al cerrar. El saneado se aplica al persistir y de nuevo al mapear (idempotente) para cubrir filas previas. No requiere decisión adicional del usuario y no bloquea B ni C.

### DEC-EVID-007 y ampliación de DEC-EVID-002 (APROBADAS 2026-10-09, usuario; condición C1 del contract-reviewer)
- **DEC-EVID-007:** «Permitir null». El bundle declara `retrieval[].config` con un tipo propio (no alias de §6.15): `{ semanticTopK: number | null; finalTopK: number | null; semanticWeight: number | null; structuralWeight: number | null; embeddingModel: string | null }`, con `null` cuando el dato no se persistió. Sin `config` sintético, sin cambiar §6.15 y sin columnas extra.
- **Ampliación de DEC-EVID-002:** `pairId`, `pairPosition` y `randomizationSeed` de `experimental[]` y `generation.provider`/`generation.model` pasan a `| null` (experimentos y filas previos a OE5/027). `sandbox[].strategy` es `ExperimentStrategy | 'PRODUCT'` (no nulo; `PRODUCT` para un `AnalysisRun`).
- `schemaVersion` se mantiene en `'1'` (el bundle nunca se ha emitido). La prueba de claves prohibidas añade `groundTruth`, `testCases` y `knowledgeId`.
- Calendario contractual (contract-reviewer, `wi-core-027-contract-review.md`): §6.16 no se declara «Implementado» hasta decidir `DEC-EVID-001`; Contract Sync a Console al cerrar el corte C con el contrato congelado.

### DEC-EVID-001 (APROBADA 2026-10-09, usuario: «para eso respondo A sí»)
Sin slots evaluables, las tasas (`validRate`, `compilationRate`, `executionRate`, `passedRate`) y las medias de duración de `StrategyMetricsResponse` pasan de `0` a `number | null`; se añaden los contadores `evaluableRepetitions` y `nonEvaluableRepetitions`; `0` solo significa cero real. Cambia el contrato de §6.5 (y la nota de §6.5.1 «sin slots evaluables las tasas valen 0»): requiere ratificación del contract-reviewer del texto exacto (incluido el tipo de duraciones y tokens/costo, que ya eran `null`) y Contract Sync a Console (CS-3), que debe mostrar «sin datos» ante `null`. Se desbloquea el corte D.
