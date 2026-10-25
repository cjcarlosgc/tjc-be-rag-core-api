# WI-CORE-098 — verificación SDD
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

**Veredicto: SUFFICIENT** (V1 sin contrato es posible). Una elección de diseño que el leader debe mostrar al usuario porque difiere de la frase literal del alcance («deja el intento sin generar»): en Experiments la compuerta se evalúa **una vez por experimento, antes de cualquier brazo**, y detiene el experimento completo (ver §2.2). Nada exige código de error, campo, enum ni migración nuevos. Solo `DECISION_REQUIRED` si el usuario prefiere rechazar en `POST /experiments` (exigiría código nuevo; ver §2.3).

Todas las citas son `archivo:línea` de `app/src/` leídas hoy.

## 1. Definición operativa de D-5 con los datos que llegan hoy

Datos en `acquireGenerationContext` (`generation/test-generation-pipeline.ts:58-88`): `retrieval` (`targetChunks`, `candidates`), `functionalRules` (local, ACTIVE del `targetRef`, **sin recortar por presupuesto**), `dependencyContext` y `generationContext` ya construido por `ContextBuilder.build` (`retrieval/context-builder.service.ts:50-229`). Para el target `ContextBuilder` calcula `target.content` como unión de `targetChunks[].content` (`:60-62`), el mínimo y el score por candidato (`:64-92`) y deja en `audit.candidates[].discardReason` el motivo `BELOW_MINIMUM_SCORE` (`:100-102`).

**(a) «Sin código del target».** `generationContext.target.content.trim() === ''`.
- Lo que ya cubre `UNRESOLVABLE_TARGET`: `RetrievalService.retrieve` lanza `AppException 409` si no hay ningún chunk (`retrieval/retrieval.service.ts:119-127`). Eso ocurre antes de la compuerta y no cambia (en Validation cae en el catch genérico; en Experiments, falla del intento).
- La compuerta cubre solo «hay chunk(s) pero sin contenido tras trim». Hoy es prácticamente inalcanzable, pero es la cláusula literal de D-5 y es barata. No usar `tokenCount` (puede ser 0 por mocks).
- No usar `retrieval.targetChunks` como entrada: el spec de Validation mockea `retrieve` con `{ targetChunks: [], candidates: [] }` (`validation/analysis-run-validation-job.handler.spec.ts:230-232`) y el de Experiments con chunks sin `content` (`experiments/experiment-job.handler.spec.ts:187-191`); evaluar sobre `retrieval` bloquearía casi toda la suite. Evaluar sobre el `generationContext` devuelto por `build` (mocks con `target.content` no vacío, `:76-110` y `:233-235`) no rompe nada.

**(b) «Ningún candidato sobre el mínimo».** `generationContext.audit.candidates.filter(c => c.discardReason !== 'BELOW_MINIMUM_SCORE').length === 0` (equivale a `eligible.length === 0`, `context-builder.service.ts:97-99`). Contados antes de `topK` y de presupuesto: un candidato que pasó el mínimo y luego cayó por `TOP_K_LIMIT`/`TOKEN_BUDGET` **sí cuenta** como «sobre el mínimo» (D-5 habla de relevancia, no de presupuesto).
- Con el default `RETRIEVAL_MINIMUM_SCORE=0` (`config/env.validation.ts:150`, `.env.example:35`; el builder lo toma de ConfigService, `:266-272`) todo score ≥ 0 pasa, así que (b) equivale a «cero candidatos recuperados». Con un mínimo > 0 es la regla plena. Declararlo en el spec (depende de configuración, que no cambia).
- Modos SE/SEM: generación solo usa SE (`retrieve` con `mode='SE'` por defecto, `retrieval.service.ts:99-104`). SEM solo existe en `retrieval-comparisons` (`retrieval-comparison-job.handler.ts:184,202`), que no llama a `acquireGenerationContext` ni a la compuerta. La compuerta se aplica al contexto SE y no afecta a OE2.

