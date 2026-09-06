# Evidencia — HU21/HU22 (progreso en tiempo real vía WebSockets)

**Sprint:** Sprint 3 · **Historias:** HU21, HU22 · **Estado:** DONE

## Contexto

Segunda pieza de `009-history-realtime-repair`. La spec (`plan.md`) ya anticipaba "agregar gateway/event publisher desacoplado del dominio"; este trabajo lo materializa. Es un complemento del polling HTTP existente (`GET /project-versions/:id`, `GET /test-runs/:id`), nunca un reemplazo — ambos endpoints siguen funcionando igual y sin cambios.

## Cambios de código

- **Contrato**: `INTEROP-1.2 → 1.3` (aditivo). Nueva sección `6.6 Progreso en tiempo real (WebSockets)`: eventos `project-version:update`/`test-run:update`, suscripción explícita por id (`subscribe:project-version`/`subscribe:test-run`, sin broadcast global), payloads iguales a los DTOs HTTP existentes.
- **`src/realtime/`** (nuevo módulo, `@Global()`): `RealtimeGateway` (`@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io`). Salas por id (`project-version:{id}`, `test-run:{id}`); `emitProjectVersionUpdate`/`emitTestRunUpdate` publican solo a la sala correspondiente.
- **Extracción de mappers reutilizables**: `toProjectVersionResponse` (antes método privado de `ProjectVersionsService`) y `toTestRunStatusResponse` (antes mapeo inline en `TestGenerationService.getStatus`) pasan a funciones exportadas en sus respectivos DTO, para que el gateway y los handlers de job compartan exactamente el mismo mapeo que usan los endpoints HTTP.
- **`IndexingJobHandler`**: emite `project-version:update` tras `markStarted` y cada `setStatus` (`ANALYZING`/`CHUNKING`/`EMBEDDING`/`PERSISTING`), tras completar (`completeAndPromote`) y tras fallar (`markFailed`).
- **`TestGenerationJobHandler`**: emite `test-run:update` tras `markStarted`, tras `setStatus(PROCESSING_TARGETS)`, tras procesar cada target, tras `setStatus(FINALIZING)`, tras `complete` y tras `markFailed`.

## Verificación

- `pnpm lint` → OK.
- `pnpm tsc --noEmit` → OK (solo quedan 2 errores preexistentes no relacionados en `zip-validation.service.spec.ts`/`projects.service.spec.ts`, confirmados con `git status` como archivos no tocados por este cambio).
- `pnpm test` → 174/174 (nuevos: `realtime.gateway.spec.ts` — 7 casos de suscripción/emisión por sala; casos actualizados en `indexing-job.handler.spec.ts` y `test-generation-job.handler.spec.ts` para el nuevo parámetro de constructor y una aserción de emisión).
- `pnpm test:e2e` → 12/12 (sin cambios; no se agregó verificación e2e con `socket.io-client` en esta iteración — ver limitación).
- `pnpm build` → OK.

## Limitaciones documentadas

- No se agregó un test e2e con `socket.io-client` real conectándose al gateway; la cobertura de esta iteración es unitaria (`RealtimeGateway` aislado + verificación de que los handlers llaman a `emit*Update` con el payload esperado). Verificar la conexión WebSocket real end-to-end queda pendiente si se requiere mayor confianza antes de integrar el frontend.
- El gateway no autentica ni valida que el cliente tenga permiso sobre el `projectVersionId`/`testRunId` al que se suscribe — mismo nivel de confianza que los endpoints HTTP actuales (sin auth en V1), documentado como alcance consistente con el resto del sistema.

## Nota de sincronización

Esta adición a `interoperability-contract.md` (propietario canónico de este repositorio) debe reflejarse en las copias espejo de Developer Console y Test Execution Sandbox — responsabilidad del usuario, fuera de este workspace.
