# Cierre — WI-CORE-021
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-08 (America/Lima)
**Estado:** `W-DONE`
**Historias:** HU05, HU07, HU10
**Subtarea:** ST-CORE-028

## Revisión
- Revisión independiente humana: `APPROVED` por el usuario en chat, condicionado a formalizar la persistencia de la traza en `WI-CORE-026` (`wi-core-021-user-review.md`; obligación registrada en `spec/features/011-context-traces` y en los criterios de `WI-CORE-026`).
- Sin impacto contractual (`contractImpact=false`); no hay revisión contractual ni evento Contract Sync publicado.
- Ciclos de revisión: 0 de 2; `retryLimitRespected` aprobado con esta evidencia.

## Contratos y sincronización
- Contract Sync `before-done`: PASS, sin pendientes relevantes; `CS-20260920-001` y `CS-20260921-003` NOT_RELEVANT para este WI.
- El cierre local no implica push, despliegue ni cutover.

## Deuda aceptada
- La traza persistida de experimentos no guarda `functionalRules` ni procedencia; el test de `experiment-job.handler.spec.ts` exige hoy esa ausencia. `WI-CORE-026` debe persistir en `context_id` los `functionalRuleIds`, conteos y motivos de omisión con `knowledgeId`, invertir esa aserción y, si expone los campos, actualizar INTEROP-2.7 con Contract Sync a Console.
- El default `[]` del quinto parámetro de `ContextBuilder.build` es solo por compatibilidad.

## Verificaciones
Desde `app/`, 2026-10-08, con DATABASE_URL/DIRECT_URL = postgresql://nouser:nopass@127.0.0.1:1/none exportadas (existe `app/.env` local, sin sobrescribirse; las variables de entorno tienen precedencia): `pnpm lint` exit 0; `pnpm test` 109 archivos pasan, 1 omitido, 1352 tests pasan, 36 omitidos; `pnpm build` exit 0; `pnpm test:e2e` 7 archivos, 222/222; `node harness/validate-harness.mjs` pasa.
