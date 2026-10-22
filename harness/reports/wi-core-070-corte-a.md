# WI-CORE-070 — Corte A: caracterización y descomposición de `runAttempt`

Modelo: implementer-high · configurado claude-haiku-5-5 · atendido claude-haiku-5-5 · esfuerzo high

Repositorio: `/Users/cjcarlosgc/Development/Tesis/tjc-be-rag-core-api` (rama `feature/jean`).
Alcance: corte A aprobado (`harness/reports/wi-core-070-scope-approval.md`). Corte B (pipeline compartido y `analysis-run-validation-job.handler.ts`) y corte C (log y contador de GET) no se tocaron. F3 queda fuera.

Estado: implementado y verificado con los gates; sin commit ni push (lo hace el leader). Pendiente de revisión independiente por el `reviewer`. No hay autoaprobación.

## 1. Pruebas de caracterización (antes de tocar el handler)

Se añadió un bloque nuevo al final de `app/src/experiments/experiment-job.handler.spec.ts`: `ExperimentJobHandler caracterización de runAttempt (WI-CORE-070, corte A)`, con 15 casos. Reutiliza los helpers del spec. Se ejecutó sobre el handler sin refactorizar: 123 pasan (108 existentes + 15 nuevos).

| Caso | Qué fija |
|---|---|
| RAG: orden de efectos | `invocationCallOrder` de: contexto vacío (esqueleto), detalle inicial, extract, retrieve, reglas, dependencias, contexto real, detalle de contexto, prompt, generate, execute, escritura terminal |
| AGENT: orden de efectos | detalle y contadores iniciales, extract, discover, agente, detalle final, execute, escritura; sin `contextBuilder` ni LLM directo |
| Solicitud al Sandbox TS | `toEqual` exacto: requestId derivado, un artefacto `CREATED` con `relativePath` co-ubicado, `runnerHint`, `executionProfile`, `scope`/`targetIds`; sin `projectRoot` |
| Framework nulo | genera antes; registra `CONFIGURATION` (`compiled/executed/valid` null); no llama Sandbox; `failTrace`; limpia workspace; devuelve false |
| PHP sin `<?php>` | devuelve false; `INVALID`/`COMPILATION` completado; sin Sandbox; `finishTrace`; limpia workspace |
| Fallo de escritura en camino feliz | dos rechazos seguidos: reintento sin evidencia, luego FAILED/UNKNOWN del catch externo; el artefacto se guarda una vez; `failTrace`, `finishRepetition(…, 'FAILED')`, `refreshCompletedRepetitions` |
| `SandboxAcceptedExecutionError` | devuelve true; conserva `sandboxExecutionId` y hash; guarda artefacto; FAILED/INFRASTRUCTURE con resumen "Sandbox no disponible." |
| Contenido vacío con éxito del Sandbox | el Sandbox recibe el contenido fusionado; sin hash ni artefacto; devuelve false |
| Fallo LLM (3 casos, `it.each`) | externo → true, INFRASTRUCTURE, resumen LLM; no externo y genérico → false, UNKNOWN, resumen genérico |
| Timeout de generación (RAG y AGENT, `it.each`) | devuelve false; FAILED/UNKNOWN; sin Sandbox; el texto del timeout no se persiste |
| Fallo al limpiar workspace | solo aviso (`Logger.warn`); no se propaga; devuelve false |
| Latido en fallo de generación | durante la generación hay un temporizador; al terminar no queda ninguno |

Los casos ya cubiertos por el spec existente (heartbeat en éxito, contenido vacío en `handle`, PHP en ambos brazos, `SandboxTimedOut`, redelivery) se dejaron como estaban.

Desvío respecto al informe SDD: su punto 1 situaba `updateDetail(inicial)` después de `beginAttempt` y antes de retrieve. El orden real es: `beginAttempt` → `contextBuilder.build` (esqueleto vacío) → `updateDetail` (esqueleto) → extract → retrieve → … El caso fija el orden real.

## 2. Descomposición de `runAttempt`

Archivo: `app/src/experiments/experiment-job.handler.ts`.

Antes: `runAttempt` ocupaba líneas 475–821 (347 líneas), con variables locales compartidas por el try/catch/finally.

Después: `runAttempt` ocupa líneas 571–678 (108 líneas). El try/catch/finally externo sigue en `runAttempt`. El estado mutable vive en un objeto `AttemptState` (creado por `createAttemptState`).

Miembros nuevos:

- Tipos y builders de módulo (líneas ~56–125): `RepetitionOutcome`, `AttemptTarget`, `SandboxStepResult`, `AttemptState`, `frameworkMissingOutcome(language)`, `phpNotPhpOutcome()`.
- Métodos privados (líneas ~545–1010): `createAttemptState` (545), `runAttempt` (571, 108 líneas), `generateForAttempt` (681, el único `withTimeout` de RAG y AGENT), `resolveAttemptTarget` (720, ruta y `existingContent`), `finalizeWithoutSandbox` (739), `mergeAttemptContent` (763), `executeInSandbox` (781), `buildSandboxRequest` (816), `acceptSandboxResult` (852), `recordSandboxFailure` (903), `recordAttemptFailure` (947, catch externo), `evidenceOf` (990), `cleanupWorkspace` (999).
- Ningún método nuevo supera 120 líneas; el mayor es `runAttempt` con 108.

