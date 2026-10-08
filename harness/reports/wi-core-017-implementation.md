# WI-CORE-017 — Implementación y evidencia
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium (sesión Cross)

## Corte
Solo SDD y Harness; cero cambios en `app/`. SYSTEM-2.6 e INTEROP-2.7 (roles, `UNKNOWN`, Functional Knowledge, OE2, OE5, trace, evidencia y decisiones), specs/planes/tareas de 004, 008, 011, 013, 014, providers y experimental-metrics, HU17 en el backlog, `CHANGELOG.md`, registro de `WI-CORE-018` a `WI-CORE-029`, prioridades y secuencia en `harness/progress/current.md`.

## Checks
- `node scripts/sdd-check.mjs`, `node harness/validate-harness.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-completions.mjs` y `git diff --check`: pasan.
- No se ejecutan lint, pruebas ni build de aplicación: no hay cambios en `app/`.

## Contrato
Publica `CS-CORE-20261008-001` (`breaking: true`: el enum `ProjectRole` agrega `WRITER` y `write` deja de producir Maintainer). Los espejos de Console y GitHub Integration los sincronizan `WI-CONSOLE-011` y `WI-GH-010`; este WI no modifica ningún otro repositorio.
