# Verificación SDD — WI-CORE-011

**Fecha:** 2026-09-27
**Estado:** `W-SPEC_VERIFIED`; alcance funcional ya aprobado en la feature y confirmado para continuar en esta sesión.

## Alcance y dependencias

- Work item: `WI-CORE-011`, `HU02`, `HU12`, `HU14`; subtareas `ST-CORE-017` y `ST-CORE-018`.
- Dependencia local `WI-CORE-003`: `W-DONE` (snapshot y cierre en `harness/state.json` / `harness/reports/wi-core-003-closure.md`).
- Dependencia externa `WI-GH-007`: `W-DONE`; Contract Sync `CS-GH-20260927-001` importado y `C-ACKNOWLEDGED`. Ver `harness/reports/external-dependency-verification-wi-core-011.json`.
- El contrato canónico `GH-INTEROP-1.2` ya define `createdAt: string | null` en el webhook y `UNVERIFIABLE` cuando la lectura histórica no confirma la fecha.

## Decisiones y aceptación

- La feature 013 llama a este corte “siguiente corte aprobado”; compara instantes UTC de forma inclusiva (`createdAt >= RepositoryBinding.createdAt`).
- La fecha ausente/no verificable no crea Run ni usa `receivedAt`; mantiene ocultos los Runs sin clasificación durable y reintenta la recuperación.
- Se conserva el historial físico; los pre-binding se marcan `OBSOLETE` y se excluyen de listas, detalles y bandeja antes de paginar.
- No hay decisión `PENDING` o `PROPOSED` cuyo `Blocks` incluya estas HU o esta feature. Las decisiones externas de infraestructura/validación conservan sus blocks acotados y no bloquean el corte.
- No cambia la UI de Console ni Sandbox. No se retiran rutas, no se hace deploy/cutover y se excluye expresamente el trabajo PHP `WI-CORE-013` / `ST-CORE-020`.

## Roles y evidencia

- Handoff `sdd-analyst`: `APPROVED`, sin blockers. Evidencia: inspección SDD, Harness y dependencias registrada durante la sesión.
- `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs` y Contract Sync `start`: resultado registrado por el leader en los gates de `harness/state.json`.

## Próximo paso

Implementar únicamente WI-CORE-011, ejecutar los checks exigidos y presentar el diff consolidado para revisión independiente del usuario. No cerrar el WI antes de ese veredicto.
