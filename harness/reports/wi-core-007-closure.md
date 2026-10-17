# Cierre — WI-CORE-007
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09 (America/Lima)
**Estado:** `W-DONE`
**Historias:** HU12, HU17
**Subtarea:** ST-CORE-007

## Revisión
- El usuario **delegó explícitamente en el chat** la revisión independiente a un agente `reviewer` y **confirmó en chat** que `WI-CORE-007` entra en el alcance aprobado (`smart-v3-scope-approval.md`). Ciclo 1: `CHANGES_REQUESTED` (2 importantes: coste cuadrático del saneado y fugas; 2 menores); corte C (`aa141ce`). Ciclo 2: `APPROVED`, sin blockers, 9/9 mutaciones detectadas y sin ReDoS residual (`wi-core-007-independent-review.md`). Ciclos de revisión: 2 de 2.
- La delegación no sustituye la aprobación humana de alcance y arquitectura (confirmada por el usuario).

## Qué entrega
Columna interna JSONB nullable `failure` en `ExperimentRepetition` (migración aditiva `20261009180000`, sin backfill) con el hecho `{stage, category, code, message}` saneado, escrito en la escritura terminal guardada por `RUNNING`; helper puro `sanitizeFailureMessage` (tope de entrada 16 384, redacta antes de truncar a 500). `ExperimentRepetitionResponse`, `TargetRunResult` e INTEROP sin cambios; sin Contract Sync.

## Deudas y verificaciones pendientes
- `IDEA-015` (`map-sandbox-result.ts`: categoría sin validar y `errorSummary` crudo) e `IDEA-016` (log crudo de `sandbox-execution.service.ts`, familias de patrones sin cubrir, `code` sin redactar, spread de `ExperimentRepetitionInput`); conviene resolver o acotar `IDEA-016` antes de que `WI-CORE-027` exponga `failureMessage`.
- Migración `20261009180000` sin aplicar a ninguna base real; verificación con Postgres real pendiente del agente principal.
- Sobre-redacción aceptada del helper (`https://host/@scope/pkg`; comilla sin cierre).

## Verificaciones
lint 0; test 1770 pasan y 82 omitidos; build 0; e2e 237; tsc 43 con cliente regenerado; `validate-harness` pasa.
