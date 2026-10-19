# WI-CORE-070 — revisión independiente final (cortes B y C, estado del WI)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Rango revisado: `ae96def` (corte B) y `116c324` (corte C, HEAD). El corte A se apoya en `wi-core-070-corte-a-review.md` (sin regresión observada). Veredicto: **APPROVED**.

## Corte B
- Comparación con `ae96def~1`: orden de efectos preservado (retrieve → reglas → deps PHP → build; persistTraceEvidence/updateDetail después del contexto y antes del prompt; LLM; `readFile` solo TS y tras generar; PHP inválido → HELD sin fusión ni Sandbox). Argumentos de `contextBuilder.build` (`{framework, language}`, opciones `{}` en validación y `{maxContextTokens}` en experimentos), `promptBuilder.build` (1 o 2 argumentos) y `llm.generate` sin cambios.
- Request al Sandbox idéntico: mismo orden de claves, `executionProfile` solo si la clave se pasa (experimentos sí, validación no), `projectRoot` solo PHP, `artifactId` por `randomUUID`. `artifactType` de experimentos antes derivaba de `existingContent === null`; ahora lo da el merge: equivalente (PHP siempre CREATED con `existingContent` null).
- Namespace: validación conserva `?? undefined`; experimentos pasa `placement.namespace` sin cambio. Ramificar por `context.language` en vez de `phpPlacement` es equivalente (placement existe solo si language es php).
- Pruebas: las 11 nuevas son reales. Copiando los dos specs de HEAD a un worktree temporal de `ae96def~1` (código anterior) pasan 196/196, o sea caracterizan el comportamiento previo. Mutaciones del pipeline, todas detectadas: `executionProfile` siempre incluido (2 fallos), PHP sin `\n` final (4), `projectRoot` siempre (2), `artifactType` MODIFIED en CREATED (5). La mutación de orden de clave de `FrameworkOptions` y `{}` en opciones del contexto (M1) también falló 2 tests. Worktree eliminado; árbol limpio.

## Corte C
- Diff de `sandbox-execution.service.ts`: solo se añaden parámetros (`operation`, `executionId`), contadores y el `warn`. Número de reintentos (`attempt >= retries`), condición retryable, espera `min(base·2^attempt, MAX)` y el POST (no pasa por `withTransientRetries`) intactos. La espera se calcula en una variable pero con la misma fórmula.
- Conteo: se incrementa solo tras decidir reintentar (después de los `throw`), así que no cuenta el intento inicial ni el fallo final; prueba de agotamiento (1 POST + 3 GET, contador 2) y de `RETRIES=0`.
- El warn lleva operación, executionId, N de TOTAL, clase del error, espera y `sanitizeFailureMessage(error.message)`; los mensajes de `SandboxUnavailableError` contienen estado HTTP y URL o el mensaje del fetch, nunca el token (va en cabecera). Prueba verifica ausencia de token/Bearer/authorization. Getters de solo lectura (el desglose devuelve copia, probado).
- Nota (informativa): ya existe un warn previo en `request()` por fallos de red, por lo que un reintento por red produce dos líneas; no es un defecto.

## WI completo
- Sin cambios en DTO, `spec/`, migraciones/prisma, prompts, ranking, pesos ni R-PHP (`git diff 71cb9b4 HEAD --name-only`: solo handlers, pipeline, servicio Sandbox, 4 specs y harness). `contractImpact=false`/`publishesContract=false` coherente.
- `state.json`: `activeWorkItem` WI-CORE-070 en W-IN_PROGRESS; gates `implementationCompleted`, `independentReviewPassed`, `technicalChecksPassed`, `retryLimitRespected`, `interopSyncChecked` en G-NOT_RUN y `reviewAgent` null: están pendientes de registrar por el leader (no son hallazgo). `specPaths`/`evidence` aún no incluyen los informes corte-b, corte-c ni esta revisión; ni `sandbox-execution.service.ts` (ver hallazgo 1).

## Evidencia (desde `app/`, Node 22.23.3)
- `pnpm lint` 0; `pnpm build` 0; `pnpm contracts:check` 0.
- `pnpm test`: 2514 tests esperados (2496 + 11 + 7). En 3 ejecuciones aparecieron 1 a 3 timeouts de 5 s en `sanitize-failure-message.util.spec.ts` y `test-target-extractor.service.spec.ts` (archivos no tocados por el WI) con carga de máquina `load average` ~190; ambos specs pasan aislados (109/109). Es flakiness ambiental. Se recomienda re-ejecutar `pnpm test` completo con la máquina descargada al registrar `technicalChecksPassed`.
- 4 validadores (`scripts/sdd-check.mjs`, `harness/validate-work-items.mjs`, `validate-harness.mjs`, `validate-completions.mjs`): exit 0.

## Hallazgos
1. Bajo, `harness/state.json` / `harness/work-items.json` (specPaths y `filesAffected` del WI): faltan `app/src/sandbox/sandbox-execution.service.ts`, `app/src/generation/test-generation-pipeline.ts` y los informes de B, C y esta revisión; registrarlos al cerrar.
2. Informativo: `handle` (~171 líneas) sigue justificado como en la revisión del corte A.

Blockers: ninguno. Decisiones abiertas: ninguna (A, B y C aprobados por el usuario; F3 fuera).