**(c) «Faltan reglas funcionales requeridas».** Definición implementable:
- *Requeridas* = `scenarioKey` de `readBehaviorConstructs(symbol.behaviorConstructs) ?? []` del `AnalysisSymbol` del target (`analysis-runs/persistence/analysis-symbols.repository.ts:37-46`; mismas construcciones que el evaluador usa para exigir regla, `functional-knowledge/functional-context-evaluator.service.ts:109-111,135-151`). Sin construcciones (o columna `null`: Runs previos) ⇒ no se requiere ninguna regla ⇒ (c) es falsa.
- *Presentes* = `scenarioKey` de las reglas **recuperadas** (variable local `functionalRules` de `acquireGenerationContext`, no `generationContext.functionalRules`, que ya excluye las omitidas por `TOKEN_BUDGET`, `context-builder.service.ts:145-163`).
- *Faltan* = existe una requerida que no está entre las presentes. Se compara solo por `scenarioKey` (el retriever ya filtra por `targetRef` exacto y ACTIVE, `retrieval/functional-rules.retriever.ts:50-56`; el scope lo fija el tipo de símbolo en el evaluador, `:27-29`).
- Cómo llega el dato sin cambiar contratos: Validation ya tiene `symbol` (`validation/analysis-run-validation-job.handler.ts:~275-322`); Experiments tiene `run.analysisRunId` (interno, `experiments.service.ts:~172-178`; spec 008 §«De forma aditiva e interna») y busca el símbolo con `AnalysisSymbolsRepository.findByAnalysisRun` (`analysis-symbols.repository.ts:85`) por `filePath` + `qualifiedName` (`methodName ? symbolName.methodName : symbolName`, igual que `functionalTargetRef`, `functional-rules.retriever.ts:12-19`). Sin `analysisRunId` (corridas antiguas) ⇒ requeridas = [].

**¿Es vacua la cláusula (c) en Validation?** Casi. El job de snapshot llama a `evaluate` y solo encola Validation si no hay `ACTION_REQUIRED` (`snapshot-intelligence/snapshot-analysis-job.handler.ts:400-410`); `evaluate` omite una construcción solo si hay regla ACTIVE con la misma clave o pregunta no OBSOLETE con esa clave (`functional-context-evaluator.service.ts:121-151`). Por tanto en Validation «requerida y sin regla ACTIVE» solo puede ocurrir por (i) pregunta histórica con `scenarioKey` nulo que «cubre todo el target» (`:127-129`), (ii) pregunta rastreada sin regla (carrera: regla `SUPERSEDED` o pregunta pendiente tras abstención `UNKNOWN`), (iii) construcciones persistidas distintas de las evaluadas. Y además debe cumplirse (b). Resultado: en Validation (c)∧(b) es extremadamente rara; el camino donde sí puede dispararse con naturalidad es **Experiments**, que no pasa por `evaluate` (el experimento se crea sobre cualquier símbolo `DIRECTLY_CHANGED`, `experiments.service.ts:114-123`) y donde las reglas pueden no existir. Riesgo aceptado y documentable: caso (i) podría sobre-bloquear (sin regla por clave pero pregunta histórica) solo si además no hay candidatos.

## 2. Compuerta, error tipado y paridad

### 2.1 Dónde y qué lleva
- Archivo nuevo `app/src/generation/context-sufficiency.ts`:
  - `class InsufficientGenerationContextError extends Error` (interno, no exportado por ningún módulo HTTP, no es `AppException`; no toca `ErrorCode`). Campos: `reason: 'TARGET_WITHOUT_CODE' | 'NO_RELEVANT_CANDIDATES_AND_MISSING_RULES'`, `missingScenarioKeys: string[]`, `eligibleCandidates: number`, `retrievedCandidates: number`. `message` fijo en español sin contenido de código ni claves de usuario: p. ej. «Contexto insuficiente: el target no tiene código indexado.» / «Contexto insuficiente: ningún candidato supera el mínimo de relevancia y faltan reglas funcionales requeridas del target.»
  - `assessContextSufficiency({ generationContext, retrievedRuleScenarioKeys, requiredScenarioKeys })` pura: devuelve `null` o el error (o lanza).
- `acquireGenerationContext` (`test-generation-pipeline.ts`): parámetro **opcional** `sufficiency?: { requiredScenarioKeys: string[] }` en `AcquireGenerationContextInput`. Si viene, tras `build` evalúa y lanza antes de devolver (no se devuelve `GenerationContext`). Sin el parámetro, comportamiento idéntico al actual (regresión cero por construcción, sin tocar `ContextBuilder` ni su `Pick`).
- `ContextBuilder.build` no cambia (siempre produce contexto; D-5 se aplica sobre su resultado).

