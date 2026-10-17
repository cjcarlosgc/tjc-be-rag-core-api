# WI-CORE-021 — Implementación (reglas funcionales en GenerationContext)

Modelo: implementer · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-08. Alcance: solo `app/`. Sin push, sin tocar `app/.env`, Supabase, `spec/`, `harness/` (salvo este reporte), otros repositorios.

## Estado

`IMPLEMENTED_PENDING_REVIEW`. Los tres cortes están commiteados en `feature/jean`. El WI no se marca terminado: la revisión final la hace el Human Reviewer (usuario). El checkpoint PULL de `CONTRACT_SYNC` y la actualización de `tasks.md`/`state.json` quedan para el leader.

## Commits

| Commit | Corte | Refs |
|---|---|---|
| `b36408a` | (1) Tipos `FunctionalRule`, `FunctionalRulesRetriever`, `findActiveByTargetRef`, `RetrievalModule` | HU07, HU10 |
| `ab30546` | (2) `ContextBuilder.build` con presupuesto y audit; bloque «Reglas funcionales» en `PromptBuilder` | HU05, HU07, HU10 |
| `2e17a46` | (3) Cableado en validación y rama RAG de experimentos; prueba de payload de Sandbox | HU05, HU07, HU10 |

Todos llevan `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` según la instrucción del encargo.

## Archivos (16, +654 / −5)

- `app/src/retrieval/generation-context.ts`: `FunctionalRule`, `FunctionalRuleProvenance`, `GenerationContext.functionalRules`, `audit.functionalRules`.
- `app/src/retrieval/functional-rules.retriever.ts` (nuevo): `FunctionalRulesRetriever` y `functionalTargetRef`.
- `app/src/retrieval/functional-rule-format.ts` (nuevo): `renderFunctionalRule` y `countFunctionalRuleTokens` (cl100k_base).
- `app/src/retrieval/context-builder.service.ts`: presupuesto de reglas antes que los chunks, audit.
- `app/src/retrieval/retrieval.module.ts`: importa `FunctionalKnowledgeModule`, registra y exporta el recuperador.
- `app/src/functional-knowledge/functional-knowledge.repository.ts`: `findActiveByTargetRef`.
- `app/src/generation/prompt-builder.service.ts`: bloque «Reglas funcionales».
- `app/src/validation/analysis-run-validation-job.handler.ts`: recupera reglas con `run.projectId` y las pasa a `build`.
- `app/src/experiments/experiment-job.handler.ts`: recupera reglas solo en `runRagArm`; el `build` de contexto vacío pasa `[]`.
- Specs: `functional-rules.retriever.spec.ts` (nuevo), `functional-knowledge.repository.spec.ts`, `context-builder.service.spec.ts`, `prompt-builder.service.spec.ts`, `analysis-run-validation-job.handler.spec.ts`, `experiment-job.handler.spec.ts`, `sandbox-execution.service.spec.ts`.

## Verificación

Comandos desde `app/` con `DATABASE_URL` y `DIRECT_URL` = `postgresql://nouser:nopass@127.0.0.1:1/none`.

| Check | Línea base | Tras la implementación |
|---|---|---|
| `pnpm lint` | OK | OK (exit 0) |
| `pnpm test` | 1337 passed, 36 skipped | 1352 passed, 36 skipped (109 files) |
| `pnpm build` (`nest build`) | OK | OK (exit 0) |
| `pnpm test:e2e` | no medido | 222 passed (7 files) |
| `tsc -p tsconfig.build.json` | — | OK |

Pruebas que fijan el criterio:
- Recuperador: consulta por `projectId` y `targetRef` exacto (`filePath::Clase.metodo` o `filePath::nombre`), mapea `knowledgeId`, `scenarioKey`, `normalizedRule`, `scope`, `targetRef`, `source` y procedencia.
- Repositorio: `status ACTIVE`, sin filtro de scope ni de escenario, `orderBy createdAt asc, id asc`.
- Presupuesto: las reglas se descuentan antes que los chunks; una regla grande se omite con `TOKEN_BUDGET` y entra la siguiente que cabe; el chunk pendiente queda descartado por presupuesto.
- Prompt: el bloque aparece después del código objetivo y antes del contexto relacionado, y no aparece sin reglas. El identificador de la persona que confirmó no se imprime.
- ContextTrace: con el ContextBuilder real, la traza RAG no contiene el texto de la regla ni la clave `functionalRules`.
- Sandbox: el cuerpo enviado tiene exactamente las nueve claves del contrato de ejecución y no contiene reglas, aunque el request traiga un campo `functionalRules`.
- Brazo GENERALIST_AGENT: el recuperador se llama solo en las 3 repeticiones RAG.

