# WI-CORE-109 — revisión de contrato
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo low

## Veredicto
**CHANGES_REQUESTED** (un cambio de documentación obligatorio, bajo; el contrato 2.25 coincide con el código y es aditivo).

## Hallazgos
1. **(Media-baja, corregir) `spec/README.md:5` sigue en INTEROP-2.24.** Dice «Core mantiene … INTEROP-2.24» y lista `WI-CORE-103/104/106`; hay que pasarlo a 2.25, añadir `WI-CORE-109` (aditivo) y decir que los espejos de Console (2.23), Integration y Sandbox (2.21) quedan hasta su re-espejo de INTEROP-2.25. `system-contract.md` no menciona versiones INTEROP afectadas (SYSTEM-2.16 sin cambio; «Compatible con SYSTEM-2.16» sigue correcto).
2. **(Baja) Redacción de la matriz §6.13, fila Reader:** quedó `(§6.6).; \`GET /projects/{projectId}/experiment-captures\` (INTEROP-2.25)` (punto y punto y coma). La prueba de matriz pasa; arreglar a `(§6.6); \`GET …\` (INTEROP-2.25).`
3. **(Baja, ambigüedad) §6.17 «Run reservado» dice que no publica Check, pero no aclara que `POST /analysis-runs/{id}/test-publications` (PR acompañante, acción manual de un Writer) sigue disponible.** Lo confirmé en código: ese camino no pasa por `publishForRun`. Añadir una frase: «La publicación manual de pruebas (§6.12) no cambia».
4. **(Baja, ambigüedad) Timing del realtime.** La reserva ocurre dentro de `startRunFromWebhook` y no emite `analysis-run:update`; el campo aparece en el primer evento posterior (p. ej. `QUEUED→PROCESSING`) y en cualquier GET. Aceptable; opcionalmente decirlo en «Compatibilidad».
5. **(Baja, observación)** El alcance prometía «fila en la tabla de errores»; los dos códigos solo están inline en §6.17 (igual que `RETRIEVAL_COMPARISON_NOT_FINISHED`, línea 1157; la tabla de la línea ~1078 es solo de §6.13). Consistente con la convención; no bloquea. Core no emite `retryable` en errores de aplicación (§4.1), así que no hay nada que añadir.
6. **(Baja) Arme sin binding.** `arm` no valida que el Project tenga repositorio vinculado ni borrado lógico; la captura queda `ARMED` sin consumirse. El contrato no lo dice; sugerir una frase de «sin expiración» (ya está) y no más.

## (1) Contrato frente a implementación — coincide
- Rutas/roles/estados: `experiment-captures.controller.ts:17-36` (POST 201 MAINTAINER, GET READER, DELETE `current` MAINTAINER, 200 por defecto) = contrato §6.17 y matriz (`interop-role-matrix.ts:76,95-96`; `access-matrix.e2e-spec.ts:144-148`). Pruebas de matriz, servicio, checks y flujo CT: 55 pasan, 11 `pg` omitidas (sin BD) — las `pg` quedan para el reviewer.
- `ExperimentCaptureResponse`: `dto/experiment-capture.response.ts:4-14,22-34` (9 campos; nulos: `reservedAnalysisRunId`, `reservedAt`, `disarmedBy`, `disarmedAt`; `status` = enum Prisma `ARMED|RESERVED|DISARMED`) = contrato §6.17 campo por campo.
- Paginación: `{items, nextCursor}`, más reciente primero, cursor por `id`, default 20 (`experiment-captures.service.ts:34-44`; `repository.ts:46-53`); el contrato remite a las convenciones de §2.
- Errores: `EXPERIMENT_CAPTURE_ALREADY_ARMED` 409 (`service.ts:25-29`, vía P2002 del índice único parcial `migration.sql`) y `EXPERIMENT_CAPTURE_NOT_ARMED` 404 (`service.ts:58-62`), ambos en `error-code.enum.ts`; los lanza `AppException`, que el filtro conserva (§4.1 precedencia).
- `experimentCapture` en Run: `analysis-run.response.ts` (`toExperimentCaptureReservationResponse`: `null` salvo `{captureId, reservedAt}`; siempre presente). Los tres consumidores del DTO (lista por Project, lista visible, detalle: `analysis-runs.controller.ts:41,56,69`) y el realtime (`analysis-run-realtime.events.ts:35-39`, usa `findById` con `RUN_EXPERIMENT_CAPTURE_INCLUDE`) cargan la relación (`repository.ts:87,102,175,197`); no hay otro emisor de ese DTO. El esquema `realtime-events.schema.json:84-110` no declara el campo, no lo exige y no cierra propiedades.
- Reserva: `startRunFromWebhook` (`analysis-runs.service.ts:111-122`) solo con `isNew && repositoryBindingEligible===true && !draft`, antes de devolver; los dos llamadores (`github-webhooks.service.ts:287-290`, `pull-request-metadata-backfill.job.handler.ts:172-210`) encolan el snapshot después. Transacción `UPDATE … WHERE status='ARMED' RETURNING` + `analysisRun.update` (`repository.ts:90-114`): un solo ganador; error ⇒ Run normal y captura `ARMED` (`service.ts:126-136`). Duplicado/HEAD sin cambios (`startRunInternal` devuelve `isNew:false`), PR anterior al vínculo (sin Run) y no elegible no consumen; un HEAD nuevo crea otro Run no reservado y obsoleta al reservado: igual que §6.17. Los borradores en la práctica nunca crean Run (`github-webhooks.service.ts:182-203`, backfill descarta `draft`); la cláusula es defensiva y coincide con el contrato.
- Sin Check: `publishForRun` (`analysis-run-checks.service.ts:27-31`) retorna antes de llamar a GitHub Integration y vuelve a comprobar con el Run leído de la BD (`:52-56`). Es el único sitio que usa `GithubChecksService.createCheckRun` (`:64`); los 12 llamadores (snapshot, continuación FK, validación) pasan por él. `checkId`/`checkPublishedAt` quedan nulos. No hay solicitud de Check ni de PR acompañante automática para un Run reservado.