### 2.2 Qué hace cada llamador
**Validation** (`generateAndValidate`, `analysis-run-validation-job.handler.ts:~373-551`):
- Pasa `sufficiency: { requiredScenarioKeys: <claves del símbolo> }` en la llamada de `:423-437`.
- Captura `InsufficientGenerationContextError` en una rama explícita **antes** del catch genérico (`:551`): `persistProposal(run, symbol, { relativePath, content: '', status: 'HELD', failureSummary: sanitizeFailureMessage(error.message), contextId: null, generation: null })` y `return { symbol, kind: 'TECHNICAL_GENERATION_FAILURE' }` (sin `platformFailure`). Precedente exacto del mismo patrón: la rama «sin framework» (`:294-308`), que persiste HELD con `content ''` y sale con `TECHNICAL_GENERATION_FAILURE`. Sin LLM ni Sandbox (la excepción ocurre antes de `buildTestPrompt`/`generate`/`execute`, `:441-461`).
- Efecto en el Run: `classifyRun` (`:~583-606`) lo cuenta como `TECHNICAL_GENERATION_FAILURE` no de plataforma ⇒ Run `TECHNICAL_GENERATION_FAILURE` (precedencia DEC-VAL-002 intacta: sigue por debajo de `BEHAVIORAL_MISMATCH`). No se añade `SymbolOutcome.kind`, estado ni código.
- No se persisten `AnalysisRetrieval`/`AnalysisContext` para ese símbolo: `persistTraceEvidence` (`:658-692`) se ejecuta después de `acquire`, y D-5 dice que no se produce contexto. La evidencia es la propuesta HELD con `failureSummary`.
- Contradicción declarada spec↔D-5: la propuesta (CT-05-A5) dice «ACTION_REQUIRED»; V1 deja `TECHNICAL_GENERATION_FAILURE` con propuesta HELD (limitación V2, ya aprobada).

**Experiments** — paridad entre brazos (spec 008: «mismas condiciones» y DEC-EXP-FK-001, `system-contract.md:409-413`):
- Hecho: un `ExperimentRun` es **un target** con 3 pares RAG/GENERALIST (`experiment-job.handler.ts:~259-268`). El brazo agente no usa ContextBuilder (`runAgentArm`, `:1113`). Si la compuerta se pusiera dentro de `runRagArm` (`:1015-1043`) caería en `recordAttemptFailure` (`:950-996`): repetición RAG `FAILED`/`UNKNOWN`/`valid:false`, no externa, sin reintento ⇒ **se contaría como fallo atribuible a la estrategia** mientras el agente sigue y puede pasar: sesgo directo en CF/CO/VT de OE5. Descartado.
- Solución V1 (paridad por construcción): **pre-chequeo único por experimento, antes de cualquier intento** (después de cargar `version`/`target`, antes de `objectStorageService.get(snapshotKey)` y del `pairSchedule`, `experiment-job.handler.ts:~213-240`). El handler llama una vez a `acquireGenerationContext(..., sufficiency: { requiredScenarioKeys })` y descarta el resultado (solo lectura de BD, sin embeddings externos: `findSimilarByEmbedding` usa el embedding del chunk ancla; sin LLM ni Sandbox). Los brazos siguen llamando `acquire` **sin** `sufficiency`, así que su contexto no cambia.
  - Si lanza `InsufficientGenerationContextError`: `markFailed(experimentId, 'EXPERIMENT_FAILED', sanitizeFailureMessage(error.message))` (código y repositorio ya existentes, `experiment-runs.repository.ts:320-334`; `failureMessage` ya se expone, `experiment-status.presenter.ts:21-22`), `experimentRealtime.statusChanged`, y `return` **sin relanzar** (no reintento del job). No se crean repeticiones ni `ContextTrace` (el pre-chequeo va antes de `beginAttempt`, `:~599`), ni se invoca LLM/Sandbox. `GET /experiments/{id}/results` ya acepta `FAILED` (`experiments.service.ts:230`), con repeticiones vacías.
  - Si el pre-chequeo lanza **otro** error (p. ej. `UNRESOLVABLE_TARGET`, fallo de BD): se registra y se continúa con el flujo normal sin cambios (preserva el comportamiento actual por intento).
  - Ningún estado, `failureType`, `failureCode` ni tipo de fallo nuevos; VT/CF/CO no se alteran porque no se registra ninguna repetición. Un experimento bloqueado es «caso no evaluable» (no fallo de estrategia, no se repite); hay que decirlo en el protocolo de OE5.
- No hay asimetría: o corren ambos brazos o ninguno. Matiz declarado: DEC-EXP-FK-001 ya acepta asimetría de información (solo RAG recibe reglas); la compuerta no la modifica, solo decide si el **caso** es evaluable para ambos.
- Límite conocido: reglas que cambien entre el pre-chequeo y un intento (minutos) no se re-evalúan; ya hoy cada intento relee reglas.

