# WI-CORE-030 — Verificación de suficiencia SDD y análisis de alcance
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Solo lectura sobre `app/`; no se tocó `spec.md`, `state.json` ni `work-items.json`. Se añadió a `spec/transversal/async-jobs/plan.md` la sección «Detalle técnico propuesto (WI-CORE-030)» marcada PROPUESTA.

## Resultado: DECISION_REQUIRED (el alcance por tipo de job no está aprobado)

HU17 está en HU01–HU18; `ST-CORE-037` existe en `spec/transversal/async-jobs/tasks.md`; componente CORE; sin `caseIds`; `dependsOn WI-CORE-025` cerrado; `contractImpact=false` se confirma (ver §5). El propio WI y la solicitud del usuario exigen que el usuario apruebe el alcance por tipo antes de `W-IN_PROGRESS`. Se registran dos decisiones `PROPOSED` con `Blocks: HU17` (`DEC-JOBS-001`, `DEC-JOBS-002`) en el plan transversal; ninguna se da por cerrada.

## 1. Por qué `releaseStale` solo libera jobs con `dedupeKey`

- `app/src/jobs/jobs.repository.ts:161-183`: el SELECT filtra `"dedupeKey" IS NOT NULL`; el docblock lo justifica: «un tipo sin clave puede tardar más que el umbral y reclamarlo lo ejecutaría dos veces». Es decir, el motivo es que **`lockedAt` se escribe una sola vez al reclamar (`claimNext`, líneas 86-107) y nadie lo renueva**: la cola no puede distinguir «worker muerto» de «handler lento». `JOBS_STALE_LOCK_MS` por defecto 600 000 ms (`jobs.repository.ts:16`, `env.validation.ts:57`).
- Los jobs con clave (acceso) son cortos y acotados, y además cuentan con el índice único parcial (`PENDING` + `dedupeKey`) que absorbe el doble encolado (`returnToPending`, líneas 211-249).
- Cada liberación llama a `fail()` (línea 179): consume un intento (`attempts+1`), backoff `min(2^n·1000, 60000)`, y pasa a `FAILED` terminal al llegar a `maxAttempts` (`JOBS_MAX_ATTEMPTS`, 3). Los jobs sin clave caen en la rama `dedupeKey === null` de `returnToPending` (línea 226), ya soportada.
- Lo que pasa hoy con un job sin clave `RUNNING` cuyo worker murió: queda `RUNNING` para siempre (`jobs.repository.pg.spec.ts:210-220` lo fija como comportamiento). Para experimentos el `ExperimentRun` queda en `RUNNING` y nunca llega a `COMPLETED`/`FAILED`; la repetición en vuelo queda `RUNNING` hasta que alguien reentre al handler (que no ocurre).

## 1b. Inventario de tipos de job