Los dos retornos tempranos se unificaron en `finalizeWithoutSandbox`. Ambos hacían exactamente lo mismo: una sola llamada a `recordRepetition` con `sandbox/artifactHash/artifact` nulos, `finalized = true` y `return false`. Solo cambia el `outcome`: CONFIGURATION (sin framework) o INVALID/COMPILATION (PHP sin `<?php>`).

Import añadido (solo tipos): `SandboxExecutionRequest`, `SandboxExecutionResult` desde `../sandbox/sandbox.types.js`.

Sin cambios: `handle`, `runRagArm`, `runAgentArm`, `initializeTraceDetail`, `recordRepetition`, `writeTerminalRepetition`, `safeBuildArtifact`, `writeRepetitionArtifact`, validación, DTO, contratos, migraciones, prompts, ranking, pesos, R-PHP. Total del archivo: 1244 → 1433 líneas (incluye los tipos y builders).

Orden de efectos preservado (verificado en código y por la caracterización):

1. `beginAttempt` → `startHeartbeat` → estado (`generationStart` tomado en el mismo punto).
2. try: `initializeTraceDetail` → `extract` → placement PHP → `generateForAttempt` (con timeout) → `generationDurationMs` → `resolveAttemptTarget` (lee `existingContent` antes del chequeo de framework, como antes).
3. framework nulo → finalización sin Sandbox.
4. merge (PHP sanitize o TS applyCreate/applyMerge); PHP no válido → finalización sin Sandbox.
5. `executeInSandbox`: `artifactHash` → execute → `mapSandboxResult` → artefacto → evidencia → timeout/fallo → `externalFailure` → log debug. Excepción → `recordSandboxFailure` (evidencia aceptada, artefacto si hay hash, log warn, `externalFailure = true`).
6. `recordRepetition`, `finalized = true`, `return externalFailure`.
7. catch externo: recalcula duración, `llmExternalFailure`, warn, y si `!finalized` registra FAILED con evidencia acumulada.
8. finally: `stopHeartbeat()` y `cleanupWorkspace` (con warn ante fallo).

## 3. Comandos y resultados

Todos desde `app/` con Node 22.23.3.

| Comando | Resultado |
|---|---|
| `pnpm exec vitest run src/experiments/experiment-job.handler.spec.ts` (sin refactor, tras añadir caracterización) | 123 passed (108 + 15) |
| Mismo comando tras el refactor | 123 passed |
| `pnpm lint` (`oxlint src/ test/`) | exit 0 |
| `pnpm build` (`nest build`) | exit 0 |
| `pnpm contracts:check` | exit 0 (sin cambios en `spec/contracts/`) |
| `pnpm test` (`vitest run`) | exit 0. Test Files 155 passed \| 7 skipped (162). Tests 2496 passed \| 104 skipped (2600). Baseline del leader: 2481 passed, 104 skipped; el delta +15 son los casos nuevos, ninguno falla |
| `pnpm exec tsc --noEmit -p tsconfig.json` | sin errores en `experiment-job.handler.ts`. Hay errores preexistentes en otros specs del repo. En `experiment-job.handler.spec.ts` queda el de la línea 678 (preexistente, fuera del bloque nuevo). El error que introduje en la línea ~4671 quedó corregido |
| `node harness/validate-harness.mjs` (desde raíz) | exit 0, "Harness V3 validation passed." |

`git status`: solo `app/src/experiments/experiment-job.handler.ts` y `app/src/experiments/experiment-job.handler.spec.ts` modificados. No se tocaron `spec/`, `harness/state.json`, `harness/work-items.json`, ni `analysis-run-validation-job.handler.ts`.

## 4. Desvíos y hallazgos

1. Criterio de método: `handle` (líneas 156–326, ~171 líneas) supera el umbral de ~120 líneas del criterio de aceptación ("ningún método del handler de experimentos supera ~120 líneas"). Es preexistente y no pertenece a `runAttempt`; no se tocó. Requiere decisión: incluirlo en este corte o abrir un seguimiento.
2. Caso de validación del SDD (punto 2, orden en el handler de validación) no cubierto: el corte A no toca validación; queda para el corte B.
3. Conteo: el informe SDD menciona 111 casos en el handler spec; el archivo tenía 108 antes de este corte.
4. `SandboxAcceptedExecutionError` hereda de `SandboxUnavailableError`, por eso el resumen es "Sandbox no disponible." y no el genérico. Se caracteriza tal cual; no es un cambio.
5. No se midió sensibilidad de mutación: los casos se validaron en verde antes y después del refactor, pero no se comprobó con mutaciones que fallen ante cambios de orden.
6. Contract Sync: `contractImpact=false`, sin cambios en `spec/contracts/`, `contracts:check` en verde. El PULL `implementation-delivery` lo registra el leader.

## 5. Archivos afectados

- `app/src/experiments/experiment-job.handler.ts`
- `app/src/experiments/experiment-job.handler.spec.ts`
- `harness/reports/wi-core-070-corte-a.md` (este reporte)