### 2.3 Opciones descartadas (exigirían cambio de contrato; V1 no las permite)
- Rechazar en `POST /experiments`: requeriría `ErrorCode` nuevo (u overload semántico de `UNRESOLVABLE_TARGET`/`ANALYSIS_NOT_FINISHED`, incorrecto) ⇒ cambio de contrato. Si el usuario lo prefiere más adelante: `DECISION_REQUIRED` con recomendación de mantener V1.
- Marcar ambos brazos como repeticiones `FAILED` (6 filas): contamina VT/CF/CO. Descartado.
- Estado `ACTION_REQUIRED` en Validation (V2): cambia motivo/estado de Console ⇒ fuera de alcance.

## 3. Efectos en métricas y trazas
- Llamadores de `acquireGenerationContext`: solo `validation/analysis-run-validation-job.handler.ts:423` y `experiments/experiment-job.handler.ts:1027` (más el pre-chequeo nuevo). `RetrievalService` directo (comparaciones, bundle de evidencia) no pasa por aquí.
- `contextTokens`, `retrievedChunks`, `selectedChunks`, `audit` y `ContextTrace`: sin cambio en los casos que hoy no bloquean (el contexto se construye igual y solo se inspecciona). En los bloqueados no hay `GenerationContext`, `AnalysisRetrieval`/`AnalysisContext` ni `ContextTrace` (Validation: nada tras la excepción; Experiments: pre-chequeo antes de `beginAttempt`).
- `initializeTraceDetail` (`:1079-1111`) usa `build` con retrieval vacío solo para el esqueleto; no pasa por la compuerta.
- Tests que protegen la regresión cero (deben seguir en verde sin cambios de expectativa): `retrieval/context-builder.service.spec.ts` (todo; el builder no cambia), `validation/analysis-run-validation-job.handler.spec.ts` (`:391,411,634,1188,1216,2406,2423,2504`: el símbolo por defecto tiene `behaviorConstructs: null`, `:60`), `experiments/experiment-job.handler.spec.ts` (suite completa con la salvedad de abajo), `retrieval/php-dependency-replay.spec.ts`, `analysis-runs/persistence/analysis-trace.repository.pg.spec.ts`, `retrieval-comparisons/retrieval-comparison-job.handler.spec.ts`.
- Salvedad de pruebas existentes en Experiments: el pre-chequeo añade **una** llamada a `retrieve`/`functionalRulesRetriever.retrieve`/`contextBuilder.build` por experimento. Hay que ajustar las aserciones de conteo en `experiment-job.handler.spec.ts:1347` (3→4), `:1497-1502` (3→4 y el filtro de `build`) y `:4907` (índice de `contextCalls`), y añadir el repositorio de símbolos al constructor (nuevo parámetro **al final** para no desplazar los demás, `:372-391`).

## 4. Plan de pruebas (para el implementer)
Archivos y líneas aproximadas:

| Archivo | Cambio | ≈ líneas |
|---|---|---|
| `app/src/generation/context-sufficiency.ts` (nuevo) | error interno + `assessContextSufficiency` | 70 |
| `app/src/generation/test-generation-pipeline.ts` | parámetro opcional `sufficiency` y llamada tras `build` | 25 |
| `app/src/validation/analysis-run-validation-job.handler.ts` | claves requeridas del símbolo, `sufficiency` en la llamada, rama de captura | 35 |
| `app/src/experiments/experiment-job.handler.ts` | dep `AnalysisSymbolsRepository` (final del constructor), pre-chequeo y parada | 60 |
| `app/src/experiments/experiments.service.ts` | texto G-03 (1 línea, §5) | 1 |
| `app/src/generation/context-sufficiency.spec.ts` (nuevo) | ramas D-5 | 160 |
| `app/src/generation/test-generation-pipeline.spec.ts` (nuevo) | opt-in de la compuerta, regresión sin `sufficiency` | 90 |
| `validation/analysis-run-validation-job.handler.spec.ts` | bloqueo, no bloqueo, sin LLM/Sandbox | 130 |
| `experiments/experiment-job.handler.spec.ts` | bloqueo del experimento, paridad, ajuste de 3 conteos | 160 |
| `experiments/experiments.service.spec.ts` | texto G-03 (aserciones nuevas) | 10 |
| Docs: `spec/features/004-rag-retrieval-context/{spec,plan,tasks}.md` (ST-CORE-115), `013-pr-driven-analysis/spec.md` (OC04: V1 deja HELD, V2 limitación), `008-experimental-comparison/{spec,plan}.md` (experimento no evaluable), `CHANGELOG.md` | consolidación | 40 |

