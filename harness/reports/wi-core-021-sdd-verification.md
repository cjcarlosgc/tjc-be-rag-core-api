# WI-CORE-021 — Verificación de suficiencia SDD

Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-08. Solo lectura sobre `app/`, `state.json` y `work-items.json`; se añadió un bloque de detalle técnico a `spec/features/004-rag-retrieval-context/plan.md`.

## Resultado: SPEC_VERIFIED (sin bloqueos)

Verificaciones del rol: HU05, HU07 y HU10 pertenecen a HU01–HU18; `ST-CORE-028` existe en `tasks.md` de 004 (`T-READY`); componente CORE; sin `caseIds` OC; `WI-CORE-020` (dependencia) está W-DONE; `contractSyncReview` ya revisa CS-20260920-001 y CS-20260921-003 como NOT_RELEVANT.

## Decisiones aplicables

| ID | Estado | Blocks / alcance | ¿Bloquea? |
|---|---|---|---|
| DEC-RAG-001 | PENDING | solo un WI futuro de recuperación test-aware | No |
| DEC-FK-001/003/004 | APROBADO | escenarios, aplicabilidad, derivación (ya implementadas en WI-CORE-020) | No |
| DEC-EXP-FK-001 | Cerrada | el brazo RAG recibe FK ACTIVE aplicable; el agente generalista no | No |

`decisionGate`: PASS. Registrar `DEC-FK-001`, `DEC-FK-003`, `DEC-FK-004` y `DEC-EXP-FK-001` en `state.json`; `DEC-RAG-001` no aplica.

## Impacto contractual

Confirmado `contractImpact=false`. `GenerationContext` es un tipo interno (no DTO ni ruta); INTEROP/SYSTEM ya describen `{ target, relatedChunks, functionalRules, metadata }` y la regla «Sandbox nunca recibe reglas» (system-contract §Contexto RAG, 013 spec). El `ContextTrace` y el payload a Sandbox no cambian de forma. Sin cambio de DTO/ruta/payload públicos: no se requiere contract-reviewer, solo el Contract Sync aplicable en los checkpoints.

## Matriz criterio -> spec -> código actual -> brecha

| Criterio | Código actual | Brecha |
|---|---|---|
| `GenerationContext` con `functionalRules` y recuperador determinista | `generation-context.ts` sin `functionalRules`; no hay recuperador; `findActive` busca una sola regla por scenarioKey | Tipo `FunctionalRule`, `FunctionalRulesRetriever`, `findActiveByTargetRef` |
| Campos y procedencia | Columnas existen tras WI-CORE-019/020 | Mapear modelo -> `FunctionalRule` |
| Bloque «Reglas funcionales», orden, presupuesto, audit | `PromptBuilder` y `ContextBuilder` ignoran reglas | Render, conteo con `countTokens`, audit de omisión |
| Sandbox sin reglas; pruebas | `SandboxExecutionService.execute` arma el cuerpo con campos fijos | Prueba de payload; ampliar specs |

## Ambigüedades y cierre (detalle técnico, cerradas en plan.md)

1. Forma de procedencia: `provenance { confirmedByUserId, confirmedRole, originHeadSha, sourceRef }` + `source` aparte.
2. Forma del audit de omisión: `audit.functionalRules { retrieved, selected, tokenCount, omitted[{knowledgeId, tokenCount, reason:'TOKEN_BUDGET'}] }`.
3. Tokenizador: `countTokens` de `gpt-tokenizer/encoding/cl100k_base` (el de los chunks) sobre el texto renderizado de la regla.
4. Inyección: el llamador recupera (`analysis-run-validation-job.handler.ts` y rama RAG de `experiment-job.handler.ts`, ambos con `projectId`) y pasa a `ContextBuilder.build`; el `build` de contexto vacío pasa `[]`.
5. `targetRef`: METHOD `filePath::Clase.metodo`; FUNCTION `filePath::nombre` (inverso de `toRetrievalTarget`, igual que `symbolTargetRef` de FK).
6. ContextTrace: `makeRagDetail` solo lee `audit.target/candidates/configuration`; se fija con prueba que `audit.functionalRules` no se serializa.
7. Prueba de Sandbox: a nivel del cuerpo enviado en `sandbox-execution.service.spec.ts`.
8. Presupuesto: target primero, luego reglas, luego chunks; `contextTokens` incluye reglas.

Ninguna requiere decisión de producto: sin DECISION_REQUIRED.

## Riesgos de datos/migración

Ninguno: sin cambios de esquema; consulta con índice existente `(projectId, scope, targetRef, status)`. Riesgo menor: reglas muchas por target consumen presupuesto de chunks (mitigado por el descuento acotado y el audit).

## Cortes recomendados y archivos

1. Tipos + recuperador + `findActiveByTargetRef` + módulo (`retrieval/generation-context.ts`, `retrieval/functional-rules.retriever.ts`, `functional-knowledge.repository.ts`, `retrieval.module.ts`, specs). Refs: HU07, HU10.
2. `ContextBuilder.build` (parámetro, presupuesto, audit) y `PromptBuilder` (bloque) con specs. Refs: HU05, HU07, HU10.
3. Cableado en `analysis-run-validation-job.handler.ts` y `experiment-job.handler.ts` (+ specs de experimentos, retrieval), prueba de payload de Sandbox y cierre documental/Contract Sync. Refs: HU05, HU07, HU10.

Implementer-high: no necesario; el trabajo es acotado y determinista. Usar implementer (low); escalar solo si el cableado en los handlers resulta complejo.