| Tipo (`type`) | Encola | `dedupeKey` | Efectos laterales / idempotencia ante redelivery | Qué haría hoy una liberación |
|---|---|---|---|---|
| `access-reverify` | `access-reverify.service.ts:78`, `access-reverify.job-handler.ts:58` (`enqueueDeduped`) | Sí | Lecturas GitHub + borrado/actualización de acceso; idempotente por diseño | Ya se libera |
| `access-reconciliation` | `access-reconciliation.job-handler.ts:143,162` | Sí | Idempotente (reconciliación horaria) | Ya se libera |
| `PULL_REQUEST_METADATA_BACKFILL` | `github-webhooks.service.ts:235,247`; `pull-request-metadata-backfill.job.handler.ts:200` | Sí | Crea `AnalysisRun` vía `startRunFromWebhook` (`isNew` evita duplicados) y encola `snapshot-analysis` | Ya se libera |
| `experiment-run` | `experiments.service.ts:205` (misma tx que recurso + `IdempotencyRecord`) | **No** | Larga duración (hasta 6 slots × generación LLM + Sandbox). Costo LLM por intento; Sandbox idempotente por `requestId` derivado de `jobId`/estrategia/repetición/intento (`experiment-job.handler.ts`, `sandboxExperimentRequestId`). Reentrada diseñada en WI-CORE-025: `resolveSlotAction` omite terminales, cierra latido vencido, reprograma si hay latido vigente, nunca tercer intento (`attempt-recovery.ts:78-96`) | Queda `RUNNING` |
| `snapshot-analysis` | `analysis-runs/pull-request-metadata-backfill.job.handler.ts:183`, `github-webhooks.service.ts:279` | No | Materializa HEAD vía GitHub, reindexa, embeddings (costo), publica Check. **Gate de estado:** `handle` retorna si `AnalysisRun.status !== 'QUEUED'` (`snapshot-analysis-job.handler.ts:~140`) y el run pasa a `PROCESSING` al empezar | Un redelivery vería `PROCESSING` y retornaría sin hacer nada: la liberación completaría el job y el run seguiría atascado |
| `functional-continuation` | `functional-knowledge.service.ts:187` | No | Reevalúa cobertura, publica Check, encola `analysis-run-validation`. Gate: retorna si el run no está `PROCESSING` | Reejecutable, pero publica Check de nuevo (efecto externo repetido) |
| `analysis-run-validation` | `snapshot-analysis-job.handler.ts:287`, `functional-continuation-job.handler.ts:53` | No | **Costo LLM** por símbolo + Sandbox + publica Check. Gate `run.status !== 'PROCESSING'` | Reentrada no diseñada: re-generaría símbolos sin marca de progreso |
| `test-publication` | `test-publications.service.ts:79` | No | **Escritura externa en GitHub** (rama + companion PR). Gate: `publication.status !== 'PENDING'` retorna; el handler pone `PUBLISHING` al iniciar (`test-publication-job.handler.ts:49-55`) | Redelivery vería `PUBLISHING` y retornaría: sin recuperación real |
| `project-version-indexing` | Solo la constante `project-versions/indexing.constants.ts:1`; **no hay encolador ni handler registrado** | — | Legado/retirado (WI-CORE-002). Un job de este tipo falla terminal por «Sin handler» (`jobs.service.ts:109-115`) | N/A |

Conclusión del inventario: solo `experiment-run` tiene una reentrada diseñada para recuperar trabajo parcial. Los demás tipos sin clave tienen un *gate de estado* que haría de una liberación un no-op silencioso (job `COMPLETED`, entidad atascada en `PROCESSING`/`PUBLISHING`); recuperarlos exige recuperación a nivel de entidad (reconciliación de runs/publications), que es otro corte.

Observaciones adicionales del código:
- `ExperimentRepetition` no tiene `updatedAt` (solo `createdAt` y `lastHeartbeatAt`, schema ~731-765): la «actividad» de un experimento solo es observable por el latido de repeticiones RUNNING y por filas terminales sin marca de tiempo de cierre.
- El `ExperimentRun` queda `FAILED` por `markFailed` (`experiment-runs.repository.ts:240-254`) solo cuando `handle()` captura un error. Si la liberación lleva el job a `FAILED` terminal (intentos agotados) **sin ejecutar `handle()`**, el run quedaría `RUNNING` para siempre: hace falta un gancho de cierre.

## 2. Opciones de diseño

Riesgo central que condiciona todas: un job de experimento legítimo dura más que `JOBS_STALE_LOCK_MS` (10 min; 3 pares con concurrencia limitada, cada slot con generación + Sandbox, hasta 2 intentos), y cada liberación consume un intento. Liberar por antigüedad de `lockedAt` sin evidencia de vida mataría experimentos sanos (al 3.er barrido el job pasaría a `FAILED` con el worker vivo) y rompe `complete()`/doble ejecución.

