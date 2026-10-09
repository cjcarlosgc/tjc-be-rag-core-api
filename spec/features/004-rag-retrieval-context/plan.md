# 004-rag-retrieval-context — Plan

## Dependencias

- Constitución y transversales aplicables.
- `spec/features/002-project-version-indexing/spec.md` para `DEC-CHUNK-001` y el contrato vigente de chunks.
- `spec/transversal/providers/spec.md` para `DEC-EMB-001`.

## Diseño técnico

`RetrievalService` obtiene candidatos mediante señales semánticas y estructurales; vector query usa pgvector cosine. `ContextBuilder` aplica selección, deduplicación, orden, etiquetas y presupuesto. Para HU05/HU17 debe producir además una decisión auditable por candidato, sin cambiar el `GenerationContext` consumido por el prompt; `011-context-traces` es propietario de su persistencia y transporte.

`DEC-EMB-001` y `DEC-CHUNK-001` quedaron `APROBADO` (ver `spec/transversal/providers/spec.md` y `spec/features/002-project-version-indexing/spec.md`): modelo `text-embedding-3-small`/1536 dimensiones y diseño de chunking jerárquico + oversized structured chunks con `maxChunkTokens` configurable. `ContextBuilder` debe soportar expansión dinámica a partes vecinas (`partIndex`/`partsTotal`) de un chunk oversized cuando lo necesite. `DEC-RAG-001` no bloquea esta base: prohíbe únicamente añadir silenciosamente una señal test-aware sin su investigación y aprobación.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.

## Cortes SMART V3

Orden: `WI-CORE-021` (`functionalRules`, depende de `WI-CORE-020`), `WI-CORE-022` (OE2, depende de `WI-CORE-017` y de `WI-CORE-019` por el rol Writer) y, diferido, `WI-CORE-028` (PHP estructural). `WI-CORE-006` (decisiones de candidatos RAG) comparte `RetrievalService` con OE2: se ejecutan en serie y el contrato de candidatos de §6.15 reutiliza el vocabulario de señales de §6.7.

## Diseño técnico SMART V3 (WI-CORE-021 y WI-CORE-022)