## (2) Aditivo y no incompatible — confirmado
Ninguna ruta, campo, enum ni código existente cambia; `AnalysisRunStatus` intacto; un Run no reservado: `experimentCapture: null` y `publishForRun` idéntico; migración solo añade enum, tabla, columna nullable e índices (sin backfill). `corepack pnpm@12.14.0 contracts:check`: limpio. Árbol `schemas/` sin cambio.

## (3) Consistencia documental
Cabecera 2.25/fecha 2026-10-30, §1, §8, matriz y §6.17 coherentes entre sí. Falta solo el hallazgo 1 (`spec/README.md`). CHANGELOG, spec 008 y `harness/` ya mencionan 2.25.

## (4) Consumidores
| Consumidor | Espejo actual | Un Core 2.25 lo rompe | Acción |
|---|---|---|---|
| Console | INTEROP-2.23 | No (campo nuevo siempre presente en Runs; rutas nuevas sin UI) | Re-espejo directo a 2.25; tipar `experimentCapture` como opcional/nulo y tolerar `ExperimentCaptureResponse`; UI en WI aparte. Pendiente de CS-20261026-001 se subsume |
| GitHub Integration | 2.21 (2.24 pendiente) | No: Core simplemente no pide el Check | Re-espejo documental; lint/build/test; sin cambio de código |
| Sandbox | 2.21 | No | Re-espejo documental; sin cambio de código |
Evento de Contract Sync: sí (contrato canónico cambia; aditivo). Subsume `CS-CORE-20261026-001`.

## (5) Riesgos
- Consumidor estricto: Console TypeScript tolera campos extra; los esquemas JSON de `schemas/` admiten propiedades aditivas en responses. Riesgo bajo.
- Pilotos/tag: sin captura armada solo hay un `UPDATE` sin filas por Run nuevo; `arch-v1.0` no cambia salvo que se redespliegue Core (el campo cambia el JSON de Runs). Informar al usuario: no entra en la línea base ya tagueada.
- Una captura armada y olvidada suprime el Check del siguiente PR elegible de ese Project (por diseño D1; sin expiración): conviene que Console la muestre cuando se haga su UI.

