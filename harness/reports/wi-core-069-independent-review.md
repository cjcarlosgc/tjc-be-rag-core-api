Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-069 — revisión independiente (ciclo 1 de 2)

Rango: `62938f3..HEAD` (`app`, `spec`, `.github`), limitado al corte 3955398, 3e66b2a y 6714019. 5fa5666 y 9945342 quedan fuera. Las decisiones del usuario (phase opcional, CORS opt-in, timeout de 8 s, historial git, sin push) no se reabren.

## Veredicto: APPROVED (con observaciones no bloqueantes)

No hay decisión de alcance o contrato abierta, ni regresión, ni pérdida de lógica. Los hallazgos son de robustez y de evidencia; ninguno exige otro ciclo. Se recomienda atender F1 y F2 antes del cierre o registrarlos como seguimiento.

## Comandos ejecutados (Node 22.23.3) y resultado

| Comando | Resultado |
|---|---|
| `cd app && pnpm lint` | exit 0 |
| `cd app && pnpm build` | exit 0 |
| `cd app && pnpm contracts:check` | exit 0 |
| `cd app && pnpm test` | 155 archivos pasan, 7 omitidos; 2481 tests pasan, 104 omitidos (las `*.pg.spec.ts`); exit 0 |
| `node scripts/sdd-check.mjs` | SDD check OK |
| `node harness/validate-work-items.mjs` | passed (CORE, 69 WI) |
| `node harness/validate-harness.mjs` | Harness V3 validation passed |
| `node harness/validate-completions.mjs` | passed (66 completed WI) |

Los resultados coinciden con `wi-core-069-technical-checks.md`. El árbol quedó sin cambios tras mis ejecuciones (solo el `wi-core-069-contract-review.md` sin seguimiento de git, del otro revisor).

## Punto 1. Refactor mecánico de `experiment-job.handler.ts`

Comparé `git show 62938f3:.../experiment-job.handler.ts` (1843 líneas) con handler + `experiment-attempt-presenters.ts` + `experiment-job.helpers.ts` (1244 + 303 + 255) mediante diferencia de multiconjunto de líneas normalizadas (sin indentación ni `export`). Resultado:

- Líneas solo en el original: importaciones multilínea reorganizadas, `private ` en las firmas, `this.` en las llamadas y firmas de `buildAgentInstructions`, `buildPhpAgentInstructions`, `describeAgentResult`, `isSafeRelativePath`, `makeRagDetail`, `makeSourceExcerpt` y `safeAgentStep`. Todas tienen su par en el código nuevo como `function` sin `this.`.
- Líneas solo en el nuevo: las mismas funciones sin `this.`, las importaciones nuevas y los comentarios de cabecera.
- No aparece ningún cuerpo de lógica sin su equivalente ni líneas de lógica duplicadas. Si una función movida usara estado de instancia, `nest build` fallaría; compiló.

Conclusión: movimiento sin cambio de lógica, pérdida ni duplicación. Las 2481 pruebas pasan. No hay prueba de equivalencia propia; basta la comparación textual.

## Punto 2. `JobsService.tick()`, shutdown hooks y red de seguridad

- `tick()` envuelve `runOnce()` y registra el error; `setInterval` llama a `tick()`. La protección `polling` de `runOnce` (jobs.service.ts:110-151) evita solapamientos. Cubierto por dos pruebas. Correcto.
- `unhandledRejection`: solo registra y mantiene vivo el proceso. Es una decisión explícita y documentada. Riesgo: oculta fallos si nadie lee el log (F4).
- `uncaughtException` (process-safety.ts, main.ts): registra, `shuttingDown` evita bucles de re-entrada y llama a `shutdown(1)`, que hace `app.close()` y `process.exit(1)`. No hay bucle. Pero un manejador de `uncaughtException` anula la salida por defecto de Node, y si `app.close()` no termina (conexión colgada, `onModuleDestroy` sin fin), el proceso queda vivo en estado incierto sin salida forzada (F1).
- `enableShutdownHooks()` es correcto, lo registra `main.ts` antes de `listen`.

## Punto 3. Reintentos GET al Sandbox y tope de `pollAfterMs`

- `withTransientRetries` solo envuelve el GET de estado y el de resultado (sandbox-execution.service.ts). El POST no se envuelve; hay prueba que lo comprueba.
- Transitorio: 408/425/429/5xx y errores de red, de `AbortError` y de análisis de JSON. Un 404 y otros 4xx no se reintentan. Correcto para consultas idempotentes.
- Espera `base * 2^n` acotada a 30 s, con `SANDBOX_POLL_RETRIES=3` y 500 ms por defecto: 0,5+1+2 s por consulta. Los `setTimeout` se resuelven siempre y el timer de cada petición se limpia en `finally`; no hay fuga. `clampPollAfterMs` rechaza negativos, `NaN`, `Infinity` y no numéricos, y se aplica al primer valor y a los posteriores. Probado.
- F3: `sandboxHttpBoundMs` (attempt-recovery.ts:99-101) calcula `requestTimeoutMs * (maxPollAttempts + 2)` sin considerar los reintentos. El peor caso real crece hasta `(retries+1)` veces por GET, más las esperas. El umbral de latido obsoleto se deriva de esa cota; hoy el latido periódico lo mitiga.

## Punto 4. CORS opt-in y `realtime.gateway.ts`

