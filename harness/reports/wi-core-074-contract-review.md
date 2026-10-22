# WI-CORE-074 (WI-D) — revisión contractual
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Alcance: commits `4ee7f02` (corte 1) y `3c92dfb` (corte 2); HEAD revisado `7e3015f21612ef7e87a6a00f881b9f20b6e3257c`. Solo lectura; no se editó nada más.

## Resultado: CHANGES_REQUESTED (documental, sin cambio de comportamiento; 2 medios, 3 bajos)

## (a) §6.6, §6.13 y §1 contra el código
Coinciden con el código:
- Eventos `analysis-run:update` y `experiment:update` y salas `project-version:`, `analysis-run:` y `experiment:` (`app/src/realtime/realtime-publisher.port.ts`).
- Handshake: `AUTH_REQUIRED` sin token, también bajo `AUTH_BYPASS` (`realtime.gateway.ts` `authenticateHandshake`); `INVALID_ACCESS_TOKEN`; `GITHUB_IDENTITY_REQUIRED` y `IDENTITY_UNAVAILABLE` por `AppException`, con `retryable` solo en 503; `err.data = { code, message, retryable }`.
- Token en `auth.token` o `Authorization: Bearer` (prevalece `auth.token`; `common/auth/handshake-token.util.ts`). La query string no se lee.
- `SubscribeAck` de tres resultados (`realtime.gateway.ts`), 404 indistinguible, sin 403, y revalidación posterior al join.
- Throttle de 1500 ms (`experiments/experiment-realtime.events.ts:11`).
- Fila Reader de §6.13 con las tres suscripciones, y la matriz `test/support/interop-role-matrix.ts` alineada.

## (b) Esquema, ejemplos, tipos
- `pnpm contracts:check` exit 0. `vitest src/contracts`: 24/24.
- Los cinco `realtime-*.json` están en `manifest.json` y validan.
- `realtime-events.schema.json` refleja el DTO REAL: `AnalysisRunDetailResponse` coincide campo a campo con `toAnalysisRunDetailResponse` (`analysis-runs/dto/analysis-run.response.ts`) y `ExperimentStatusResponse` con `toExperimentStatusResponse` (`experiments/experiment-status.presenter.ts:12-33`, que usan el GET `experiments.service.ts:224` y el evento `experiment-realtime.events.ts:81`).
- Bajo (F4): no hay ejemplo de `subscribe:project-version`; el tipo cosmético `SubscribeAck1` ya está declarado.

## (c) Drift de §6.5 y §6.10 (verificado)
**§6.5 `ExperimentStatusResponse`.**
- La prosa (`interoperability-contract.md:302-315`) lista `analysisRunId` y `symbol: AnalysisSymbolResponse` y omite `targetId`.
- El código (`experiment-status.presenter.ts:12-33`, `dto/experiment.response.ts:~38-58`) emite `targetId` y no emite `analysisRunId` ni `symbol`.
- Es drift preexistente de la prosa: viene de `5f4e40b`/`438b8e4`, que "define HU17/HU48… pedidos por Console (sin implementar)". La prosa describe el diseño HU17 de la lista `GET /analysis-runs/{id}/experiments` (:277, «adaptación live pendiente», :279), que no tiene ruta en Core (grep sin controlador). El campo `targetId` real nunca se documentó.

**§6.10 `history`.**
- `AnalysisRunDetailResponse` en la prosa (:835) incluye `history`; el presentador no lo emite.
- La nota de :846 ya dice «Definido, pendiente de implementación», pero la interfaz no lo marca como opcional.

**Consumidores (Console, solo lectura).**
- `experiments/liveMapping.ts:17-31` declara `analysisRunId` y `symbol` como requeridos en `ExperimentStatusResponse`, pero en live no los lee. Solo `mockBackend.ts:3704` y `run-comparison/RunComparisonPage.tsx:37` usan `symbol`, sobre el `RunComparisonOperation` del mock. `analysisRunId` va por la URL, no por el DTO.
- Console no consume `targetId` en esa respuesta.
- `history`: `control-plane/types.ts:157` lo declara opcional (`history?`) y `AnalysisRunDetailPage.tsx:391` lo guarda con `run.history &&`; en live no aparece y la página no se rompe.
- No hay cambio observable para ningún consumidor: la forma del evento es la del GET real, así que el esquema nuevo no miente. Quien miente es la prosa.