## Borrador de Contract Sync (`harness/contract-sync/outbox/CS-CORE-20261030-001.yaml`; no creado, lo crea el leader tras corregir y con el digest final)
```yaml
type: CONTRACT_SYNC
id: CS-CORE-20261030-001
source: core
sourceWorkItem: WI-CORE-109
targets: [console, github-integration, sandbox]
scopePaths: [spec/contracts/interoperability-contract.md]
breaking: false
changed:
  - INTEROP-2.25 interoperability-contract.md sha256 <RECALCULAR AL FINAL; hoy 684c40fe5e3471f7418e88005ae2e1251249f44808535e9748df9739f91da65f>; SYSTEM-2.16 system-contract.md (sin cambio) sha256 d0a492b4484c8883d65e709f76d8c7ff2462b0eb8c832649cf75723b9543ea77; github-integration-contract.md (GH-INTEROP-1.9, sin cambio) sha256 dedf00fa2f0f5be928cfaf1e5a12ff19f96e7579524a0a689757f1077bfc6e4e; arbol spec/contracts/schemas/ con examples/ (sin cambio) sha256 8079ab73887e3a74b2dba57fa5ae5c146e47eb21231f9965718a85a3a2619718 (receta: cd spec/contracts/schemas && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256). WI-CORE-109 (HU18), alcance aprobado por el usuario el 2026-10-30, aditivo y no incompatible: nueva 6.17 con POST/GET/DELETE de /projects/{projectId}/experiment-captures (Maintainer para armar/desarmar, Reader para listar), ExperimentCaptureResponse, errores EXPERIMENT_CAPTURE_ALREADY_ARMED (409) y EXPERIMENT_CAPTURE_NOT_ARMED (404); AnalysisRunSummaryResponse (y por herencia el detalle y analysis-run:update) agrega experimentCapture {captureId, reservedAt} | null siempre presente; un Run reservado no publica Check en el PR. Sin cambio de AnalysisRunStatus, de otras rutas ni de schemas/. Este evento SUBSUME a CS-CORE-20261026-001 (INTEROP-2.24, documental): el re-espejo debe ir directo a 2.25; Console espeja hoy 2.23 e Integration y Sandbox 2.21.
requiredAction:
  - Console: re-espejar interoperability-contract.md byte a byte (digest arriba) en UN paso directo a INTEROP-2.25; tipar experimentCapture en AnalysisRunSummaryResponse como { captureId: string; reservedAt: string } | null (tolerar ausencia en mocks y trazas anteriores) y los tipos de ExperimentCaptureResponse; sin UI en este corte (WI de Console aparte); incluir lo pendiente de CS-CORE-20261026-001 (BELOW_RELEVANCE_THRESHOLD, dependencyContext hasta 500). Sin cambio de schemas ni generated/ (contracts:check limpio). lint, build y test.
  - GitHub Integration y Sandbox: re-espejar byte a byte en UN paso directo a 2.25; sin cambio de codigo (Core no solicita el Check de un Run reservado; no hay contrato nuevo con ellos); lint, build y test. Cada consumidor registra su evidencia; Core no resuelve eventos ajenos.
sourceRevision: <commit de WI-CORE-109>
status: C-PENDING
```
Orden de despliegue: Core primero (migración antes que el código); Console después, sin dependencia de forma. Recalcular el digest del contrato si cambia al corregir los hallazgos 1-3.

## Re-revisión del delta
**Veredicto: APPROVED.**
- Hallazgo 1: `spec/README.md:5` dice INTEROP-2.25, `WI-CORE-109` y el re-espejo de Console a 2.25. OK.
- Hallazgo 2: fila Reader de §6.13 con `(§6.6);`. OK.
- Hallazgos 3, 4 y 6: §6.17 «Compatibilidad» aclara que `POST …/test-publications` (companion PR manual, Writer) sigue disponible, que la reserva no emite `analysis-run:update` por sí sola y que armar no exige binding. Coinciden con el código revisado; el delta es solo prosa, sin rutas, campos ni códigos nuevos. Hallazgo 5 se acepta tal cual.
- `vitest run -c vitest.config.e2e.ts test/access-matrix`: 133/133 pasan (los stack traces del log son errores esperados de casos negativos). `contracts:check`: limpio. `schemas/` sin cambio.
- Digests actuales: `interoperability-contract.md` INTEROP-2.25 = `b2f3845296451bd3e593c00cb1e5955029f3d77ef4d69d1fd9326d07f1fdb651` (sustituye al `684c40fe…` del borrador); system `d0a492b4…`, github-integration `dedf00fa…` y `schemas/` `8079ab73…` sin cambio. El borrador del evento sigue igual con ese digest; recalcular si el contrato vuelve a cambiar.