## Desviaciones y decisiones menores (no son decisiones de producto)

1. **Firma de `build`.** `functionalRules` es el quinto parámetro, con valor por defecto `[]`, después de `options`. Así no se reescriben las ~12 llamadas existentes que pasan `options` en cuarta posición. Los dos llamadores de producción lo pasan de forma explícita.
2. **Forma de `audit.functionalRules`.** Quedó `{ retrieved: number, selected: number, tokenCount: number, omitted: [{ knowledgeId, tokenCount, reason: 'TOKEN_BUDGET' }] }`. El plan no fijaba si `retrieved` y `selected` son contadores o listas; elegí contadores, como en el resto del audit.
3. **Procedencia en el prompt.** Se muestran `origen`, `confirmada por rol`, `headSha` y `referencia` cuando existen. Se omite `confirmedByUserId` para no enviar identidades de personas al modelo. Es una decisión de privacidad a confirmar en la revisión.
4. **Presupuesto del encabezado.** El presupuesto cuenta cada línea de regla tal como la renderiza `renderFunctionalRule`. La línea de encabezado «Reglas funcionales (…)» no se cuenta, igual que el resto de texto fijo del prompt.
5. **Import entre módulos.** `RetrievalModule` ahora importa `FunctionalKnowledgeModule`. Revisé el grafo: los módulos que este importa no dependen de `RetrievalModule`, así que no hay ciclo. No se ejecutó un arranque completo de la aplicación.
6. **Cuarto argumento de `build`.** `ContextBuilder` sigue sin acceder a la base; el recuperador se invoca en los llamadores, como indica el plan.

## Pendiente fuera de este reporte

- Checkpoint PULL de `CONTRACT_SYNC`, según el rol. No lo ejecuté: no se cambió ningún DTO, ruta ni payload público, y el leader debe confirmarlo.
- Actualizar `ST-CORE-028` en `tasks.md`, `state.json` y registrar los IDs de decisión aplicables (`DEC-FK-001/003/004`, `DEC-EXP-FK-001`). Es trabajo del leader.
- Revisión final del Human Reviewer sobre el rango `0bc41a3..2e17a46`.

## Evidencia de archivos

`git diff --stat 0bc41a3..2e17a46` muestra los 16 archivos listados arriba. El árbol de trabajo queda limpio salvo este reporte, que no se ha commiteado.

---
## Verificación del leader
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium (verificación). Implementación: `implementer` · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low (sin escalada). Trailers de los tres commits (`b36408a`, `ab30546`, `2e17a46`): `Co-Authored-By: Claude Sonnet 5.5` y `Refs` correctos.

Desde `app/` con DATABASE_URL/DIRECT_URL = postgresql://nouser:nopass@127.0.0.1:1/none y sin `app/.env`: `pnpm lint` exit 0; `pnpm test` 109 archivos pasan, 1 omitido, 1352 tests pasan, 36 omitidos; `pnpm build` exit 0; `pnpm test:e2e` 7 archivos, 222/222; `node harness/validate-harness.mjs` pasa.

Impacto contractual: ninguno (confirmado por sdd-analyst; `GenerationContext` es interno, INTEROP/SYSTEM ya describen `functionalRules`), por lo que no se activó contract-reviewer ni se publica Contract Sync.

## Puntos para el Human Reviewer
- `ContextBuilder.build` recibe las reglas como quinto parámetro (default `[]`) para no tocar ~12 llamadas de spec.
- `audit.functionalRules` = `{retrieved, selected, tokenCount, omitted[]}`; no se serializa en el ContextTrace (probado).
- El prompt omite `confirmedByUserId` (privacidad) y muestra rol, headSha y sourceRef; el objeto `FunctionalRule` sí conserva toda la procedencia. Confirmar esta elección.
- El encabezado del bloque «Reglas funcionales» no cuenta en el presupuesto de tokens.
