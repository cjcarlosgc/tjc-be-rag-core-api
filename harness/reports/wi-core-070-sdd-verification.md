Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-070 — verificación SDD y diseño de refactor

Estado: DECISION_REQUIRED solo para F3; el resto es APPROVED (refactor sin cambio de comportamiento).

## 1. Mapa de `runAttempt` (experiment-job.handler.ts 475-821)

Orden de efectos (preservar exacto):
1. `attemptStartedAt = new Date()`.
2. `contextTracesRepository.beginAttempt(...)` (DB). Fuera del try: si falla, propaga.
3. `startHeartbeat(begun.repetition.id)` (timer; se detiene en `finally`).
4. Estado compartido inicial: `workspace`, `generationStart`, `generationDurationMs`, `generation` (default vacío), `externalFailure`, `finalized`, `sandboxEvidence`, `artifactHash`, `artifact`.
5. try:
   a. `initializeTraceDetail` (DB: updateDetail; en AGENT también updateAgentCounters).
   b. `zipExtractionService.extract(snapshotBuffer)`.
   c. `phpPlacement` (solo PHP; `existsSync` sobre el workspace).
   d. Generación con `withTimeout(maxDurationMs)`: `runRagArm` (retrieval, reglas funcionales, deps PHP, contextBuilder con `maxContextTokens`, updateDetail, prompt, `llm.generate(prompt, config)`) o `runAgentArm` (descubrimiento, tools, onToolStep con inserts/updates de traza por paso).
   e. `generationDurationMs`; `relativePath`; `existingContent` (readFile, null si falla; PHP null).
   f. Retorno 1: sin `framework` -> `recordRepetition` FAILED/CONFIGURATION (sandbox null), `finalized=true`, `return false`.
   g. Merge: PHP -> `sanitizeGeneratedPhp`; si null, retorno 2 (INVALID/COMPILATION, sin Sandbox, `return false`); si no, `${php}\n`. TS -> `applyCreate`/`applyMerge`.
   h. try interno: `artifactHash` (sha256 del merged, solo si el contenido generado no está vacío) -> `sandboxExecutionService.execute` (requestId experimento, executionProfile, projectRoot solo PHP) -> `mapSandboxResult`, `safeBuildArtifact`, `toSandboxExecutionEvidence`, `sandboxTimedOut`, `sandboxFailure`, `externalFailure` (INFRASTRUCTURE y no timeout), log debug si no compiló.
   i. catch interno: cualquier excepción del Sandbox -> `executionDurationMs`, evidencia aceptada si `SandboxAcceptedExecutionError`, artifact si `artifactHash !== null`, log warn, outcome FAILED/INFRASTRUCTURE, `externalFailure=true`.
   j. `recordRepetition(...)` con evidencia, `finalized=true`, `return externalFailure`.
6. catch externo (generación, extracción, traza, `recordRepetition` mismo, etc.): recalcula `generationDurationMs`, `llmExternalFailure` (LLMProviderUnavailableError.externalFailure), log warn, y si `!finalized` registra FAILED (INFRASTRUCTURE|UNKNOWN) con `sandboxEvidence/artifactHash/artifact` acumulados; `return externalFailure`.
7. finally: `stopHeartbeat()`, cleanup del workspace con try/catch y warn.

Puntos de atención: el catch externo captura también un fallo de `recordRepetition` del camino feliz (finalized aún false, por lo que se reintenta el registro como FAILED); `externalFailure` solo puede quedar true en el camino interno antes de ese fallo. Los valores `sandboxEvidence/artifactHash/artifact` deben seguir siendo visibles para el catch externo (variables de closure o un objeto mutable `AttemptState`).

Descomposición propuesta (todos métodos privados < ~120 líneas): `beginAttemptState`, `generateForAttempt` (a-d), `resolveAttemptTarget` (c, e: placement/relativePath/existingContent), `finalizeWithoutSandbox(record)` (retornos 1 y 2, común), `buildMergedContent` (g), `executeInSandbox` (h-i, devuelve `{outcome, externalFailure, ...}` y escribe en el estado mutable), `recordAttemptFailure` (6), `cleanupAttempt` (7). El `try/catch/finally` externo debe quedar en `runAttempt`.

## 2. Pipeline común