**Recomendación (sin implementar; documental, no requiere decisión del usuario):**
1. §6.5: corregir el bloque a la forma real (`id, projectId, projectVersionId, targetId, status, completedRepetitions, totalRepetitions, failureCode, failureMessage, startedAt, completedAt` más los campos 2.7 que ya figuran). Mover `analysisRunId` y `symbol` a una nota «Definido por HU17, pendiente de implementar, opcionales cuando se añadan al GET del experimento y a la lista `GET /analysis-runs/{id}/experiments`».
2. §6.10: escribir `history?` con comentario «pendiente de implementación; ausente en el GET actual».
3. Sin cambio de versión: es aclaratorio dentro de INTEROP-2.18, el esquema ya es el real.
4. Implementar los campos (cambio de comportamiento y de DTO) queda como WI aparte, decisión del usuario; no bloquea esto.
5. Ajustar la prosa antes de calcular los digests y de publicar, porque el hash de `interoperability-contract.md` cambia.

## (d) Cambio incompatible
- Está declarado en tres lugares: §1 (bullet INTEROP-2.18), §6.6 (último bullet) y DEC-RT-001. El texto es citable: «el handshake WebSocket sin sesión se rechaza con `AUTH_REQUIRED`», con `AUTH_BYPASS` sin token se rompe y hay que enviar un token no vacío.
- Medio (F2): la oración inicial del bullet §1 sigue diciendo «aditiva y documental, sin cambio de rutas ni de campos existentes» y atribuye todo a WI-CORE-073. Contradice el cambio incompatible y el comportamiento WS nuevo. Cambiar a «WI-CORE-073 y WI-CORE-074; aditiva y documental salvo el handshake WebSocket (incompatible, §6.6)» y no usar «solo documental» en el evento.
- Console (`app/src/api/socket.ts:75-79`) manda `{}` si no hay token. Con sesión real o mock-con-token no se rompe; sin token pasa a `connect_error` `AUTH_REQUIRED` (que `auth/errors.ts:18` y `client.ts:48` ya conocen). El comentario `socket.ts:75` («sin token el handshake se acepta») queda obsoleto; es acción de Console.
- GitHub Integration y Sandbox: ninguno usa Socket.IO (grep sin coincidencias de `socket.io` ni de los eventos en ambos repos; solo el espejo de INTEROP). Sin impacto confirmado.

## (e) DEC-RT-001
`spec/features/013-pr-driven-analysis/spec.md:106-116`. Formato idéntico a DEC-ERR-001 (Estado, Blocks NONE, Alternativas descartadas, Trazabilidad), con «Decisión» en vez de «Propuesta»: adaptación correcta para una decisión APPROVED. El texto reproduce los cuatro puntos y la consecuencia de la adenda aprobada de `wi-core-074-scope-approval.md`; sin divergencias. Cita HU12 y el Anexo E sin forzar fila. Bajo (F3): la sección «Decisiones» es nueva en esta spec; ninguna otra anomalía.

## (f) Evento único de Contract Sync INTEROP-2.18 (WI-C + WI-D)

Digests (HEAD `7e3015f`; recalcular tras la corrección de §6.5/§6.10/§1):
- `interoperability-contract.md` (INTEROP-2.18): `f0ebfce449af654548eaae0f7b26184184a11a95e1153485a818aab9386ecb0f`
- `github-integration-contract.md` (GH-INTEROP-1.8, sin cambio): `6c553ee856d0c53420a75d2bde5a9eb04cce2e029ffae1bf4194dcbc7a25565a`
- `system-contract.md` (SYSTEM-2.13, sin cambio): `b70f9358fabdaa6d8ac61d07e25258ec5256f9dacd31049edb4f08e6879a0444`
- árbol `spec/contracts/schemas/` (incluye `examples/`): `a1ba9a199d0035de85b807fa9ae26b9afb09f8af340a22f1cb34096547dc9091`

