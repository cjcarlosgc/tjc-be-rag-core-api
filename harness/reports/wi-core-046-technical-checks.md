# WI-CORE-046 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low); verificación del leader.

## Rojo → verde
Antes del cambio fallaban 2 pruebas nuevas (lookupStatus ausente en el error; el job rechazaba en vez de completar). Después: `snapshot-analysis-job.handler.spec.ts` y `github-repository-content.service.spec.ts` 39/39. La prueba de no regresión (otra causa o error sin `lookupStatus` sigue relanzando y el UNVERIFIABLE de otra operación conserva su mensaje) pasa en ambos estados.

## Suite y análisis
- `npx vitest run` (app): 140 archivos pasan, 6 omitidos; 2174 pruebas pasan, 104 omitidas.
- `npx oxlint src/github-app src/snapshot-intelligence`: sin hallazgos.
- `tsc --noEmit`: 45 errores antes (HEAD limpio en worktree desechable) y 45 después; diferencia solo en orden de tipos y un desplazamiento de línea en el spec (delta 0).
- `node harness/validate-harness.mjs` y `node --test harness/*.test.mjs` (31/31) pasan.
- Sin `nest build`/`pnpm run build` en `app/`.

## Alcance
Archivos: `github-app/github-app-auth.service.ts` (campo opcional `lookupStatus`), `github-app/github-repository-content.service.ts` (propaga el estado), `snapshot-intelligence/snapshot-analysis-job.handler.ts` y sus dos specs. No se tocó `sandbox/`, experimentos, evidencia, métricas, contrato, DTO ni migraciones. Nota: INTEROP-2.10 §6.10 describe el mensaje como objetivo pendiente de este WI; tras el cierre conviene una aclaración de estado en el siguiente bump de contrato.
