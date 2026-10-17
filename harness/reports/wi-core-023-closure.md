# Cierre — WI-CORE-023
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-08 (America/Lima)
**Estado:** `W-DONE`
**Historias:** HU17
**Subtarea:** ST-CORE-030

## Revisión
- Revisión independiente humana: `APPROVED` por el usuario en chat, condicionada a corregir la Desviación 1 y validar la migración (`wi-core-023-user-review.md`); ambas condiciones cumplidas.
- Sin impacto contractual; sin evento Contract Sync publicado. Ciclos de revisión: 0 de 2.

## Contratos y sincronización
- Contract Sync `before-done`: PASS, sin pendientes relevantes; `CS-20260920-001` y `CS-20260921-003` NOT_RELEVANT.
- El cierre local no implica push, despliegue ni cutover.

## Precondiciones de despliegue abiertas
- Validar con el runtime/API los esfuerzos de `gpt-6-luna` y cargarlos en `LLM_SUPPORTED_COMBINATIONS` antes de habilitar experimentos.
- Validar la migración `20261008160000_experiment_run_model_config` en el PostgreSQL real.

## Verificaciones
Desde `app/`, 2026-10-08, con DATABASE_URL/DIRECT_URL = postgresql://nouser:nopass@127.0.0.1:1/none: `pnpm lint` exit 0; `pnpm test` 110 archivos pasan, 1 omitido, 1383 tests pasan, 36 omitidos; `pnpm build` exit 0; `pnpm test:e2e` 7 archivos, 222/222; `node harness/validate-harness.mjs` pasa (ver abajo el resultado final). Migración validada en PostgreSQL 14.18 local desechable (ver `wi-core-023-user-review.md`). Commits locales sin push; los trailers de autoría se enmendaron a Claude Sonnet 5.5 (hashes: b13a64a, c9c1ef0, be81ac2, ed57e80).
