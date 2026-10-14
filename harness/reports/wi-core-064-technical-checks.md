# WI-CORE-064 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low) en dos cortes; verificación del leader.
- Código: ver el commit «feat(generation): convenciones PHPUnit con la misma redacción…» (`php-phpunit-conventions.ts`, `prompt-builder.service.ts`, `experiment-job.handler.ts` `buildPhpAgentInstructions` y specs).
- Rojo → verde: posición de las tres líneas en `buildPhp`, igualdad de redacción en ambos brazos (misma constante), prompt PHP sin las líneas igual al previo, TypeScript idéntico, orden de sección de dependencias/reglas/contexto, versión; el test de WI-057 del encabezado de dependencias pasó a buscar el encabezado al inicio de línea porque la línea (c) cita ese texto entre comillas.
- `npx vitest run` (app): 145 archivos pasan, 7 omitidos; 2385 pruebas pasan, 104 omitidas. `oxlint src` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base). `validate-harness` y `node --test harness/*.test.mjs harness/calibration/*.test.mjs` pasan. Sin build; sin migraciones; sin contrato público (el prompt no es contrato).
- Riesgos: +126 tokens por prompt PHP (≈ +10 % a +14,5 %); la versión del prompt no se persiste en la traza (solo en código y `promptSha256`); el efecto sobre la calidad de las pruebas no es medible sin LLM; cambia el comportamiento en producción para PHP al desplegar (ambos brazos).
