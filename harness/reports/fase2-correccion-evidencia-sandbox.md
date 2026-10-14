# Corrección: el Sandbox sí devuelve evidencia acotada; Core la descarta

Fecha: 2026-10-13. Solo lectura. Corrige afirmaciones de WI-CORE-053 y del diagnóstico #6 («el Sandbox no devuelve stdout/stderr»; «exigiría extender el contrato del Sandbox»). **Cross tenía razón; la premisa de Core era errónea.**

## 1. Evidencia (archivo:línea)

- Contrato canónico (`spec/contracts/interoperability-contract.md` ~1458–1485): `ExecutionEvidenceKind = COMPILER_STDOUT | COMPILER_STDERR | TEST_STDOUT | TEST_STDERR | RUNNER_REPORT`; `ExecutionEvidenceFact {kind, stage, content, truncated, originalBytes}`; `SandboxExecutionResultResponse` incluye `stageDurations[]`, `evidence[]`, `startedAt`, `completedAt`.
- Sandbox (`tjc-be-test-execution-sandbox/app/src/executions/execution-pipeline.service.ts:108,256,303,326,350`): construye `evidence[]` y `stageDurations[]` y los devuelve en el resultado.
- Core, dónde se pierden:
  1. **Tipo del cliente:** `app/src/sandbox/sandbox.types.ts` — `SandboxExecutionResult` modela `status`, `facts`, `failure`, `stageDurations`, ids y `durationMs`; **no tiene `evidence`, `startedAt` ni `completedAt`**.
  2. **Lectura del resultado:** `app/src/sandbox/sandbox-execution.service.ts` (`fetchResult`): el `getJson<…>` solo declara `status/facts/failure/stageDurations` y el objeto devuelto copia esos cuatro; `evidence[]`, `startedAt` y `completedAt` llegan en el JSON pero **se ignoran en el cliente**, antes de `mapSandboxResult` y de la persistencia.
  3. `app/src/**` no contiene referencias a `COMPILER_STDOUT`/`TEST_STDOUT`/`TEST_STDERR` ni lee `.evidence` del Sandbox (grep).
- `stageDurations[]` sí llega y, desde WI-CORE-053, se persiste dentro de `experiment_repetition_artifacts.runnerReport.stageDurations`. **No** está en `sandboxFacts` (sus 14 claves: passed, runner, compiled, executed, totalTests, passedTests, failedTests, skippedTests, testCasesTruncated, executionProfile, failureStage, failureCategory, failureCode, failureMessage).

## 2. Distribución por etapa de los 54 trials del piloto V1 (SELECT de solo lectura)

54/54 trials tienen `runnerReport.stageDurations`. Milisegundos:

| Etapa | n | mín | mediana | media | máx |
|---|---|---|---|---|---|
| PREPARING | 54 | 296 | 466 | 591 | 4 075 |
| INSTALLING_DEPENDENCIES | 54 | 1 720 | 4 070 | 3 550 | 5 319 |
| RUNNING_TESTS | 54 | 411 | 550 | 541 | 754 |

Por proyecto (media, ms): SAL — preparación 818, instalación 4 273, pruebas 570; RES — 518, 4 397, 552; SUB — 436, 1 979, 502.

**Los 19–25 s NO se explican por las etapas del Sandbox.** La suma de etapas promedia **4 682 ms** por trial, mientras `executionDurationMs` (Core, desde el `POST /executions` hasta tener el resultado) promedia **16 629 ms**: ≈ **12 s** por trial quedan fuera de PREPARING/INSTALLING/RUNNING. En SAL/RES `executionDurationMs` ronda 19–25 s (≈ 15 s sin explicar); en SUB ≈ 7–9 s (≈ 5 s sin explicar). Candidatos (no verificables hoy): latencia de polling de Core (`pollAfterMs`), arranque/cola del contenedor antes de PREPARING, descarga del snapshot y de artefactos por presigned URL, o latencia de red del túnel. Para atribuirlo hace falta `startedAt`/`completedAt` del Sandbox (hoy descartados): `completedAt − startedAt` frente a `executionDurationMs` separa «tiempo del Sandbox» de «tiempo de espera/polling/red de Core».

## 3. Corrección del diagnóstico #6 (sin implementar)

- Persistir `evidence[]` acotada (ya limitada a 8 KiB por entrada con `truncated`/`originalBytes`) y `startedAt`/`completedAt` **no requiere cambiar el Sandbox ni el contrato**: es leer campos que el contrato ya define y que el Sandbox ya emite.
- Cambio mínimo: (a) ampliar el tipo del cliente y `fetchResult` para conservar `evidence`, `startedAt`, `completedAt`; (b) guardarlos, saneados y acotados, en `experiment_repetition_artifacts` (migración aditiva nullable); (c) sin exponerlos en DTO público ni §6.16. Riesgo bajo; filas previas sin dato (sin backfill: los 54 trials V1 no tendrán stdout/stderr).
- Roza la tesis/paper: no. Refuerza la cadena de evidencia («salida exacta de la estrategia»). Atención a gobierno de datos: stdout/stderr puede contener código de terceros (DEC-VAL-001 PENDING; solo repos de piloto).
- Frase de aprobación #6 reescrita en `fase2-diagnostico-items-4-5-6.md` (incluye `evidence[]` y `startedAt/completedAt`).

Modelo: Claude Sonnet 5.5 (diagnóstico, sin cambios en `app/`).