Idéntico en ambos: `toRetrievalTarget` -> `retrievalService.retrieve(projectVersionId, target)` -> `functionalRulesRetriever.retrieve(projectId, target)` -> `phpDependencyContextService.resolve(...)` -> `contextBuilder.build(retrieval, target, {framework, language}, opts, rules, deps)` -> `promptBuilder.build(ctx, php ? {testNamespace, testPath} : undefined)` -> merge (PHP `sanitizeGeneratedPhp` + `\n`; TS applyCreate/applyMerge) -> `sandboxExecutionService.execute` con un artefacto (`scope TARGET`, `runnerHint`, `projectRoot` solo PHP).

Difiere:
- Experimentos: `maxContextTokens` del budget; `updateDetail` de la traza entre contexto y prompt; `llm.generate(prompt, config)` con config y `withTimeout`; `promptSha256`; brazo AGENT inexistente en validación; `executionProfile`; `requestId` distinto; `framework` nullable; `testNamespace` puede ser null (validación usa `?? undefined`); ubicación decidida antes de generar.
- Validación: opciones `{}` sin presupuesto; `persistTraceEvidence` (upserts de retrieval/context) entre contexto y prompt; `llm.generate(prompt)` sin config; sin timeout; PHP inválido -> propuesta HELD; excepciones convierten en HELD con summary saneado; persistencia por propuesta y ejecución best-effort; `artifactType` derivado en el merge.

API propuesta: `app/src/generation/test-generation-pipeline.ts` con funciones puras/inyectadas, sin servicio con estado:
- `acquireGenerationContext(deps, {projectId, projectVersionId, target, framework, language, maxContextTokens?}) -> {retrieval, generationContext}` (retrieve, rules, deps, build). Cada handler inyecta después su traza (`updateDetail` o `persistTraceEvidence`), por lo que NO se unifica la persistencia. Atención: en validación `persistTraceEvidence` ocurre antes del prompt y después de contexto; mantener ese orden devolviendo el resultado y dejando que el handler lo llame.
- `buildTestPrompt(promptBuilder, ctx, language, placement) -> string` (la divergencia `namespace null` vs `undefined` debe preservarse con un parámetro ya normalizado por el caller).
- `mergeGeneratedTest(deps, {language, generatedContent, existingContent}) -> {kind:'MERGED', content, artifactType} | {kind:'INVALID_PHP'}`.
- `buildSandboxExecuteRequest({...}) -> SandboxExecuteRequest` (recibe `requestId`, `testRunId`, `executionProfile?` y artefactos; añade `projectRoot` solo PHP).

NO unificar: llamada al LLM (config/timeout), manejo de errores, persistencia, trazas, `existingContent` (en experimentos se lee antes de la comprobación de framework y la ruta puede venir de `testFilePaths[0]`; en validación solo la co-ubicada), clasificación de resultados, `artifactHash`/`safeBuildArtifact`. Agregar `executionProfile` o cambiar el `requestId` altera el contrato con Sandbox.

Cuidado con el orden: en experimentos `readFile` ocurre tras la generación y antes del chequeo de framework; si el pipeline compartido lee antes, cambia el orden de efectos (benigno pero evitable).

## 3. Red de seguridad

Existente: `app/src/experiments/experiment-job.handler.spec.ts` (111 casos), `app/src/validation/analysis-run-validation-job.handler.spec.ts` (63), `attempt-recovery.spec.ts`, `repetition-artifact.spec.ts`, `experiment-failure-fact.spec.ts`, `app/src/sandbox/*.spec.ts` (map result, evidence, request-id, resilience), `symbol-target.util.spec.ts`, `test-source-path.util.spec.ts`.

