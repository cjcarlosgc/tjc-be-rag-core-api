# WI-CORE-054 — texto propuesto para INTEROP-2.13 (previo a editar)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

## Cambios
1. Cabecera `INTEROP-2.13` (fecha 2026-10-13; `Compatible con` `SYSTEM-2.12` sin cambio) y nota en §1 de versión: aditiva; `StrategyMetricsResponse` gana dos campos; sin cambio de rutas ni de campos existentes.
2. `StrategyMetricsResponse` (§6.5.1):
```ts
  technicallyValidRate: number | null // INTEROP-2.13: tasa de repeticiones evaluables con compiled ∧ executed ∧ failureType ∈ {NONE, TEST_ASSERTION}; null si evaluableRepetitions = 0
  assertionFailureCount: number // INTEROP-2.13: repeticiones evaluables con failureType = TEST_ASSERTION (0 si no hay evaluables)
```
3. Semántica (en la viñeta «Semántica observable de las métricas agregadas»): `technicallyValidRate` mide que la prueba generada se compiló y se ejecutó y que su único fallo posible fue una aserción (una prueba técnicamente válida cuya aserción falla es válida para esta tasa), a diferencia de `validRate`/`passedRate` que no cambian. Mismo denominador y reglas de `null` que las demás tasas (DEC-EVID-001): `null` solo si `evaluableRepetitions = 0`; `0` es cero real. `assertionFailureCount` es un conteo (nunca `null`; `0` sin evaluables) y coincide con `failures.TEST_ASSERTION`. Los consumidores deben tolerar su ausencia en respuestas de Cores anteriores (campos desconocidos se ignoran, §1). Diagnóstico técnico, no declara ganador.
4. Sin cambios en SYSTEM salvo, si el reviewer lo exige, la referencia de compatibilidad.

## Preguntas al reviewer
- ¿INTEROP-2.13 aditiva con `breaking: false` y evento a console (espejo byte a byte) y github-integration no? ¿Sandbox no?
- ¿Hace falta una línea en SYSTEM («Calidad, métricas y evidencia») o basta INTEROP?
- Consistencia con `failures` (que cuenta `NONE` y demás) y con la exportación de evidencia §6.16 (¿incluye tasas? ¿debe incluir las nuevas?).
- `assertionFailureCount` tipo `number` no nulo frente a `number | null`.