| Opción | Descripción | Ventajas | Riesgos | JOBS_MAX_ATTEMPTS | Doble ejecución / guarda `complete()` | Migración | Contrato |
|---|---|---|---|---|---|---|---|
| **A** Liberar solo `experiment-run` apoyándose en el latido por repetición (SQL con `EXISTS` sobre `experiment_repetitions.lastHeartbeatAt`) | `releaseStale` incluye `type='experiment-run'` si `lockedAt` vencido **y** ninguna repetición RUNNING del experimento tiene latido vigente | Reutiliza 025, sin cambios en handlers; sin columnas nuevas | Hueco entre slots (ninguna repetición RUNNING mientras el worker vivo pasa de un slot al siguiente) y el chequeo `assertNoInFlightAttempt` solo se hace al entrar (`experiment-job.handler.ts:~320`): un worker B podría arrancar un slot libre en paralelo al worker A vivo. Ruta legacy sin semilla no recupera RUNNING huérfano. Acopla la cola (`jobs`) con tablas de experimentos | Cada liberación consume 1 intento; liberar con latido vigente consume intento y luego `IN_FLIGHT` reprograma (no consume) | Doble ejecución posible en el hueco entre slots; la guarda de `complete()` (RUNNING>0 ⇒ rechaza) se mantiene | No | Ninguno |
| **B** Lease/heartbeat a nivel de job | `JobsService` renueva `lockedAt` cada `JOBS_HEARTBEAT_INTERVAL_MS` mientras `handle()` corre (`UPDATE jobs SET lockedAt=now WHERE id AND status='RUNNING' AND lockedBy=workerId`); el vencimiento pasa a significar «sin renovación», así que ya no importa cuánto dure el handler | Distingue crash de lentitud para cualquier tipo, sin acoplar la cola a tablas de dominio; cierra el hueco entre slots; el umbral deja de depender de la duración | Hace falta intervalo ≤ umbral/3 (validar); un fallo transitorio de la base puede dejar un worker vivo con lock vencido (mitigado por la guarda de latido de repetición y por *fencing*, ver opción E); toca el camino caliente de todos los jobs | Una liberación consume 1 intento (igual que los jobs con clave). Un worker vivo ya no consume intentos | Menos doble ejecución que A; con *fencing* (completar/fallar solo si `lockedBy` sigue siendo este worker) una ejecución zombi no pisa a la nueva. Guarda de `complete()` intacta | No (reutiliza `lockedAt`) | Ninguno |
| **C** Reclamo por tipo con política configurable | Lista de tipos liberables (constante o env `JOBS_RELEASABLE_TYPES`), `dedupeKey` deja de ser el criterio | Hace explícita la decisión por tipo; extensible | Por sí sola no resuelve el problema de la duración (C sin B/A libera por `lockedAt` sin latido); configurable por env = riesgo operativo de activar un tipo no idempotente | Igual | Igual que lo que se combine | No | Ninguno |
| **D** No liberar; marcar `FAILED` por antigüedad | Barrer jobs sin clave RUNNING con `lockedAt` > N horas ⇒ `FAILED` y, para experimentos, `markFailed` del run | Muy simple, cero ejecución duplicada | No recupera el trabajo; el usuario debe relanzar; una cota fija puede matar un experimento largo legítimo; requiere gancho por tipo | No consume reintentos | Nula | No | Ninguno (el run pasa a `FAILED` con `failureCode`, valor ya definido como `string`) |
| **E** (otra) Fencing por `lockedBy` | `complete`/`fail`/`reschedule` condicionados a `lockedBy = workerId` (`updateMany`, `count` 0 ⇒ warn y no escribir) | Evita que un worker zombi pise un job ya reclamado/liberado; complemento natural de B | Cambia firmas de repositorio/servicio y pruebas existentes | Sin cambio | Elimina la escritura zombi sobre el job; no impide el trabajo duplicado del handler (eso lo cubre el latido de repetición + H3) | No | Ninguno |

### Impacto contractual (confirmado)
Ninguno. No cambian DTOs, rutas, enums, errores ni headers; `failureCode`/`failureMessage` ya son `string | null` en `ExperimentStatusResponse` (`interoperability-contract.md:271,1080,1284`). El único comportamiento visible es que un experimento con worker caído pasa a `FAILED` (con un `failureCode` nuevo, valor libre de string) o se reanuda, estados ya existentes. `contractImpact=false` se mantiene; no se emite Contract Sync. Si el equipo decide documentar el nuevo valor de `failureCode` en el contrato, sería un cambio aditivo de texto (no requerido).

## 3. Recomendación: B (+E) acotada por C a `experiment-run`, con A como segunda capa

