# WI-CORE-048 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low); verificación del leader.

## Rojo → verde
Antes del cambio fallaban 7 de 58 pruebas del spec del handler (las nuevas y las dos que fijaban `TECHNICAL_GENERATION_FAILURE` para Sandbox no disponible y ejecución aceptada sin resultado, ahora `INFRASTRUCTURE_FAILURE` con comentario `DEC-VAL-002`). Después pasan. Casos: plataforma + AVAILABLE (Run `INFRASTRUCTURE_FAILURE`, `generatedTestsCount` 1, `resultSummary` con el símbolo, evidencia por ejecución sin cambio), timeout + mismatch → `BEHAVIORAL_MISMATCH`, categoría `INFRASTRUCTURE` → `INFRASTRUCTURE_FAILURE`, plataforma + COMPILATION → `TECHNICAL_GENERATION_FAILURE`, plataforma + ya cubierto → `INFRASTRUCTURE_FAILURE`, UNKNOWN y excepción genérica siguen técnicos con el texto anterior.

## Suite y análisis
- `npx vitest run` (app): 140 archivos pasan, 6 omitidos; 2180 pruebas pasan, 104 omitidas (incluye experimentos, check-conclusion y test-publications sin cambios).
- `npx oxlint src/validation`: sin hallazgos.
- `tsc --noEmit`: 45 errores antes (HEAD limpio en worktree desechable) y 45 después, mismos archivos (delta 0).
- `node harness/validate-harness.mjs` y `node --test harness/*.test.mjs` (31/31) pasan.
- Sin `nest build`/`pnpm run build` en `app/`.

## Condición del usuario
Solo `validation/analysis-run-validation-job.handler.ts` y su spec. `sandbox/map-sandbox-result.ts`, experimentos, OE2/OE5, evidencia por ejecución (`recordExecution` mantiene `TECHNICAL_GENERATION_FAILURE`) y métricas sin cambios. Check `neutral` por el mapeo existente de `INFRASTRUCTURE_FAILURE`; publicación `409 TEST_PUBLICATION_INVALID_RUN_STATUS` por la regla existente (Run no `SUCCESS`).

## Corte B (hallazgos F1 y F2 de la revisión independiente)
Solo pruebas (`analysis-run-validation-job.handler.spec.ts`, +78 líneas): evidencia por ejecución `TECHNICAL_GENERATION_FAILURE` en TIMED_OUT y en FAILED con categoría `INFRASTRUCTURE`, y resumen exacto con plataforma + técnico + AVAILABLE. Mutantes: registrar `INFRASTRUCTURE_FAILURE` como evidencia → fallan 2 pruebas; contar plataforma también como técnico → falla 1. Handler byte a byte igual. `npx vitest run` completo: 140 archivos / 2183 pruebas pasan; oxlint limpio; tsc 45 (delta 0).
