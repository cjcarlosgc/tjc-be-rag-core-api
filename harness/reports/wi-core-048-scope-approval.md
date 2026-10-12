# WI-CORE-048 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Autoriza:** Jean (Human Reviewer), directamente en el chat de Core: «Sí, cerrar y empezar 048» y la aprobación de `DEC-VAL-002` («La recomendada, sin afectar métricas»; SYSTEM-2.10).

## Alcance
Alinear la clasificación por símbolo y la precedencia del estado del Run a `DEC-VAL-002`: `BEHAVIORAL_MISMATCH` > `TECHNICAL_GENERATION_FAILURE` > `INFRASTRUCTURE_FAILURE` > `SUCCESS` > `NO_ADDITIONAL_TESTS_REQUIRED`/`NO_TEST_RELEVANT_CHANGES`. Fallo de plataforma por símbolo: `SandboxUnavailableError` (incluye la ejecución aceptada que no llega a resultado), timeout del Sandbox o categoría `INFRASTRUCTURE`; `UNKNOWN` sin evidencia no cuenta.

## Condición del usuario (criterio de aceptación)
Confinado a `validation/analysis-run-validation-job.handler.ts` y la clasificación del `AnalysisRun`. No altera experimentos (008), OE2/OE5, evidencia ni métricas existentes: el valor de evidencia por ejecución de `recordExecutionBestEffort` se mantiene (solo se distingue el outcome del Run). `sandbox/map-sandbox-result.ts` no se toca (o, si hiciera falta, con prueba de no regresión sobre experimentos); si se encuentra que afecta métricas o evidencia, `DECISION_REQUIRED` y se detiene.

## Consecuencias aceptadas
Run `INFRASTRUCTURE_FAILURE` conserva las propuestas `AVAILABLE` consultables, Check `neutral`, y no es publicable (`409 TEST_PUBLICATION_INVALID_RUN_STATUS`) hasta reintentar; `resultSummary` indica los símbolos sin veredicto por plataforma.