- **`functionalRules` (`WI-CORE-021`).** Un recuperador determinista (`FunctionalRulesRetriever`) consulta Prisma y devuelve las reglas `ACTIVE` del Project cuyo `targetRef` coincide exactamente con `filePath::qualifiedName` del target, de todos los escenarios; no hay herencia `PROJECT`/`MODULE`/`CLASS` hasta que se apruebe. `ContextBuilder.build` recibe las reglas ya recuperadas; el prompt las presenta en un bloque «Reglas funcionales» separado del código. Se ordenan por `createdAt` y `knowledgeId`, se cuentan con el mismo tokenizador que los chunks y se descuentan de `maxContextTokens` antes de los `relatedChunks`; si no caben todas, entran las que quepan en ese orden y la omisión consta en `audit`. Cada regla trae `knowledgeId`, `scenarioKey`, `normalizedRule`, `scope`, `targetRef`, `source` y procedencia. El `ContextTrace` experimental no cambia.
- **Detalle técnico de `functionalRules` (verificación SDD de `WI-CORE-021`, 2026-10-08).**
  - *Recuperador.* `FunctionalRulesRetriever` vive en `retrieval/`, se inyecta `FunctionalKnowledgeRepository` (nuevo método `findActiveByTargetRef(projectId, targetRef)`: `status = 'ACTIVE'`, todos los `scope` y `scenarioKey`, `orderBy createdAt asc, id asc`) y se exporta desde `RetrievalModule`. `targetRef` se arma con `filePath::qualifiedName`: `METHOD` → `${symbolName}.${methodName}`; `FUNCTION` → `symbolName` (inverso de `toRetrievalTarget`).
  - *Quién llama.* Los dos llamadores actuales de `ContextBuilder.build` (`analysis-run-validation-job.handler.ts`, con `run.projectId`, y la rama RAG de `experiment-job.handler.ts`, con `projectId` del job) invocan primero al recuperador y pasan `functionalRules` a `build` (parámetro nuevo; `[]` en el `build` de contexto vacío de `initializeTraceDetail`). `ContextBuilder` no accede a la base. El brazo `GENERALIST_AGENT` no las recibe (`DEC-EXP-FK-001`).
  - *Forma.* `FunctionalRule = { knowledgeId, scenarioKey, normalizedRule, scope, targetRef, source, provenance: { confirmedByUserId, confirmedRole, originHeadSha, sourceRef } }` (los campos de procedencia pueden ser `null` en reglas históricas). `knowledgeId` es el `id` de `FunctionalKnowledge`.
  - *Tokenizador y presupuesto.* El mismo de los chunks: `countTokens` de `gpt-tokenizer/encoding/cl100k_base`. Se cuenta el texto exacto con que `PromptBuilder` renderiza la regla (helper compartido de render). Orden de consumo: el target primero (como hoy), luego las reglas en el orden `createdAt`, `knowledgeId`, y el resto del presupuesto para los `relatedChunks`. Si una regla no cabe se omite y se sigue con la siguiente (entran "las que quepan"). `contextTokens` incluye los tokens de las reglas.
  - *Audit.* `audit.functionalRules = { retrieved, selected, tokenCount, omitted: [{ knowledgeId, tokenCount, reason: 'TOKEN_BUDGET' }] }`. `PromptBuilder` ignora el `audit`. `makeRagDetail` y el `ContextTrace` no leen ni serializan `audit.functionalRules`; una prueba lo fija (sin cambios en la forma de la traza).
  - *Prompt.* Bloque «Reglas funcionales» después del código objetivo y antes del contexto relacionado; se omite si no hay reglas. Cada entrada muestra `scenarioKey`, `normalizedRule` y la procedencia disponible. Los comentarios, nombres y retornos del código no se inyectan como reglas.
  - *Sandbox.* Prueba a nivel de payload en `sandbox-execution.service.spec.ts`: el cuerpo enviado a Sandbox tiene exactamente las claves de `SandboxExecutionRequest`/del contrato y no contiene `functionalRules`, `normalizedRule` ni texto de reglas, aun cuando el flujo de validación las usó para generar.
- **Persistencia de OE2 (`WI-CORE-022`).** Dos tablas aditivas con una migración Prisma: `retrieval_comparisons(id, analysisRunId, projectId, projectVersionId, symbol, idempotencyKey, status, failureCode, failureMessage, groundTruth, startedAt, completedAt)` y `retrieval_comparison_results(id = retrievalId, comparisonId, mode, config, candidates, metrics)`. La operación corre como job asíncrono del tipo `RETRIEVAL_COMPARISON` sobre la cola existente; la `Idempotency-Key` usa el scope `RETRIEVAL_COMPARISON_CREATE` del servicio existente.
- **Modo y puntuación.** `RETRIEVAL_MODE` se pasa como argumento a `RetrievalService`; el flujo del producto no lo recibe y usa `SE`. El top semántico es 20 (se parametriza si el valor actual difiere). En SE, `combinedScore = semanticWeight·semanticScore (0 si es nulo) + structuralWeight·(1 si hay relación estructural, 0 si no)` con la fórmula y los pesos por defecto de `ContextBuilder`; `structuralRelation` es `IMPORTS` o `IMPORTED_BY` (la primera que aplique; las PHP quedan diferidas). Orden: `combinedScore` descendente, luego `semanticScore` descendente y luego `chunkId` ascendente; `rank` es 1..N sobre ese orden y `selected` es verdadero para `rank ≤ 10`. En SEM, `combinedScore` es `null` y el orden usa `semanticScore`.
- **Métricas.** `P@k = |top-k ∩ groundTruth| / k` y `R@k = |top-k ∩ groundTruth| / |groundTruth|`, con coincidencia exacta por `(filePath, symbolQualifiedName)`. Sin `groundTruth` o con una lista vacía, `metrics` es `null`.
- **Pruebas a tocar:** `retrieval.service.spec.ts` y `context-builder.service.spec.ts`. Contract Sync de implementación a Console para `WI-CONSOLE-014`.
