# WI-CORE-080 — verificaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Inventario de solo lectura: no toca `app/`, contratos, esquemas ni `referencias/`, por lo que lint, build y tests no aplican (último estado verificado del código: `83d758e`, 2646 tests unitarios y 259 e2e). Verificaciones de este corte: `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs` y `node harness/validate-completions.mjs` en verde al cierre; `git diff` del WI limitado a `harness/` y `spec/features/017-cross-repository-dependency-gates/tasks.md`.