Verificar antes de implementar (el implementer debe grepear los specs; no los leí caso a caso) y añadir caracterización si falta:
1. Orden de llamadas en experimentos RAG: beginAttempt -> updateDetail(inicial) -> retrieve -> rules -> deps -> build -> updateDetail(ctx) -> generate -> execute -> recordRepetition (aserción de orden con `invocationCallOrder`).
2. Orden en validación: retrieve -> rules -> deps -> build -> persistTraceEvidence -> prompt -> generate -> merge -> execute -> persistProposal -> recordExecution.
3. `framework` null: no llama a Sandbox y registra CONFIGURATION (generación ya hecha).
4. PHP sin `<?php`: ambos handlers sin Sandbox (INVALID/COMPILATION vs HELD).
5. Excepción en `recordRepetition` del camino feliz: segundo registro FAILED desde el catch externo (comportamiento sutil).
6. Fallo del Sandbox tras `SandboxAcceptedExecutionError`: evidencia y artifact persistidos; sin contenido generado, `artifactHash` null y artifact null.
7. Contenido generado vacío: `artifactHash` null y artifact null aun con éxito del Sandbox.
8. LLMProviderUnavailableError externo: INFRASTRUCTURE y `return true`; otros: UNKNOWN y `return false`.
9. Heartbeat detenido y workspace limpiado incluso ante fallo de limpieza (warn).
10. Snapshot del `execute` request exacto (TS y PHP, con y sin `executionProfile`, `projectRoot` solo PHP) y del argumento `promptBuilder.build` (namespace null vs undefined) en ambos handlers.
11. Timeout de generación (`withTimeout`) en RAG y AGENT: FAILED UNKNOWN, no externo.

## 4. Riesgos y F3

Riesgos: reordenar `readFile`/`existsSync`/updateDetail; mover estado fuera de closure y perder el valor en el catch externo; `finalized` y retorno de `externalFailure`; unificar `maxContextTokens` (`{}` vs presupuesto) altera el contexto y el prompt; cambiar `namespace ?? undefined`; agregar `executionProfile` a validación; versión/hash de prompt (`promptDigest` solo en experimentos); transacciones: no hay una transacción envolvente, mantener que cada escritura sea independiente.

F3 (`sandboxHttpBoundMs`, attempt-recovery.ts:99-101, usada en handler 421 para el umbral de latido): hoy `timeout*(maxPoll+2)`. `withTransientRetries` (sandbox-execution.service.ts ~357, `SANDBOX_POLL_RETRIES` por defecto 3) envuelve cada GET de estado y el GET de resultado; sumarlos subiría la cota en hasta `timeout*(maxPoll+1)*retries` más esperas de backoff. Eso cambia `heartbeatStaleMs` por defecto (hasta ~4x) y por tanto cuándo se declara vencido un intento y se relanza (recuperación, `attempt-recovery.spec.ts` fija `1_220_000`). Es un cambio observable, no un refactor. Resultado: DECISION_REQUIRED (el usuario decide si mover el umbral en un WI aparte o en este) y recomiendo excluirlo de WI-CORE-070, dejando el refactor puro.

## 5. Decisiones PENDING/PROPOSED

Ninguna con Blocks que alcance este WI. Encontradas: DEC-VAL-001 (validación empresarial, system-contract.md:303), DEC-PHP-ROOT-001 (spec/features/019, solo múltiples composer.json), DEC-RAG-001 (spec/features/004, ranking test-aware). Ninguna toca el pipeline más allá de que no se debe añadir señal test-aware ni selección de `projectRoot`. DEC-VAL-002 (aprobada) fija la clasificación por símbolo; no se debe cambiar `classifySymbolFailure`/`classifyRun`.

## Corte propuesto

Dos cortes, con gates (lint, build, contracts:check, test) y revisión del diff entre ellos:
1. Corte A: caracterización (sección 3) + descomposición de `runAttempt` en `experiment-job.handler.ts`, sin tocar validación. Menos riesgo; riesgo concentrado en el estado compartido y los catch.
2. Corte B: extraer el pipeline compartido (solo contexto, prompt, merge, request de Sandbox) y adoptarlo en ambos handlers, con las pruebas de orden e igualdad de requests como red.
Justificación: A y B tienen modos de fallo distintos y son revisables hunk a hunk por separado; un solo corte mezcla movimiento de código con cambio de límites entre módulos. F3 queda fuera pendiente de decisión.

## Hallazgos

- F-1 (medio): orden de efectos y estado visible por el catch externo (ver sección 1).
- F-2 (medio): divergencias deliberadas entre handlers que no deben unificarse (sección 2).
- F-3: DECISION_REQUIRED, ver sección 4.
- Limitación: no ejecuté los tests ni leí los specs caso por caso; la lista de casos faltantes es a validar por el implementer.
