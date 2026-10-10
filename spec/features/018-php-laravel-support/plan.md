# 018 — Plan de PHP/Laravel V1

La entrega se divide en cortes locales verificables; no equivale a completar toda la compatibilidad PHP.

1. **WI-CORE-012 / ST-CORE-019 — HU03, HU04:** registrar decisión y evidencia del parser, clasificar el snapshot, extender discovery/AST/chunking e inventario PHP, persistir el lenguaje, y sincronizar el contrato `INTEROP-2.6` hacia Console. No cambiar UI ni Sandbox.
2. **WI-CORE-013 / ST-CORE-020 — HU10, HU11:** planificado y dependiente de WI-CORE-012. Añadir generación de pruebas PHPUnit y profile/runner PHP coordinado con el contrato Core–Sandbox. No seleccionar hasta revisar/cerrar WI-CORE-012 y coordinar el contrato con el dueño actual de Sandbox.

Los cortes trazan a EP02 (inteligencia de repositorio) y EP04 (generación/validación). HU03/HU04/HU10/HU11 siguen siendo transversales; cada repo registra solo sus propios WIs. El contrato PHP define desde ahora el vector de compatibilidad, pero este WI solo implementa análisis e inventario en Core.

## Verificación de WI-CORE-012

- El harness valida decisión, una subtarea local y un WI activo; contract-sync start se registra antes del cambio de código.
- Pruebas de parser y descubrimiento cubren namespace/FQCN, class/trait/function/method, tests existentes, exclusiones, PHP sobre TS cuando ambos manifests están presentes, y regresión TS sin cambios.
- Prisma migration backfillea versiones existentes a `TYPESCRIPT`; nuevas versiones PHP persisten `PHP`; DTOs corresponden exactamente a INTEROP-2.6.
- Lint, suite focal/full según factibilidad, build, SDD y Harness. Los límites de sandbox/runner real se registran sin afirmar verificación E2E.

## WI-CORE-013 — cortes

1. Tipos: `sandbox.types.ts` (`PHPUNIT`, `failureKind`), `EXECUTION_PROFILE_BY_RUNNER.PHPUNIT`, `GenerationContext.metadata` por lenguaje.
2. `PromptBuilder` PHP + saneamiento de la respuesta; `phpTestPath` (DEC-PHP-GEN-001).
3. `AnalysisRunValidationJobHandler`: quitar el bloqueo PHP y ramificar por lenguaje (prompt, ruta, CREATED, runner).
4. `mapSandboxResult` con `failureKind` (DEC-PHP-GEN-002).
5. INTEROP canónico §7.3/§7.4 + Contract Sync a Console y Sandbox.
6. Pruebas unitarias por regla; regresión TypeScript intacta.
