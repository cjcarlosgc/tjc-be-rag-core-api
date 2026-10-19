# WI-CORE-070 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: refactor de `runAttempt` y pipeline compartido, más observabilidad de reintentos de GET, sin cambio de comportamiento salvo el log y el contador del corte C (aprobado).

- Corte A (`af05c90`): 15 pruebas de caracterización y `runAttempt` de 347 a 108 líneas. Revisión intermedia: APPROVED_WITH_FINDINGS; F1 (criterio sobre `handle` reescrito sin aprobación) corregido, redacción original restituida.
- Corte B (`ae96def`): `app/src/generation/test-generation-pipeline.ts` adoptado en los dos handlers; 11 pruebas de caracterización que pasan también sobre el código anterior.
- Corte C (`116c324`): log y contador de reintentos transitorios de GET (`transientRetryCount`, `transientRetriesByOperation`).
- Revisión final independiente (`reviewer`): APPROVED, sin blockers (`wi-core-070-independent-review.md`).
- `contractImpact=false`, `publishesContract=false`: sin cambio de contrato; Contract Sync `start`, `implementation-delivery`, `before-review` y `before-done` sin relevantes pendientes (`interopSyncChecked`).
- `retryLimitRespected`: 1 ciclo de corrección (el F1 de la revisión intermedia) de 2 permitidos.
- Evidencia técnica y nota sobre timeouts ambientales: `wi-core-070-technical-checks.md`.

Fuera de alcance, sin tocar: F3 (`WI-CORE-071`, en cola), `handle` (~171 líneas, preexistente; justificado), WI-C y WI-D (en espera por decisión del usuario).
