# WI-CORE-075 — verificaciones técnicas (carril FAST, solo documentación)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

El WI solo cambia texto de `spec/transversal/providers/spec.md` y `spec/features/008-experimental-comparison/spec.md`; no toca `app/`, por lo que lint, build y tests de producto no aplican (el último estado verificado del código es `3d2383e`: 2618 tests unitarios y 259 e2e). Verificaciones de este corte, desde la raíz con Node 22.23.3: `node scripts/sdd-check.mjs` OK; `node harness/validate-work-items.mjs` OK (76 WI); `node harness/validate-harness.mjs` y `node harness/validate-completions.mjs` en verde al cierre.
