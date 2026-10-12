# WI-CORE-048 — preparación (OC08, sin implementar)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Estado `W-PLANNED`. Depende de `WI-CORE-047` (contrato). SDD breve:

- **Dónde:** `validation/analysis-run-validation-job.handler.ts` (`validateSymbol` catch y `classifySymbolFailure`, `classifyRun`, `buildResultSummary`; el job ya soporta `SymbolOutcome`). `sandbox/map-sandbox-result.ts` ya mapea `TIMED_OUT` e `INFRASTRUCTURE` a `failureType: 'INFRASTRUCTURE'` y es compartido con experimentos (008): preferir decidir en el handler de validación sin tocarlo; si se toca, prueba de no regresión sobre experimentos.
- **Cambio:** nuevo `SymbolOutcome` kind de plataforma; `classifyRun` aplica la precedencia aprobada; el `resultSummary` cuenta aparte los fallos de plataforma; `HELD` y `failureSummary` por símbolo se conservan.
- **Riesgos:** (1) `SandboxUnavailableError` y `SandboxAcceptedExecutionError` hoy se registran como `TECHNICAL_GENERATION_FAILURE` en `recordExecutionBestEffort` (evidencia por ejecución): cambiar ese valor puede alterar la evidencia exportada; la condición del usuario exige no cambiarla (mantener el valor de evidencia y distinguir solo el outcome del Run) o `DECISION_REQUIRED`; (2) el Check pasa a `neutral` y el companion PR deja de ser publicable con propuestas válidas: es la consecuencia aprobada; (3) pruebas roja-verde por par de la precedencia y de no regresión de experimentos.
- **Pruebas:** `analysis-run-validation-job.handler.spec.ts` (excepción de Sandbox por símbolo + mismatch/técnico/éxito en otros símbolos), `check-conclusion.util.spec.ts`, y, si se toca el mapeador, `map-sandbox-result.spec.ts` y las pruebas de experimentos.
