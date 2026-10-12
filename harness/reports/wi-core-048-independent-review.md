# WI-CORE-048 — revisión independiente (ciclo 1 de 2)

Reviewer: agente `reviewer` (Modo fuera de casa activo), independiente del implementer (claude-haiku-5-5). HEAD 305053f; rango revisado `725bb74^..305053f`.

## Veredicto: APPROVED

Sin incumplimientos bloqueantes. Hallazgos menores (Low) listados abajo; ninguno exige corrección para cerrar el WI.

## Verificado con evidencia ejecutada

1. **Plataforma por símbolo** (`analysis-run-validation-job.handler.ts`, `validateSymbol`): `platformFailure` solo si `error instanceof SandboxUnavailableError` (incluye `SandboxAcceptedExecutionError`, subclase) o `outcome.failureType === 'INFRASTRUCTURE'` (que `mapSandboxResult` produce para `TIMED_OUT` y categoría `INFRASTRUCTURE`). Compilación, aserción, TEST_RUNTIME, dependencia, configuración, `UNKNOWN`, excepción genérica y PHP sin `<?php` / sin framework siguen técnicos. Sondas ejecutadas en worktree: `FAILED`+categoría `INFRASTRUCTURE` con facts presentes → Run `INFRASTRUCTURE_FAILURE`; `TIMED_OUT` → `INFRASTRUCTURE_FAILURE`; plataforma + excepción genérica + AVAILABLE → `TECHNICAL_GENERATION_FAILURE`, `generatedTestsCount` 1, resumen «1 fallo(s) técnico(s) …, 1 fallo(s) de plataforma sin veredicto (Thing.first)».
2. **Precedencia** (`classifyRun`): MISMATCH > TÉCNICO (no plataforma) > INFRA > SUCCESS > NO_TEST/NO_ADDITIONAL. Cubierta por pruebas: plataforma+AVAILABLE, plataforma+mismatch, plataforma+compilación, plataforma+cubierto, solo plataforma. Run INFRA conserva propuestas AVAILABLE y `generatedTestsCount`; `functionalBehaviorValidated` false; Check `neutral` por `check-conclusion.util.ts` (sin tocar); publicación 409 por `test-publications.service.ts:53` (`status !== 'SUCCESS'`, sin tocar). `resultSummary` solo agrega el sufijo cuando hay fallos de plataforma; sin ellos el texto es idéntico al previo (prueba con texto exacto).
3. **Condición del usuario**: el rango toca solo 2 archivos de `app/` (handler y spec), sin migraciones ni contratos. `map-sandbox-result.ts`, `experiments/`, `retrieval-comparisons/`, `evidence/` sin cambios. `recordExecution`/`recordExecutionBestEffort` reciben el mismo `kind` (`TECHNICAL_GENERATION_FAILURE`) y `analysis_run_executions.outcome` no cambia (probado en el caso aceptado, y por sonda para TIMED_OUT y categoría INFRASTRUCTURE: outcome `TECHNICAL_GENERATION_FAILURE`). Trace y evidencia 027 leen `outcome` por ejecución y el `status` del Run solo como valor ya enumerado; forma sin cambio. Consumidores de `analysis_runs.status` (grep de `INFRASTRUCTURE_FAILURE`/`TECHNICAL_GENERATION_FAILURE` en `app/src`): `check-conclusion.util.ts`, `analysis-runs.service.ts` (transiciones: ambos terminales solo a `OBSOLETE`), `test-publications.service.ts`, `snapshot-analysis-job.handler.ts` (usa INFRA a nivel job, ya existente), DTO del trace (solo comentario). Listados filtran por status literal. Ninguno interpreta mal un Run INFRA. Ninguna métrica/experimento depende del status del Run de PR (evidence/experiments no consultan `analysisRun.status` salvo el guard NOT_FINISHED). Consecuencia visible y aprobada: para los mismos datos, el `status` del Run (y por tanto su Check y listado) cambia de `TECHNICAL_GENERATION_FAILURE` a `INFRASTRUCTURE_FAILURE` solo en Runs con fallo de plataforma; es el cambio aprobado por DEC-VAL-002, no una alteración de evidencia ni de métricas.
4. **Mutaciones** (worktree desechable, ya eliminado), spec del handler, 58 pruebas: invertir infra/técnico → falla (1); infra sobre mismatch → falla (2); SUCCESS sobre infra → falla (1); UNKNOWN como plataforma → falla (1); quitar clasificación por categoría INFRASTRUCTURE → falla (2); quitar excepción Sandbox como plataforma → falla (5); toda excepción como plataforma → falla (1); evidencia de ejecución aceptada a INFRASTRUCTURE_FAILURE → falla (2); quitar agregación al resumen → falla (3). **Dos mutantes sobrevivieron** (ver F1 y F2).
5. **Gates**: `npx vitest run` completo 2 corridas: 140 archivos pasan / 6 omitidos, 2180 pruebas pasan / 104 omitidas (ambas). `npx oxlint` (app completo): exit 0, sin hallazgos. `tsc --noEmit`: 45 errores en HEAD y 45 en la base `725bb74^` (mismo conjunto por archivo; 1 en el spec del handler en ambos, preexistente). `node harness/validate-harness.mjs`: pasa. `node --test harness/*.test.mjs`: 31/31. Higiene: ambos commits con `Refs: HU04, HU11, HU13, HU14` y trailer `Claude Haiku 5.5` (código) / `Claude Sonnet 5.5` (docs). Rango sin migraciones, sin contratos, `app/` solo los 2 archivos. e2e no ejecutado (requiere DB/Sandbox reales; no viable sin build ni infraestructura). No se ejecutó build ni se tocó `app/dist`.

