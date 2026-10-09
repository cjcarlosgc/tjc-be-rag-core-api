# WI-CORE-025 — Revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09. Revisión delegada explícitamente por el usuario (Human Reviewer) en chat. El reviewer no implementó nada ni modificó código, spec o harness.
**Rango:** `4891484^..693c0b7` (4891484, 256275a, 48b36b0, 05b5e0f, 29a9e70, 5d4e3ad, d1d04b7, 693c0b7). HEAD actual 34854ab añade solo docs de WI-CORE-030 (fuera de rango).
**HU:** HU17. **WI:** WI-CORE-025 (ST-CORE-032), W-IN_REVIEW.

## Veredicto: APPROVED

Sin blockers ni hallazgos importantes. Hay 4 observaciones menores (no bloquean). Este veredicto no sustituye la aprobación humana de alcance/arquitectura, ya dada en las decisiones 1-9.

## Verificaciones EJECUTADAS (desde `app/`, DATABASE_URL/DIRECT_URL = `postgresql://nouser:nopass@127.0.0.1:1/none`)
| Verificación | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm test` (2 corridas) | ambas 112 archivos pasan / 1 omitido; 1474 pasan / 36 omitidos; sin intermitencia |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | 7 archivos, 222/222 |
| `npx tsc --noEmit -p tsconfig.json` | 43 errores, todos en `*.spec.ts` y `test/support/in-memory-jobs.repository.ts` (baseline); 0 en código de producto |
| `node harness/validate-harness.mjs` | pasa |
| `contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-025` | `relevantPendingSyncIds: []`, `acknowledgedSyncIds: []`, `resolvedSyncIds` = CS-GH-20260925-001..005, CS-GH-20260926-001, CS-GH-20260927-001; `notRelevantSyncIds` = CS-20260920-001, CS-20260921-003; `deferredSyncIds: []`. No se registró nada. |
| Commits | los 8 con `Refs: HU17` y `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` |
| Compilación por commit (worktree desechable, `prisma generate` por commit, ya eliminado) | 256275a, 48b36b0, 05b5e0f, 29a9e70, 5d4e3ad: `tsc -p tsconfig.build.json` 0 errores; `tsconfig.json` 43 (baseline); vitest de experiments/providers/sandbox/context-traces pasa en cada uno (122, 132, 150, 163, 195 tests) |
| Migraciones | `prisma migrate diff --from-schema (schema previo) --to-schema (actual) --script` produce exactamente la unión de las tres migraciones (4 columnas en `experiment_runs`; 5 en `experiment_repetitions`): aditivas, nullable salvo `technicallyEvaluable NOT NULL DEFAULT true`, sin backfill. |
| Migraciones en PostgreSQL real | Sí viable: PG 14.18 local desechable (puerto 55432, en el scratchpad). Se aplicaron las 39 migraciones en orden con un shim solo del historial previo (sin pgvector: `vector(1536)`->text, hnsw->índice dummy). Las tres de 025 aplican sin error y las columnas quedan con los tipos esperados. `migrate diff` DB->schema no muestra ninguna diferencia en `experiment_runs`/`experiment_repetitions` salvo el renombrado de dos índices por truncado de identificador de la migración `20260923120000` (preexistente, ajeno a 025) y el `vector` del shim. PG detenido y datos borrados. |

### Mutaciones (en worktree desechable de 693c0b7; todas fueron detectadas por pruebas)
Se aplicaron 14 mutaciones y cada una hizo fallar al menos una prueba nueva: M1 quitar `running > 0` de `complete()`; M2 TIMED_OUT cuenta como externo; M3 tercer intento (quitar `attempt === 1`); M4 `technicallyEvaluable=false` ya en el intento 1; M5 agregados sin filtrar no evaluables; M6 expiración de latido invertida; M7 `touchRepetitionHeartbeat` sin guardia RUNNING; M8 sin `clearInterval`; M9 `RescheduleJobError` marcando FAILED; M10 cierre de intento 2 vencido sin `technicallyEvaluable=false`; M11 `closeInterruptedRepetition` sin guardia RUNNING; M12 semilla fija; M13 legacy reintenta/no omite; M14 `executionDurationMs ?? 0`. Las pruebas de latido usan `vi.useFakeTimers` con `finally useRealTimers`; los vencimientos usan márgenes de 1 h frente a un umbral ~22 min. Único `setTimeout` real (10 ms) es la prueba de concurrencia preexistente (6ef8f0b), con holgura.

## Verificaciones por RAZONAMIENTO sobre el código (no ejecutadas)
- Guardia de `complete()`: `FOR UPDATE` sobre la fila del run, mismo bloqueo que `refreshCompletedRepetitions`; cuenta RUNNING y slots terminales dentro de la misma transacción. Un COMPLETED con RUNNING o con slots sin terminal es imposible.
- `RescheduleJobError` se propaga antes de `markFailed` y `JobsService` la trata sin consumir intento; el chequeo previo `assertNoInFlightAttempt` ocurre antes de `markStarted` y antes de cerrar nada. `runWithConcurrencyLimit` espera a los slots en vuelo (`allSettled`) antes de relanzar, así que no se reprograma con un slot vivo en el proceso.
- Latido: `setInterval` con `unref` y `clearInterval` en `finally`; el error de escritura se absorbe con warn; `touch` solo actualiza filas RUNNING; el latido inicial lo escribe `beginAttempt` en la misma transacción que crea la fila.
- Máximo un reintento: el intento 2 solo se lanza si `action.attempt === 1`; un intento 2 vencido pasa por `CLOSE_EXPIRED_SECOND` (nunca tercero); `technicallyEvaluable=false` en segundo fallo externo y en intento 2 huérfano. TIMED_OUT se discrimina por `sandboxTimedOut`, no por texto, en ejecución y en redelivery.
- Externos: LLM 5xx/429/`APIConnectionError` (incluye timeout) vía `LLMProviderUnavailableError.externalFailure`, que conserva code/503/details y atraviesa el agente (es `AppException`); excepción genérica del cliente de Sandbox e INFRASTRUCTURE salvo TIMED_OUT. El timeout propio del run (`withTimeout`) no es externo.
- DTO vs contrato: tipos `| null` idénticos a los bloques V27 (`pairPosition: 1|2|null`, `attempt`/`technicallyEvaluable` no nulos, `executionDurationMs: number|null`, `StrategyMetricsResponse.executionDurationMs: number`). `sandboxTimedOut` y `lastHeartbeatAt` no aparecen en ningún DTO (mapeo explícito, sin spread). Semilla creada en el `create` de `IdempotencyService.run` (replay no la regenera). Contract Sync CS-CORE-20261009-008 es fiel al contrato (breaking false, target console, sourceRevision d1d04b7 = último commit de contrato, `C-PENDING`).
- Decisiones PENDING: `decisionGate.blockingDecisionIds = []`; no hay decisión bloqueante. Sin secretos en el diff; `.env.example` solo trae valores de ejemplo no sensibles; los `errorSummary` nuevos son genéricos.

## Hallazgos (todos menores; ninguno bloquea)
1. **menor — contrato vs. comportamiento de `executionDurationMs`.** INTEROP §6.5.1 y el Contract Sync dicen «null cuando el Sandbox no ejecutó». En `app/src/experiments/experiment-job.handler.ts:771` (`catch` de la llamada al Sandbox: `SandboxUnavailableError` o excepción genérica) se persiste `Date.now() - executionStart` (número) aunque el Sandbox no ejecutó. Es el comportamiento previo al WI, no contradice la decisión 1 (nunca 0), pero la redacción del contrato es más amplia que lo implementado. Corregir el texto («null si no se llegó a invocar al Sandbox o en corridas previas») o emitir null en ese camino.
2. **menor — lógica de presupuesto duplicada.** El fallback de `{toolCallCap, contextTokenBudget, maxDurationMs}` está en `experiments.service.ts:385-393` y en `experiment-job.handler.ts:418-428`. Los literales son únicos (`generation-budget.defaults.ts`), pero la resolución está copiada.
3. **menor — endurecimiento.** `ExperimentRunsRepository.updateRepetitionById` (`experiment-runs.repository.ts:265`) no exige `state = RUNNING`, a diferencia de `touchRepetitionHeartbeat` y `closeInterruptedRepetition`. Escenario: un worker vivo que sigue escribiendo sobre un intento ya cerrado por una redelivery. Improbable porque el umbral de vencimiento ≥ timeout de generación + cota HTTP del Sandbox y el latido se mantiene; queda como hardening (relacionado con IDEA-008).
4. **menor — código muerto y estado preexistentes que 025 roza.** (a) `insertRepetition` no tiene llamadores fuera de specs y los campos opcionales `pairId`/`pairPosition`/`attempt` de `ExperimentRepetitionInput` (repository:61-66) no los usa el handler. (b) `complete()` y `markStarted` no limpian `failureCode`/`failureMessage`: un experimento que pasó por `markFailed` y luego se completa en un reintento del job queda `COMPLETED` con `failureCode` poblado en `ExperimentStatusResponse` (preexistente; la guardia nueva de `complete()` lo hace algo más alcanzable). (c) Docblock huérfano de `runWithConcurrencyLimit` sobre `parseEffectiveConfig` (`experiment-job.handler.ts:136-142`, preexistente).

## Conformidad con decisiones aprobadas
1-9: conformes (ver razonamiento y mutaciones). La única matiz es el hallazgo 1, que no las contradice.

## Limitaciones conocidas y aceptadas (correctamente descritas en los informes)
Crash del worker deja el job RUNNING (IDEA-008; ya registrado WI-CORE-030); `validRate=0` sin slots evaluables (IDEA-007, descrito en §6.5.1); `errorSummary` no declarado (IDEA-009); sin prueba HTTP de 422/503; precedencia de UNSUPPORTED_PROJECT anotada; idempotencia por requestId del Sandbox no verificable aquí.

## Siguiente paso recomendado
El usuario puede dar su veredicto humano sobre el diff y la evidencia. Opcional antes del cierre: alinear el texto de `executionDurationMs` (hallazgo 1). Pendiente del leader: registrar `before-done` tras la aprobación humana.
