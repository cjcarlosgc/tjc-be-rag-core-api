# WI-CORE-025 — Informe de implementación
Modelo: implementer / implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low (corte 1, 2) y high (cortes 3, 3b, 3c); leader claude-sonnet-5-5 medium (commits, trailers y un cambio mínimo declarado)

**Fecha:** 2026-10-09 (America/Lima). Sin push. Sin cambios en el repo de Sandbox (Core es solo cliente).

## Commits (locales)
| Corte | Commit | Contenido |
|---|---|---|
| 1 | `256275a` | migración `20261009100000`, `pair-order.ts`, `sandboxExperimentRequestId` con intento, `EXECUTION_PROFILE_BY_RUNNER`, `ErrorCode.REASONING_EFFORT_UNSUPPORTED` |
| 2 | `48b36b0` | seed, budget, executionProfile y runnerHint al crear; 422/503; DTO pareado con `null` en corridas previas; `executionDurationMs` nullable |
| 3 | `05b5e0f` | ejecución por pares, reintento externo único `:2`, `technicallyEvaluable`, skip en redelivery, módulo único de defaults de presupuesto |
| 3b | `29a9e70` | columna interna `sandboxTimedOut` (`20261009110000`), legacy sin reintento, excepción genérica del Sandbox como infraestructura, agregados solo con slots evaluables |
| 3c | `5d4e3ad` | latido `lastHeartbeatAt` (`20261009120000`), recuperación de huérfanos, `allSettled`, guardia contra COMPLETED con RUNNING |
| 4 | `d1d04b7` y cierre | INTEROP-2.7 §6.5.1 implementado, revisión contractual final, Contract Sync `CS-CORE-20261009-008`, plan/ideas/WI-027 |

Cambio mínimo del leader (declarado): 2 líneas de casts en `experiments.service.spec.ts` (solo pruebas) para dejar `tsc` en el baseline de 43.

## Decisiones del usuario aplicadas
- `executionDurationMs: number | null` ratificado (antes `0`).
- `TIMED_OUT` del Sandbox no es fallo externo (desviación aprobada de la regla literal del WI), distinguido por columna y no por texto.
- Excepción genérica del cliente de Sandbox = infraestructura (un reintento).
- Huérfano por latido (opciones A y C): intento 1 vencido => intento 2 `:2`; intento 2 vencido => `FAILED/INFRASTRUCTURE` y `technicallyEvaluable=false`, sin tercer intento; latido vigente no se toca.
- Experimentos sin semilla: sin reintento ni pareado; se omiten slots con fila existente.
- Un slot no evaluable no contribuye a tasas ni promedios.

## Puntos para el veredicto del usuario
- **D1.** En experimentos sin semilla una fila `RUNNING` huérfana ya no permite COMPLETED: el experimento termina `FAILED` (`EXPERIMENT_FAILED`); antes terminaba `COMPLETED` con un slot incompleto.
- **D2.** Un intento 1 `RUNNING` con latido vencido se cierra `FAILED/INFRASTRUCTURE` antes de ejecutar el intento 2.
- **D3.** Tras el primer fallo no arrancan slots nuevos; se esperan los que están en vuelo y se relanza el primer error.
- **Crash del worker.** Un job de experimento cuyo worker muere queda `RUNNING` (`releaseStale` solo libera jobs con `dedupeKey`); el latido solo protege la reentrada cuando `handle()` rechaza. Requiere cambio en la cola (IDEA-008).
- **`validRate` = 0 sin slots evaluables.** Puede leerse como 0 % válido en vez de «sin datos»; cambiarlo a `null` exige tocar el contrato (WI-CORE-027, IDEA-007).
- **Precedencia de `UNSUPPORTED_PROJECT`:** el contrato no la fija; Core lo valida después de Writer, indexación, versión completada y target, y antes de resolver el modelo (anotado en INTEROP y en el plan).
- **`completedRepetitions` intermedio** puede adelantarse ligeramente respecto de slots con reintento.
- **Idempotencia por requestId del Sandbox:** no verificable desde este repositorio.
- **`errorSummary: string | null`** se emite en `ExperimentRepetitionResponse` y §6.5 no lo declara (IDEA-009).

## Deudas de verificación
- **Cuatro migraciones sin validar en Postgres real:** `20261008160000` (023, validada solo parcialmente en PG 14 con shim), `20261009100000`, `20261009110000` y `20261009120000`. Todas son aditivas y nullable (o con default), sin backfill, generadas sin conexión.
- Sin prueba HTTP (controlador/filtro) de los 422/503; solo pruebas de servicio con mocks.
- Intermitencia **no reproducida** en `src/project-versions/inventory/test-target-extractor.service.spec.ts` (1 fallo visto una vez por el implementer; 3+3+3+3 corridas completas y una aislada sin fallo). No se declara preexistente.
- `tsc --noEmit -p tsconfig.json`: 43 errores en specs, igual al baseline (019/020).

## Contrato
`contractImpact=true`, `publishesContract=true`: `CS-CORE-20261009-008` (target Console, `breaking=false`, `sourceRevision` `d1d04b7`) en `harness/contract-sync/outbox/`, estado `C-PENDING`. Revisión previa y final del contract-reviewer: APPROVED (`wi-core-025-contract-review.md`).

## Verificaciones finales
Desde `app/` con DATABASE_URL/DIRECT_URL = postgresql://nouser:nopass@127.0.0.1:1/none: `pnpm lint` exit 0; `pnpm test` 112 archivos pasan, 1 omitido, 1474 tests pasan, 36 omitidos; `pnpm build` exit 0; `pnpm test:e2e` 7 archivos, 222/222; `tsc --noEmit` 43 errores (baseline); `node harness/validate-harness.mjs` pasa.