Casos de `context-sufficiency.spec.ts` (puros, sin mocks de Nest):
1. Target con código, candidatos presentes, sin requeridas ⇒ no bloquea.
2. Target con `content` vacío o solo espacios ⇒ bloquea `TARGET_WITHOUT_CODE`, aunque haya candidatos y reglas.
3. Sin candidatos elegibles y sin requeridas (`requiredScenarioKeys: []`) ⇒ **no** bloquea (cláusula b sola).
4. Con requeridas faltantes pero ≥1 candidato elegible ⇒ **no** bloquea (cláusula c sola).
5. Sin candidatos elegibles y requeridas faltantes ⇒ bloquea `NO_RELEVANT_CANDIDATES_AND_MISSING_RULES` con `missingScenarioKeys`.
6. Sin candidatos elegibles, requeridas todas presentes ⇒ no bloquea.
7. Parcial: dos requeridas, una presente ⇒ bloquea solo si (b); `missingScenarioKeys` = la ausente.
8. Candidatos todos `BELOW_MINIMUM_SCORE` (mínimo 0.5, `build` real con ConfigService) ⇒ cuentan como no elegibles; un candidato con score igual al mínimo cuenta como elegible (límite, ya probado en `context-builder.service.spec.ts:263`); candidato `TOP_K_LIMIT`/`TOKEN_BUDGET` cuenta como elegible.
9. Reglas recuperadas pero omitidas por presupuesto (`generationContext.functionalRules` vacío, `retrieved` > 0) ⇒ cuentan como presentes (se usa la lista recuperada).
10. Modos: contexto construido con candidatos SE (semántico + estructural) y solo-semántico produce el mismo resultado; SEM no pasa por la compuerta (documentarlo con una prueba de que `retrieval-comparison` no la invoca no es necesario; basta no tocarlo).

`test-generation-pipeline.spec.ts`: sin `sufficiency` no lanza aunque target vacío/sin candidatos (regresión); con `sufficiency` lanza y no devuelve contexto.

Validation: (i) target vacío ⇒ propuesta `HELD` con `failureSummary` «Contexto insuficiente…», `llmProvider.generate` y `sandboxExecutionService.execute` sin llamadas, `persistTraceEvidence` sin llamadas (`upsertRetrieval`/`upsertContext`), Run `TECHNICAL_GENERATION_FAILURE`; (ii) símbolo con `behaviorConstructs` y sin reglas, sin candidatos ⇒ bloquea; (iii) lo mismo con un candidato ⇒ genera (flujo actual); (iv) `behaviorConstructs: null` y cero candidatos ⇒ genera; (v) un símbolo bloqueado y otro `AVAILABLE` ⇒ Run `TECHNICAL_GENERATION_FAILURE` (precedencia intacta); (vi) un símbolo con `BEHAVIORAL_MISMATCH` + uno bloqueado ⇒ `BEHAVIORAL_MISMATCH`.

Experiments: (i) pre-chequeo bloquea ⇒ `markFailed(id, 'EXPERIMENT_FAILED', mensaje saneado)`, `insertRepetition`/`beginAttempt` sin llamadas, `llmProvider.generate`, `generalistAgentService` y `sandboxExecutionService.execute` sin llamadas, `objectStorageService.get` sin llamada, el job no relanza; (ii) **paridad**: en el bloqueo ningún brazo corre (RAG y GENERALIST_AGENT), y en el no bloqueo corren ambos (6 repeticiones); (iii) pre-chequeo que lanza `UNRESOLVABLE_TARGET` ⇒ flujo actual intacto; (iv) corrida sin `analysisRunId` ⇒ requeridas [] ⇒ no bloquea salvo target vacío; (v) los brazos llaman `acquire` sin `sufficiency` (el contexto de cada intento no cambia; `build` recibe los mismos argumentos que hoy).