Recomendado: **B + E + C (lista cerrada) + gancho de cierre**, es decir:
1. Latido de job (B) para **todos** los jobs RUNNING del worker (barato, genérico, y mejora a los jobs con clave); sin cambiar qué se libera de los demás.
2. Criterio de liberación (C): `dedupeKey IS NOT NULL` **o** `type IN ('experiment-run')` (constante en código, no configurable por entorno).
3. Fencing por `lockedBy` (E) en `complete/fail/reschedule` del servicio.
4. Capa 2 (A) ya existe: al reentrar, `resolveSlotAction` y `assertNoInFlightAttempt` impiden duplicar un intento con latido vigente.
5. Gancho de cierre cuando la liberación agota intentos de un `experiment-run`: marcar el `ExperimentRun` `FAILED` (`failureCode` propuesto `EXPERIMENT_WORKER_LOST`) y cerrar la repetición RUNNING huérfana.
6. Endurecimientos H3/H4 de la revisión de 025.

Por qué: A depende del acoplamiento cola↔dominio y deja un hueco entre slots; D no recupera; C sin latido no es seguro. B resuelve la causa raíz (la cola no distingue crash de lentitud) sin migración.

### Decisiones requeridas al usuario (ninguna cerrada)

**DEC-JOBS-001 — Alcance de liberación por tipo** (`PROPOSED`, Blocks: HU17):
| Tipo | Sugerencia | Razón |
|---|---|---|
| `access-reverify`, `access-reconciliation`, `PULL_REQUEST_METADATA_BACKFILL` | Seguir liberando (sin cambio) | Idempotentes, con clave |
| `experiment-run` | **Liberar** | Reentrada diseñada en 025; costo bounded: ≤2 intentos por slot |
| `snapshot-analysis` | **No liberar** (fuera de alcance) | Gate `QUEUED`: la liberación sería no-op y dejaría el `AnalysisRun` en `PROCESSING`; requiere reconciliación a nivel de run (IDEA futura) |
| `functional-continuation`, `analysis-run-validation` | **No liberar** | Gate `PROCESSING`, costo LLM, Check repetido, sin marca de progreso |
| `test-publication` | **No liberar** | Escritura externa en GitHub; gate `PENDING`→`PUBLISHING` |
| `project-version-indexing` | N/A | Sin handler/encolador |

**DEC-JOBS-002 — Mecanismo de vida** (`PROPOSED`, Blocks: HU17): ¿Aprobar el latido a nivel de job (B) con `JOBS_HEARTBEAT_INTERVAL_MS` (default 60 000 ms; debe ser ≤ `JOBS_STALE_LOCK_MS/3`) y el fencing por `lockedBy` (E) dentro de este WI? Alternativa más pequeña: solo A (aceptando el hueco entre slots) o D.

Preguntas concretas adicionales (no bloqueantes si se aceptan las sugerencias): (a) valor de `failureCode` al agotar intentos por worker caído: sugerido `EXPERIMENT_WORKER_LOST`; (b) la liberación de un experimento consume intento (como los jobs con clave): sugerido sí; (c) registrar como IDEA la recuperación a nivel de entidad de `snapshot-analysis`/`analysis-run-validation`/`test-publication`: sugerido sí.

## 4. Detalle técnico propuesto
Ver `spec/transversal/async-jobs/plan.md`, sección «Detalle técnico propuesto (WI-CORE-030)» (PROPUESTA, no aprobada). Resumen: ver ese archivo para firmas, SQL, pruebas y criterios de aceptación.

## 5. decisionGate

`blockingDecisionIds`: `DEC-JOBS-001`, `DEC-JOBS-002` (ambas PROPOSED con `Blocks: HU17`) hasta que el usuario las apruebe o ajuste. Resto: sin decisiones PENDING que alcancen el WI. Recomendación contractual: no activar `contract-reviewer` (sin impacto). Si el usuario aprueba documentar `EXPERIMENT_WORKER_LOST` en el contrato, emitir Contract Sync aditivo.

## Handoff
- status: DECISION_REQUIRED
- findings: ver §1–§3 (hallazgos clave: lock no se renueva; riesgo de matar experimentos sanos; run quedaría RUNNING si la liberación agota intentos; los demás tipos sin clave tienen gate de estado y no son recuperables por liberación; `ExperimentRepetition` sin `updatedAt`)
- blockers: DEC-JOBS-001, DEC-JOBS-002
- filesAffected: `harness/reports/wi-core-030-sdd-verification.md`, `spec/transversal/async-jobs/plan.md`
- recommendedNextStep: el usuario decide DEC-JOBS-001/002; luego pasar el WI a `SPEC_VERIFIED` y delegar la implementación.
