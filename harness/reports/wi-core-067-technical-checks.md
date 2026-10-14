# WI-CORE-067 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low), un corte (commit 1e782b0); verificación del leader.
- Código: `php-phpunit-conventions.ts` (líneas 2 y 4 reescritas, versión `php-prompt-2026-10-14.6`), banco `harness/calibration` (R-ANON-FINAL con `implements` de clase final conocida; evidencia `cannot implement … not an interface`; regla nueva R-NEW-ENUM).
- Rojo → verde (confirmado por el leader con stash del código de producto y del banco): 5 pruebas de app fallan (versión .6, redacción de las cinco líneas, líneas reforzadas, igualdad en ambos brazos, versión en depth2.spec) y 5 del banco (`implements`, evidencia, R-NEW-ENUM ×2, caso válido); con el código restaurado pasan.
- `npx vitest run` (app): 148 archivos pasan, 7 omitidos; 2426 pruebas pasan, 104 omitidas. `oxlint src` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base, delta 0). `validate-harness` y `node --test harness/*.test.mjs harness/calibration/*.test.mjs` (69 pruebas) pasan. Sin build; sin migraciones; sin contrato ni traza.
- Riesgos: +36 tokens por prompt PHP en ambos brazos; el efecto sobre el LLM solo se mide con un experimento nuevo; la redacción cambia para ambos brazos al desplegar.