## 5. G-03
- Texto propuesto (mismo `ErrorCode.REASONING_EFFORT_UNSUPPORTED`, mismo 422, mismo `details` `{ model, requestedEffort, supportedEfforts }`, `experiments.service.ts:341-352`): `La temperatura configurada no es compatible con el esfuerzo de inferencia solicitado para el modelo "${error.model}". Use esfuerzo "none" o quite la temperatura.` (sin «razonamiento» ni proveedor; conserva «temperatura» y `"none"`).
- Referencias al texto actual (literal `incompatible con el razonamiento activo del modelo`): **solo** `experiments.service.ts:344`. Pruebas que lo tocan: `experiments/experiments.service.spec.ts:245-275` (aserta `toContain('temperatura')` y `toContain('"none"')`: siguen pasando; añadir aserción de que no contiene «razonamiento») y `experiments/experiments.model-config.spec.ts:97-118` (aserta código y `details`, no el mensaje). Sin referencias en Console (`tjc-fe-rag-developer-console/src` y su spec no contienen el literal ni el código).
- No es contrato: `spec/contracts/system-contract.md:475` e `interoperability-contract.md:387` describen la **condición** («temperatura incompatible con razonamiento activo») y `details.supportedEfforts`, no el texto del mensaje; `spec/features/008-experimental-comparison/plan.md:60`, `spec/transversal/providers/spec.md:39` y el CHANGELOG igual. El texto no aparece en `spec/contracts/` ni en esquemas. No es `DECISION_REQUIRED`. Opcional (no hacer): los mensajes internos de `LLMConfigurationError` en `providers/openai-llm.provider.ts:187` y `providers/testing/fake-llm.provider.ts:192` también dicen «razonamiento activo» pero **no** salen por el 422 (el servicio construye el suyo) y están fuera del alcance aprobado.

## 6. Contratos y decisiones
- Sin cambio de contrato: grep de «contexto insuficiente», D-5 y ACTION_REQUIRED en `spec/contracts/` no encuentra una cláusula de D-5; ACTION_REQUIRED solo se define por falta de conocimiento funcional detectada por el evaluador (`spec/features/013-pr-driven-analysis/spec.md` OC04). La compuerta V1 no cambia rutas, DTO, enums, `ErrorCode`, eventos, esquema, variables de entorno ni migraciones. Ningún efecto en Integration/Sandbox/Console.
- Decisiones PENDING/PROPOSED encontradas: `DEC-RAG-001` (test-aware; `Blocks` solo un WI futuro de ranking test-aware, `spec/features/004-rag-retrieval-context/spec.md:29`) y `DEC-VAL-001` (empresarial; `Blocks` ingestión/producción con código empresarial, `system-contract.md:303`). Ninguna alcanza WI-CORE-098. Aplicables y ya aprobadas: D-5 (propuesta de aserciones, 2026-10-23), DEC-VAL-002, DEC-EXP-FK-001, DEC-FK-003.
- Contradicciones spec↔código a documentar: (1) CT-05-A5 dice «ACTION_REQUIRED» y V1 produce HELD + `TECHNICAL_GENERATION_FAILURE`; (2) spec 004 dice que `GenerationContext` «conserva target, relatedChunks…»: añadir que la generación no se invoca con contexto insuficiente; (3) spec 008 no contempla un experimento que termine `FAILED` sin repeticiones.
- Harness: registrar en `harness/state.json` los IDs aplicables (DEC-VAL-002, DEC-EXP-FK-001, DEC-FK-003); `contractImpact: false`.

## 7. Riesgos y qué NO hacer
- Sesgo OE5 si la compuerta vive dentro de `runRagArm`: no hacerlo; usar el pre-chequeo por experimento.
- No modificar `ContextBuilder.build` ni su firma/`Pick` ni su salida; no añadir campos a `GenerationContext`, `audit` o `ContextTrace`.
- No lanzar `AppException`, no tocar `ErrorCode`, no añadir `SymbolOutcome.kind`, `failureType` ni estado de Run/Experiment/repetición.
- No evaluar sobre `retrieval` (rompe suites con mocks vacíos) ni sobre `generationContext.functionalRules` (excluye reglas omitidas por presupuesto).
- No relanzar el error en el handler de Experiments (reintentaría el job); no registrar repeticiones.
- Riesgo residual: sobre-bloqueo (c)∧(b) por pregunta histórica sin regla; con `RETRIEVAL_MINIMUM_SCORE=0` la cláusula (b) equivale a «cero candidatos»; en Validation (c) es casi vacua por el evaluador. Declararlo en spec 004 y en el informe de cierre.
- Riesgo de proceso: ≥3 aserciones de conteo en el spec de Experiments cambian (3→4); el resto de pruebas no debe necesitar cambios (señal de regresión si lo necesita).
- Para el protocolo OE5 (cross): un experimento `FAILED` con `failureMessage` «Contexto insuficiente…» y cero repeticiones es «caso no evaluable», no resultado ni fallo de estrategia, y no se reintenta.