Receta del árbol: `cd spec/contracts/schemas && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`.
`sourceRevision` debe ser el SHA completo del commit final tras las correcciones documentales.

Forma: tres eventos (uno por consumidor), `source: core`, `sourceWorkItem: WI-CORE-074`, `status: C-PENDING`, `scopePaths` según el consumidor. Todos nombran INTEROP-2.18 como juego único con WI-CORE-073.

Texto común a `changed`:
> INTEROP-2.18 (sha256 <hash>): publicación única de WI-CORE-073 y WI-CORE-074. (1) WI-C: §4.1 define 12 códigos genéricos de error (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `NOT_ACCEPTABLE`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `UNPROCESSABLE_ENTITY`, `TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`, `HTTP_ERROR`) más `INTERNAL_ERROR` para 5xx sin código, con estado HTTP conservado, mensaje fijo en español y `retryable` solo en los genéricos; el código explícito de la aplicación prevalece; `code` se trata como abierto; esquema `error-envelope` y ejemplo `error-envelope.generic.json`; DEC-ERR-001 PROPOSED, Blocks NONE. Aditivo. (2) WI-D: §6.6 tiempo real de `AnalysisRun` y experimento (`subscribe:`/`unsubscribe:analysis-run` y `experiment`, eventos `analysis-run:update` y `experiment:update` con el DTO del GET, throttle de progreso 1500 ms, post-commit, best-effort, sin replay), fila Reader de §6.13, esquema `realtime-events.schema.json` y cinco ejemplos `realtime-*`, DEC-RT-001 APPROVED. **CAMBIO INCOMPATIBLE (único):** el handshake WebSocket sin sesión se rechaza con `AUTH_REQUIRED` (token inválido: `INVALID_ACCESS_TOKEN`), también bajo `AUTH_BYPASS`; el token va en `auth.token` o `Authorization: Bearer`, nunca en la query. §6.5 y §6.10 se aclaran a la forma real emitida (`targetId`; `analysisRunId`, `symbol` e `history` siguen pendientes).

**Console** (`targets: [console]`, `breaking: true`). Archivos a espejar: `interoperability-contract.md`, `github-integration-contract.md`, `system-contract.md` si el consumidor los espeja (sin cambio) y `spec/contracts/schemas/` completo, byte a byte. requiredAction:
- Enviar siempre un token no vacío en el handshake y no abrir el socket sin sesión (`socket.ts` manda `{}` hoy); manejar `connect_error` con `AUTH_REQUIRED`, `INVALID_ACCESS_TOKEN`, `GITHUB_IDENTITY_REQUIRED` (`retryable:false`) e `IDENTITY_UNAVAILABLE` (`retryable:true`).
- Opcional: `subscribeAnalysisRunUpdates` y `subscribeExperimentUpdates` con el DTO del GET; polling sigue siendo la base.
- Actualizar el comentario obsoleto de `socket.ts:75`.
- Tolerar los códigos genéricos de §4.1 (`code` abierto).
- Alinear `ExperimentStatusResponse` live a la forma real (`targetId`; `analysisRunId` y `symbol` no llegan) y `history?` opcional.
- Cruzar los digests; ejecutar contract tests, lint, build y test.

**GitHub Integration** (`targets: [github-integration]`, `breaking: false` para este consumidor). Espejar `interoperability-contract.md` y `spec/contracts/schemas/` completo; `github-integration-contract.md` y `system-contract.md` sin cambio. requiredAction:
- Re-espejar y validar los digests.
- Conserva su política `INVALID_REQUEST`; no usa WebSocket (sin impacto de INTEROP-2.18 §6.6).
- Tolerar `code` abierto y los códigos genéricos §4.1 en errores recibidos de Core.
- Sin cambio de código esperado.

**Sandbox** (`targets: [sandbox]`, `breaking: false` para este consumidor). Espejar `interoperability-contract.md`, `system-contract.md` (sin cambio) y `spec/contracts/schemas/` completo. requiredAction:
- Re-espejar y validar los digests.
- No usa Socket.IO.
- Sus nombres de códigos genéricos ya coinciden con §4.1.
- `sandbox-execution.schema.json` no cambió.
- Ejecutar `contracts:check`, lint, build y test.
- Sin cambio de código esperado.

