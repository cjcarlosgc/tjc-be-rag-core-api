# WI-CORE-074 (WI-D) — corte 2: contrato, esquemas, DEC-RT-001, e2e real y emisiones restantes
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high

Informe del implementer (transcrito por el leader). Alcance: `wi-core-074-scope-approval.md`.

## Qué emite ahora cada camino

- `AnalysisRunsService` (`transitionTo`, `completeRunFromSystem`, `recordSnapshot`, `closeRun`, `startRunInternal`): `analysis-run:update` tras la escritura confirmada; la creación del Run no emite.
- `FunctionalContextEvaluatorService.evaluate`: emite tras confirmar PROCESSING → ACTION_REQUIRED; no emite en una continuación que ya está en ACTION_REQUIRED.
- `AnalysisRunsRepository.classifyPullRequest` devuelve `obsoletedRunIds` (Runs que no estaban OBSOLETE y pasan a OBSOLETE); el backfill de PR y los dos puntos del webhook de GitHub emiten solo esos Runs.
- `ExperimentJobHandler`: `experiment:update` en `markStarted`, `complete`, `markFailed` (inmediato) y en los progresos (límite de 1500 ms); la creación no emite.
- Borrado de Project: no emite (sus sockets ya se expulsan). Todas las emisiones son post-commit, best-effort y sin lecturas si no hay suscriptores.

## Contrato (INTEROP-2.18, versión sin cambios; fecha de corte 2026-10-21)

§6.6 reescrito: ancla HU12; handshake con sesión (`AUTH_REQUIRED`, `INVALID_ACCESS_TOKEN`, `GITHUB_IDENTITY_REQUIRED`, `IDENTITY_UNAVAILABLE`), token en `auth.token` o `Authorization: Bearer`, AUTH_BYPASS con cualquier token no vacío; `SubscribeAck` de tres resultados; suscripciones y desuscripciones de `project-version`, `analysis-run` y `experiment` con Reader, expulsión por pérdida de acceso, salas por id sin broadcast; eventos `analysis-run:update` y `experiment:update` con el DTO del GET; garantías (post-commit, best-effort, at-most-once, sin replay; el cliente reconcilia con el GET); throttle de progreso de 1500 ms (los cambios de estado son inmediatos); polling como base; cambio incompatible declarado (handshake sin sesión). §1 y la fila Reader de §6.13 mencionan las suscripciones nuevas; sin citas HU21/HU22 en `spec/`, `app/src` ni `app/test`.

## Esquemas y ejemplos

`spec/contracts/schemas/realtime-events.schema.json` (`SubscribeAnalysisRunPayload`, `SubscribeExperimentPayload`, `SubscribeAck`, `AnalysisRunDetailResponse`, `ExperimentStatusResponse`), cinco ejemplos `realtime-*.json` registrados en `examples/manifest.json`, tipos regenerados; pruebas negativas del validador. `error-envelope` y `sandbox-execution` sin tocar. `SubscribeAck` usa `oneOf`, de modo que `json-schema-to-typescript` genera además un tipo `SubscribeAck1` (cosmético).

## DEC-RT-001

Registrada como APPROVED, `Blocks: NONE`, en `spec/features/013-pr-driven-analysis/spec.md` (la sección «Decisiones» no existía y se creó); la citan §6.6 y el CHANGELOG. Usa el campo «Decisión» en vez de «Propuesta» (única adaptación al formato de DEC-ERR-001).

## Matriz §6.13 y e2e

Se añadieron las dos entradas WS READER a `test/support/interop-role-matrix.ts` y se quitó la exclusión `NEW_SUBSCRIBE_MESSAGES` de `test/access-matrix.e2e-spec.ts`; matriz y e2e coinciden.

## e2e real con socket.io-client

`socket.io-client@^4.8.4` como devDependency (lockfile 4.8.4; el servidor socket.io es 4.8.3 y Console usa ^4.8.3). Nuevo `app/test/realtime.e2e-spec.ts` con 7 pruebas sobre `app.listen(0)`: sin token `AUTH_REQUIRED`; token expirado `INVALID_ACCESS_TOKEN`; token en `auth.token` y en la cabecera; el Reader recibe `analysis-run:update` (igual al GET) y `experiment:update`; el no-Reader y el id inexistente reciben denegación sin ningún aviso; `unsubscribe` corta los avisos. Corrió y pasó. Limitación: la prueba del experimento invoca `ExperimentRunsRepository.markStarted` y `ExperimentRealtimeEvents.statusChanged` en vez del pipeline del job (requiere worker, LLM y Sandbox); para el Run usa servicios reales (`startProcessing`, `closeRun`).

## Evidencia (desde `app/`, Node 22)

| Comando | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm contracts:generate` / `pnpm contracts:check` | exit 0 |
| `pnpm test` | 157 archivos pasan, 7 omitidos; 2620 tests pasan, 104 omitidos (antes 2605) |
| `pnpm test:e2e` | 9 archivos, 259 tests pasan (antes 8 y 252; incluye `realtime.e2e-spec.ts`) |
| `node scripts/sdd-check.mjs` | SDD check OK |

## Hallazgo previo al corte (drift documental, a decidir por el usuario)

- §6.5 documenta `analysisRunId` y `symbol` en `ExperimentStatusResponse`, pero el GET no los emite (el presentador emite `targetId`, `projectVersionId`, etc.).
- §6.10 documenta `history` en `AnalysisRunDetailResponse`, pero el GET no lo emite.
El esquema nuevo refleja lo que el código realmente emite y los avisos heredan esa forma; el contrato en prosa de §6.5 y §6.10 y el código no coinciden y requiere una decisión (corregir la prosa a lo implementado, o implementar los campos).

## Otras notas

`project-version:update` sigue sin productor en producción (reservado en el contrato). El CHANGELOG conserva las menciones históricas de HU21/HU22 (no se reescribe historia).
