# Evidencia — HU23 (autorreparación acotada)

**Sprint:** Sprint 3 · **Historia:** HU23 · **Estado:** DONE

## Contexto

Tercera pieza de `009-history-realtime-repair`. La spec ya definía el comportamiento requerido: "generate -> sandbox -> failure -> RepairContext -> LLM repair -> rerun, máximo configurable" y "RepairContext incluye test, fallo, stdout/stderr relevante, runnerResult y contexto original". La autorreparación nunca debe activarse durante las corridas experimentales de HU19.

## Cambios de código

- **`prisma/schema.prisma`**: `TargetRunResult.repairAttempts Int @default(0)`. Migración `20260906182157_target_run_result_repair_attempts` generada con `prisma migrate diff --from-config-datasource` y aplicada con `prisma migrate deploy` contra la Supabase real. No se expone todavía vía HTTP (sin cambio de contrato; el campo es interno/observabilidad por ahora).
- **`src/generation/repair/repair-context.ts`** (nuevo): `RepairContext` — `generationContext` (mismo objetivo/chunks relacionados que el intento inicial), `failedTestContent` (la prueba que falló), `failureType`/`errorSummary` (el fallo), `runnerFacts` (hechos completos del runner, incluye el `errorMessage` por caso — el "stdout/stderr relevante" del contrato), `attempt`.
- **`src/generation/repair/repair.service.ts`** (nuevo): `RepairService`, separado del generation first-shot — arma el prompt de reparación vía `PromptBuilder.buildRepair` y delega en el mismo `LLMProvider` inyectado (`LLM_PROVIDER`, comparte config/timeout/retry con el resto).
- **`PromptBuilder.buildRepair`**: nuevo método — código objetivo, prueba previa que falló, tipo de fallo, resumen del error y casos fallidos (si hay `runnerFacts`); pide únicamente el TypeScript corregido completo.
- **`TestGenerationJobHandler.processTarget`**: reestructurado en un loop acotado por `GENERATION_MAX_REPAIR_ATTEMPTS` (config, default 2). En cada vuelta: aplica CREATE/MERGE sobre el contenido base original (nunca apila intentos), corre el Sandbox, mapea el resultado. Si el veredicto es `INVALID` y quedan intentos, llama a `RepairService.repair(...)` y reintenta con el contenido corregido; si es `VALID`, o el fallo no es `INVALID` (p. ej. `INFRASTRUCTURE`/`CONFIGURATION`, no reparables regenerando la prueba), o se agotan los intentos, termina el loop y registra el resultado final con `repairAttempts`.
- **Config**: `GENERATION_MAX_REPAIR_ATTEMPTS` (`env.validation.ts`, `.env.example`/`.env`, default 2, `@Min(0)` — `0` deshabilita la autorreparación por completo).
- **`GenerationModule`**: registra `RepairService`.
- **`ExperimentJobHandler` (008): sin cambios.** No referencia `RepairService`; su constructor y flujo de repetición no tienen ningún punto de enganche para el repair loop, verificado con un test dedicado (`experiment-job.handler.spec.ts`: un resultado `INVALID` en las 6 repeticiones produce exactamente 6 llamadas al Sandbox, una por repetición, sin reintentos).

## Verificación

- `pnpm lint` → OK.
- `pnpm tsc --noEmit` → OK (mismos 2 errores preexistentes no relacionados, confirmados sin tocar esos archivos).
- `pnpm test` → 181/181. Nuevos: `repair.service.spec.ts` (delega prompt+LLM correctamente); casos añadidos a `prompt-builder.service.spec.ts` (`buildRepair`: incluye código/prueba fallida/tipo de fallo, omite secciones cuando no hay `runnerFacts`/`errorSummary`); 3 casos nuevos en `test-generation-job.handler.spec.ts` (repara y agota intentos registrando `repairAttempts: 2`; repara con éxito y registra `VALID` con `repairAttempts: 1`; `GENERATION_MAX_REPAIR_ATTEMPTS=0` deshabilita la autorreparación); 1 caso nuevo en `experiment-job.handler.spec.ts` (no interacción con HU19).
- `pnpm test:e2e` → 12/12 (sin cambios; `RepairService` se resuelve correctamente por el contenedor real de Nest).
- `pnpm build` → OK.

## Limitaciones documentadas

- `repairAttempts` no se expone todavía en `TestRunResultsResponse`/`TargetRunResultResponse` vía HTTP — solo se persiste. Si se necesita visibilidad de producto sobre cuántos intentos de reparación tomó un target, requiere un cambio de contrato aditivo futuro.
- El repair loop solo actúa sobre veredictos `INVALID` (compiló y ejecutó pero no pasó): fallos `FAILED` (`INFRASTRUCTURE`/`DEPENDENCY`/`CONFIGURATION`/`UNKNOWN`) no son reparables regenerando la prueba y no entran al loop, consistente con que ningún cambio de código de prueba puede arreglar, por ejemplo, un Sandbox no disponible.

## Nota de alcance

`retry manual` (HU24) queda explícitamente fuera de esta iteración — es Sprint 4. "Revisión requerida" cuando se agotan los intentos de HU23 es, por ahora, simplemente el resultado `INVALID` final persistido; HU24 agregará el mecanismo de reintento explícito sobre ese estado.