`createConsoleCorsOrigin` lee la variable en cada petición, permite todo si está vacía (con un aviso), y si está definida permite el origen exacto o la ausencia de `Origin`. El gateway usa el mismo delegado, lo que cumple el criterio «mismo origen que HTTP». Hay `cors.spec.ts`. Sin problemas de seguridad con el comportamiento aprobado. Observación menor F5: se crean dos delegados (HTTP y WebSocket), cada uno con su bandera `warned`, así que el aviso sale dos veces.

## Punto 5. `.github/workflows/ci.yml`

Sintaxis YAML y pasos correctos: `corepack enable` antes de `setup-node` con cache de pnpm, `pnpm install --frozen-lockfile`, `contracts:check`, `lint`, `lint:types` (existe en `package.json`), `build` y `test`. `permissions: contents read`, `concurrency` bien formada, sin secretos: solo credenciales descartables de Postgres local de CI y `DATABASE_URL` ficticia para `prisma generate`. El trabajo `postgres` es informativo (`continue-on-error`). La CI no se ha ejecutado en GitHub (declarado). Acciones fijadas por tag (`@v4`), no por SHA (F6, informativo).

## Punto 6. Gates y evidencias de `harness/state.json`

- Reproducibles: `technicalChecksPassed` e `implementationCompleted` coinciden con mis ejecuciones. `canonicalContractSynced` y `contractSyncPublished`: los tres eventos `CS-CORE-20261018-001..003` existen en `harness/contract-sync/outbox/`; los sha256 de los tres contratos coinciden con los del evento (`b70f9358…`, `b9ed40dc…`, `6c553ee8…`) y `spec/contracts` no cambió desde `sourceRevision` 67519a2. `sddVerified` y `noBlockingDecisions` respaldados por el informe SDD.
- `independentReviewPassed` y `contractReviewed` en `G-NOT_RUN`, y `reviewCycles: 0`: consistente antes de esta revisión. El leader debe actualizarlos.
- F2: `retryLimitRespected` cita `technical-checks.md`, que no habla de ciclos de revisión; la evidencia más adecuada será este informe y el del contract-reviewer. `technical-checks.md` tampoco registra el hash exacto del árbol evaluado (dice «6714019 más notas»), por lo que la reproducibilidad exacta depende del estado actual del árbol. Tampoco hay salida cruda de los comandos.

## Hallazgos

| ID | Severidad | Ubicación | Descripción | Acción recomendada |
|---|---|---|---|---|
| F1 | Media (no bloqueante) | `app/src/main.ts:19-22`, `app/src/common/process-safety.ts:22-29` | Tras `uncaughtException`, si `app.close()` se cuelga no hay salida forzada; el manejador impide el cierre por defecto de Node. | Añadir un temporizador `unref()` (p. ej. 10 s) que llame a `process.exit(1)`; no reabre decisiones. |
| F2 | Baja | `harness/state.json` (WI-CORE-069 `gateEvidence.retryLimitRespected`), `wi-core-069-technical-checks.md` | Evidencia de `retryLimitRespected` no corresponde a ciclos de revisión; el informe técnico no fija el commit/hash ni la salida. | Apuntar la evidencia a los informes de revisión y fijar el commit en el informe técnico al cerrar. |
| F3 | Baja | `app/src/experiments/attempt-recovery.ts:99-101` | La cota HTTP del Sandbox ignora los nuevos reintentos de GET. | Incluir `SANDBOX_POLL_RETRIES` en la cota o documentar que el latido periódico la cubre. Seguimiento. |
| F4 | Baja | `app/src/common/process-safety.ts:19,31`; `app/src/jobs/jobs.service.ts:97` | Los logs de rechazo no resuelto y de `tick` registran solo `message`, sin stack, lo que reduce la observabilidad. | Registrar también `stack` (segundo argumento de `logger.error`). |
| F5 | Baja | `app/src/common/cors.ts:23-34`, `app/src/realtime/realtime.gateway.ts:48` | El aviso de CORS abierto se emite dos veces (un delegado por consumidor). | Compartir un único delegado o una bandera de módulo. |
| F6 | Informativa | `.github/workflows/ci.yml` | Acciones fijadas a tags mutables; el flujo no se ha ejecutado en GitHub. | Fijar por SHA si la política lo exige; confirmar la primera ejecución verde. |

## Blockers

Ninguno.

## filesAffected (revisados)

`app/src/experiments/experiment-job.handler.ts`, `experiment-attempt-presenters.ts`, `experiment-job.helpers.ts`, `app/src/jobs/jobs.service.ts`, `app/src/main.ts`, `app/src/common/process-safety.ts`, `app/src/common/cors.ts`, `app/src/realtime/realtime.gateway.ts`, `app/src/sandbox/sandbox-execution.service.ts`, `app/src/experiments/attempt-recovery.ts`, `.github/workflows/ci.yml`, `harness/state.json`, `harness/contract-sync/outbox/CS-CORE-20261018-00{1,2,3}.yaml`. Este informe es el único archivo creado.

## recommendedNextStep

El leader integra el informe del contract-reviewer, registra este veredicto (`independentReviewPassed`) y decide si F1 y F2 se corrigen en un segundo ciclo o se difieren como seguimiento. Sin push, PR ni merge sin orden del usuario.
