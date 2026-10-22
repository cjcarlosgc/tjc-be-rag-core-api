# WI-CORE-081 — corregir el filtro de las specs de Postgres en la CI (FAST)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Origen:** el job informativo «Specs con PostgreSQL (pgvector)» del PR #26 falla en la primera ejecución real (`No test files found, exiting with code 1`), tanto en el run del push como en el del evento PR. **Autorización del usuario:** al activar Auto-fix escribió, directamente en el chat de Core: «trata cualquier corrección por tu flujo (WI y reviewer), sin merge ni push sin mi autorización». Este WI sigue ese flujo; el push espera su autorización expresa.

## Causa raíz (verificada en el log de CI y en local)

`.github/workflows/ci.yml` ejecuta `pnpm exec vitest run --reporter=default 'src/**/*.pg.spec.ts'`. Los argumentos posicionales de vitest son filtros de **subcadena** del nombre del archivo, no globs, así que `src/**/*.pg.spec.ts` no coincide con ningún archivo. `prisma migrate deploy` (el paso anterior) sí pasa. Verificación local: `pnpm exec vitest list --filesOnly '.pg.spec.ts'` lista los 6 archivos `*.pg.spec.ts`; con el filtro actual no lista ninguno.

## Cambio

Una línea de `ci.yml`: filtro `.pg.spec.ts` (subcadena) en lugar de `'src/**/*.pg.spec.ts'`. Es configuración de CI (el job es informativo, `continue-on-error: true`); no cambia código de app, contratos ni pruebas. Lo que ocurra al ejecutar de verdad las 6 specs contra pgvector (que nunca habían corrido en GitHub) se evalúa en el siguiente run: si fallan por causas reales, es un hallazgo nuevo a tratar por su propio WI.

Sin push, PR ni merge sin autorización del usuario.
