# WI-CORE-103 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium
Implementación: subagente `implementer-high` (configurado claude-sonnet-5-5, atendido claude-sonnet-5-5 según su informe).

## Verificación independiente del leader (desde `app/`, 2026-10-25, tras el último cambio del implementer)
- `corepack pnpm@12.14.0 lint`: sin hallazgos (exit 0).
- `corepack pnpm@12.14.0 build` (prisma generate + nest build): exit 0.
- `corepack pnpm@12.14.0 contracts:check`: limpio (sin cambio de `schemas/` ni de `generated/`).
- `vitest run` (sin base de datos; los `*.pg.spec.ts` se omiten): 188 archivos pasan y 10 se omiten; 3 280 pruebas pasan y 121 se omiten; 0 fallos (antes de WI-103: 3 242; 3 283 tras las pruebas añadidas, ver al final).
- `node scripts/sdd-check.mjs`, `harness/validate-work-items.mjs` y `harness/validate-harness.mjs`: en verde.

## Cambio (app/src, app/.env.example)
- `retrieval/generation-context.ts`: `RagContextStrategy`, `RagContextLayer`, motivo `BELOW_RELEVANCE_THRESHOLD`, `layer` en el candidato del audit y `strategy`/`relevanceThreshold`/`declaringClassMaxTokens`/`targetEvidenceMaxTokens` en `configuration`.
- `retrieval/context-builder.service.ts`: estrategia `LAYERED` (por defecto en código, solo PHP; `selectByLayers`: capa 3 clase declarante por `startLine` hasta 4000 tokens, capa 4 evidencia del target no de prueba hasta 2000, capa 5 relleno con `semanticScore ≥ 0.60`, techo `topK`, todo dentro de `maxContextTokens`) y `RANKED` con el comportamiento anterior (TypeScript siempre); `scoreCandidate`, `resolveWeights` y el score no cambian.
- `generation/context-sufficiency.ts`: `BELOW_RELEVANCE_THRESHOLD` cuenta como `BELOW_MINIMUM_SCORE` en la cláusula (b) de D-5.
- Trazas aditivas: `experiments/dto/context-trace.response.ts`, `experiments/experiment-attempt-presenters.ts` (persiste `layer`), `context-traces/context-traces.service.ts` (valida y expone `layer` y los 4 campos solo si están almacenados; las trazas anteriores se leen igual; un `layer` inválido → `invalidStoredDetail`).
- `config/env.validation.ts` y `app/.env.example`: `RETRIEVAL_CONTEXT_STRATEGY`, `RETRIEVAL_RELEVANCE_THRESHOLD`, `RETRIEVAL_DECLARING_CLASS_MAX_TOKENS`, `RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS`.
- `RetrievalService`, `retrieval-comparisons/*`, `evidence-mapping.ts`: sin cambios (comprobado con grep: `evidence-mapping` solo lee `topK` y los pesos; la comparación OE2 solo usa `retrieve`, `resolveWeights` y `scoreCandidate`).

## Pruebas y sanidad de mutaciones (reportadas por el implementer; suite reproducida por el leader)
- 19 pruebas nuevas de `LAYERED`/`RANKED` en `context-builder.service.spec.ts` (defaults y overrides, capas y orden, topes, umbral 0.59/0.60/null, techo `topK`, presupuesto global, FK antes de los chunks, TypeScript con `RANKED`, auditoría completa sin duplicados, escenario tipo persistence-c1 —la clase pasa de rank 21 `TOP_K_LIMIT` con `RANKED` a `SELECTED` con `LAYERED`, contexto 1 539 > 542 tokens— y tipo money-c2 —partes 1 y 2 por `startLine`, 3 000 tokens, partes 3 y 4 `TOKEN_BUDGET`—), 2 de D-5, 5 de `context-traces.service`, 6 de `env.validation`, 2 de los presenters y 4 de la prueba dorada de OE2 (`retrieval-comparison-golden.spec.ts`: pesos, `scoreCandidate`, rankings SE/SEM y forma de `RetrievalResult`).
- Las pruebas existentes no se debilitaron: solo se completó el objeto de configuración exacto de una prueba (4 campos nuevos) y los mocks.
- Mutaciones (a)–(h) detectadas: saltar la capa 3 (8+ pruebas), quitar su tope (3), quitar el umbral (4), `LAYERED` en TypeScript (varias), quitar el motivo de `isRagDiscardReason` (1), invertir el orden por `startLine` (4), quitar la exclusión de pruebas de la capa 4 (1), D-5 sin el motivo nuevo (1).

## Límites
No se ejecutó nada contra GitHub, Integration, el Sandbox ni OpenAI reales ni contra una base de datos (los `*.pg.spec.ts` no se ejecutan sin ella); no se pudo correr `tsc` sobre los specs porque el proyecto tiene errores de tipos preexistentes en ~20 specs ajenos (`src` sin specs compila limpio). La calibración de umbrales (0.60, 4000, 2000) se hace solo con los casos `smoke-*` en la puerta de qualification. Riesgos declarados: con `LAYERED` y clase declarante indexada la cláusula (b) de D-5 casi nunca se cumple; un candidato descartado por el tope de la capa 3 o 4 no se reconsidera para el relleno; un spec futuro en PHP que espere el orden anterior debe pedir `strategy:'RANKED'`.

## Pruebas añadidas tras la revisión independiente (solo pruebas, sin cambio de producción)
A petición del reviewer: `context-builder.service.spec.ts` («LAYERED con minimumScore»: con `minimumScore` 0.5 la clase solo estructural queda `BELOW_MINIMUM_SCORE`, `layer` null) y `context-sufficiency.spec.ts` («cambio de D-5 con LAYERED frente a RANKED»: sin clase declarante y con candidatos `IMPORTED_BY`/semántico < 0.60, `LAYERED` bloquea con `NO_RELEVANT_CANDIDATES_AND_MISSING_RULES` y `RANKED` no). Mutaciones detectadas: ignorar `minimumScore` en la capa 3 (2 pruebas) y quitar el motivo nuevo de D-5 (2). Verificación del leader tras añadirlas: lint sin hallazgos, build exit 0, `contracts:check` limpio, 188 archivos pasan y 10 se omiten, 3 283 pruebas pasan y 121 se omiten, 0 fallos; digest de `interoperability-contract.md` sin cambio (`76f5e774…29c43`).