Nota: el repositorio Sandbox hoy no espeja `github-integration-contract.md` (solo interop, system y schemas); no lo pida a Sandbox.
Nota: `CS-CORE-20261018-003` también apunta a Sandbox con INTEROP-2.17; el evento nuevo lo supera y el leader debe indicar que se espeja directamente INTEROP-2.18.

## Hallazgos
| ID | Gravedad | Dónde | Hallazgo |
|---|---|---|---|
| F1 | Medio | `interoperability-contract.md:302-315`, `:835` | Prosa de §6.5 (`analysisRunId`, `symbol`; falta `targetId`) y §6.10 (`history` no opcional) no coincide con el GET real; documentar lo real y marcar lo pendiente (ver c) |
| F2 | Medio | `interoperability-contract.md:14` | La oración inicial «aditiva y documental» y la autoría solo de WI-CORE-073 contradicen el cambio incompatible y el WS nuevo; reformular |
| F3 | Bajo | `spec/features/013-pr-driven-analysis/spec.md:106` | Sección «Decisiones» nueva; coherente, sin acción |
| F4 | Bajo | `schemas/examples/manifest.json` | Falta ejemplo de `subscribe:project-version`; `SubscribeAck1` cosmético |
| F5 | Bajo | Console `socket.ts:75` | Comentario obsoleto; acción de Console vía Contract Sync |

## Bloqueos
Ninguno.

## Evidencia
`pnpm contracts:check` OK; `vitest src/contracts` 24/24; digests y hash de árbol calculados arriba; lectura de `realtime.gateway.ts`, `handshake-token.util.ts`, `experiment-status.presenter.ts`, `analysis-run.response.ts`, Console `socket.ts`, `liveMapping.ts`, `AnalysisRunDetailPage.tsx`.

## Siguiente paso recomendado
El leader corrige F1 y F2 en `interoperability-contract.md` (solo prosa), recalcula los digests, commitea y luego publica los tres eventos con el SHA final. Implementar `analysisRunId`, `symbol` e `history` queda para otro WI, decisión del usuario.

## Ciclo 2 de 2 (commit `5c82853`)
Veredicto final: **APPROVED** (un hallazgo bajo preexistente, no bloqueante).

1. F1 y F2 corregidos. §6.5 documenta `targetId` y una nota deja `analysisRunId` y `symbol` como «definidos por HU17, pendientes y opcionales»; §6.10 pasa a `history?` con comentario de pendiente; el bullet de §1 pasa a «aditiva salvo un cambio incompatible» con WI-CORE-073 y WI-CORE-074. Sin contradicción nueva respecto del presentador, del esquema ni de §6.6.
2. Nuevo hallazgo bajo (F6, preexistente): `ExperimentResultsResponse` (§6.5, `interoperability-contract.md:359-362`) sigue listando `analysisRunId` y `symbol`, y el código (`experiments/dto/experiment.response.ts:120-128`) emite `targetId`. No es del tiempo real ni del esquema nuevo. Corregirlo en un WI posterior o con una línea en la nota de §6.5.
3. Digests reales igual a los declarados en los tres eventos: INTEROP `22b880d1d677d7a54fb0f909f05d505e1557b6bbcdcfbb35347e9e3b5947e311`; GH `6c553ee8…565a`; SYSTEM `b70f9358…0444`; árbol de schemas `a1ba9a19…9091`. `sourceRevision` `5c82853c36a419e9839d5474ad9657f714aba4cb` en los tres.
4. Eventos: `targets`, `breaking` (true solo Console) y `changed`/`requiredAction` coinciden con lo recomendado. Console declara el cambio incompatible con claridad. GH y Sandbox no piden espejar archivos que no espejan. Nota baja (F7): `scopePaths` de Sandbox (-003) todavía lista `github-integration-contract.md`, aunque su `requiredAction` dice que no lo espeja; inocuo.
5. `node harness/contract-sync.mjs check --checkpoint before-done --work-item WI-CORE-074` (sin `--record`): `relevantPendingSyncIds: []`, sin bloqueos.
