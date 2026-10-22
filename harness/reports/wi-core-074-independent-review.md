# WI-CORE-074 (WI-D) — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Rango revisado: `4ee7f02` (corte 1) y `3c92dfb` (corte 2) sobre `feature/jean`. Alcance de referencia: `wi-core-074-scope-approval.md` (D1–D4 y DEC-RT-001 aprobadas). El contrato en prosa lo revisa el contract-reviewer; este informe cubre comportamiento, seguridad y código.

## Veredicto: APPROVED_WITH_FINDINGS (sin bloqueantes; 1 hallazgo medio-bajo de pruebas y 3 observaciones bajas)

## Verificaciones ejecutadas (Node 22, desde `app/`)

| Comando | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm contracts:check` | exit 0 |
| `pnpm test` | 157 archivos pasan, 7 omitidos; 2620 pasan, 104 omitidos |
| `pnpm test:e2e` | 9 archivos, 259 pasan (incluye `realtime.e2e-spec.ts`, 7 pruebas) |
| `pnpm install --frozen-lockfile --offline` | lockfile al día |
| 4 validadores de la raíz (sdd-check, work-items, harness, completions) | todos OK (75 WI; 71 completados) |

## 1. Seguridad del socket

- Handshake (`realtime.gateway.ts` `afterInit`/`authenticateHandshake`): middleware sobre el `Server`; sin token -> `AUTH_REQUIRED`; token que el verificador rechaza -> `INVALID_ACCESS_TOKEN`; usa el mismo `SessionAuthService.authenticate` que el guard HTTP. Bajo `AUTH_BYPASS` exige token no vacío (igual que HTTP) y `authenticate` devuelve la identidad sintética. Sin `socket.data.userId` no hay forma de llegar a un handler. Cubierto por e2e real (sin token, expirado, `auth.token`, cabecera).
- Suscripciones nuevas: `subscribeAnalysisRun`/`subscribeExperiment` pasan por el mismo `subscribeResource` que `project-version`: `requireForResource(..., 'READER')`, track antes de `join`, `join`, `revalidateSocket` después. Un id inexistente y un id sin acceso devuelven el mismo `NOT_VISIBLE` (`requireForResource` mapea `PROJECT_NOT_FOUND` a `resourceNotFound`, ambos 404, ack idéntico). El predicado de visibilidad es el de HTTP.
- Salas: nombres predecibles (`analysis-run:<id>`) pero el cliente no puede unirse por su cuenta (socket.io no permite `join` desde el cliente; solo el servidor une, y solo desde `subscribeResource`). No hay ningún handler que publique desde el cliente ni broadcast global (`publish` usa `server.to(room)`).
- Expulsión: `ProjectSubscriptionsService` guarda salas genéricas (`room -> projectId`); `evict` recorre todas las salas del Project, por lo que cubre las nuevas. Pruebas unitarias existentes pasan.
- Sin hallazgos de seguridad bloqueantes.

## 2. Emisión

- `analysis-run:update` usa `toAnalysisRunDetailResponse(run, symbols)` (misma función que el GET); `experiment:update` usa el presentador extraído `toExperimentStatusResponse`, ahora también usado por `getStatus` (el refactor es literal; diff revisado campo a campo).
- Post-commit: los servicios de dominio no se invocan dentro de `$transaction` (solo los repositorios abren transacciones), y todas las emisiones están después de la escritura. Best-effort: `runChanged`/`emit` capturan todo; sin suscriptores no hay lecturas a BD (`hasSubscribers` primero).
- Puntos revisados: `transitionTo`, `completeRunFromSystem`, `recordSnapshot`, `closeRun`, evaluador funcional (solo en PROCESSING -> ACTION_REQUIRED), backfill y los dos puntos del webhook (solo `obsoletedRunIds`), y en experimentos `markStarted`, `complete`, `markFailed` (catch y worker perdido) y los tres puntos de progreso. No encontré un cambio de estado de Run o experimento con push sin emitir, salvo lo declarado (borrado de Project, que expulsa los sockets) ni emisiones dobles. `markCheckPublished` no cambia el DTO.
- Throttle: ventana de 1500 ms por experimento, trailing con un único timer por experimento (`unref`), `statusChanged` emite sin throttle y cancela el timer. Sin suscriptores no se crea timer.

## 3. Regresiones

- `classifyPullRequest` ahora devuelve `{ classifiedCount, eligible, obsoletedRunIds }`: es una extensión aditiva; los tres llamadores (backfill y dos del webhook) son los únicos y están actualizados. Los pre-existentes que usaban `classifiedCount`/`eligible` no cambian.
- `ProjectSubscriptionsService` conserva `track`/`untrack` como wrappers.
- Aviso CORS a nivel de módulo: la prueba usa `vi.resetModules()` y estado fresco, sin fugas entre pruebas.
- `socket.io-client` solo en `devDependencies` (package.json y lockfile coherentes, lockfile al día; solo añade `engine.io-client`, `xmlhttprequest-ssl` y relacionados como dependencias transitivas de desarrollo).

## 4. Mutaciones (todas restauradas; `git status` limpio salvo el informe del otro reviewer)

| Mutación | Resultado |
|---|---|
| Omitir `requireForResource` para `experiment` | falla (4 tests de gateway y 2 e2e) |
| `publish` con `server.emit` global | falla (2 unit + 1 e2e) |
| `runChanged` relanza el error | falla (2 tests) |
| `transitionTo` sin emitir | falla (1 test) |
| `statusChanged` no cancela el progreso pendiente | falla (1 test) |
| `classifyPullRequest` marca obsoletos de más | falla (1 test) |
| Intervalo de throttle de 1500 a 500 ms | **sobrevive** (ver F1) |

## Hallazgos

- **F1 (medio-bajo, pruebas)** `app/src/experiments/experiment-realtime.events.spec.ts:2,79-132` (y `app/src/experiments/experiment-realtime.events.ts:11`): las pruebas del throttle usan la constante exportada `EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS` en lugar de un literal, de modo que cambiar 1500 a 500 no rompe ninguna prueba. El valor 1500 ms está aprobado en D4 y documentado en §6.6; nada lo fija. Recomendación: añadir un `expect(EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS).toBe(1500)` o usar avances literales de 1499/1500 ms.
- **F2 (bajo)** `app/test/realtime.e2e-spec.ts` (prueba del experimento): el e2e invoca `ExperimentRunsRepository.markStarted` y `ExperimentRealtimeEvents.statusChanged` a mano en vez del pipeline del job; el cableado de `ExperimentJobHandler` a `ExperimentRealtimeEvents` lo cubre solo `experiment-job.handler.spec.ts` (unitario). Limitación ya declarada por el implementer; aceptable.
- **F3 (bajo)** `app/src/experiments/experiment-realtime.events.ts` (`lastProgressAt`): la entrada solo se borra en `statusChanged`; un experimento con suscriptores que termine sin pasar por `statusChanged` (p. ej. RescheduleJobError que nunca vuelve) deja una entrada pequeña en el mapa. Además, un trailing emit con la lectura a BD en vuelo puede entregar un progreso levemente anterior al estado terminal (sin garantía de orden, ya declarado en el contrato). Sin acción necesaria.
- **F4 (bajo, heredado)** `app/src/realtime/realtime.gateway.ts` `unsubscribe:*`: acceden a `body.<id>` sin proteger un cuerpo nulo (mismo patrón preexistente que `unsubscribe:project-version`); un cliente que envíe un cuerpo vacío recibe un error de excepción de WS, sin impacto de seguridad. Además, la diferencia entre un id inexistente (una consulta) y un id sin acceso (consulta más posible verificación viva a GitHub) puede dar una diferencia de latencia y, si GitHub está caído, `GITHUB_VERIFICATION_UNAVAILABLE`; mismo comportamiento que HTTP y `project-version`, ya aprobado en el diseño.

## Bloqueantes

Ninguno. Sin decisiones abiertas ni cambios fuera del alcance aprobado (archivos tocados coherentes con D1–D4 y el alcance de los dos cortes).

## Siguiente paso recomendado

Aceptar el WI. Idealmente el leader pide al implementer cerrar F1 (una línea de prueba que fije el intervalo en 1500 ms) antes del cierre; F2–F4 quedan como observaciones sin acción. Cuando contract-reviewer cierre su revisión del contrato, el WI puede pasar a completado.