## Hallazgos

| ID | Sev. | Ubicación | Descripción |
|----|------|-----------|-------------|
| F1 | Low | `analysis-run-validation-job.handler.spec.ts` (nuevo describe) | El valor de evidencia por ejecución solo está afirmado en el caso `SandboxAcceptedExecutionError`; el mutante que registra `INFRASTRUCTURE_FAILURE` para timeout/categoría INFRASTRUCTURE (`recordExecutionBestEffort(..., kind)` en la rama de resultado) sobrevive. El comportamiento es correcto (sondeado y por lectura), pero la condición crítica del usuario queda sin red de pruebas en esa rama. Recomendado añadir una aserción en un siguiente corte. |
| F2 | Low | mismo spec | El conteo `failed` del resumen que excluye plataforma no tiene aserción exacta con plataforma + técnico (mutante que cuenta plataforma también como técnico sobrevive; solo hay `stringContaining` del sufijo). Verificado por sonda: «1 fallo(s) técnico(s) …, 1 fallo(s) de plataforma» correcto. |
| F3 | Low | `spec/contracts/system-contract.md:155,283`; `spec/features/013-pr-driven-analysis/spec.md:79` | Texto «implementación pendiente» / «hasta que el WI de código se cierre … sigue siendo TECHNICAL» quedó obsoleto tras este cambio (deuda editorial ya declarada; SYSTEM requiere bump, spec.md:79 puede corregirse sin bump). |
| F4 | Info | `sandbox-execution.service.ts:166-182` | `SandboxAcceptedExecutionError` envuelve cualquier excepción posterior a la aceptación (p. ej. resultado ilegible) y se clasifica como plataforma; coherente con «Sandbox rechazó/no terminó la ejecución» de DEC-VAL-002 y con la lectura del prepare; sin acción. |

## Blockers
Ninguno. Sin decisión abierta (`DEC-VAL-002` APROBADA, Blocks NONE).

## filesAffected (revisados, sin modificarlos)
- app/src/validation/analysis-run-validation-job.handler.ts
- app/src/validation/analysis-run-validation-job.handler.spec.ts
- Creado: harness/reports/wi-core-048-independent-review.md (sin commitear)

## recommendedNextStep
Leader: registrar el veredicto APPROVED (ciclo 1/2) en `harness/state.json` y cerrar WI-CORE-048 (`W-DONE`); en el próximo bump de SYSTEM actualizar «implementación pendiente» y opcionalmente reforzar F1/F2. Sin push, PR ni infraestructura externa.
