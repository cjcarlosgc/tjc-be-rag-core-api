# Evidencia — HU24 (reintento manual de un target fallido)

**Sprint:** Sprint 3 (cierre) · **Historia:** HU24 · **Estado:** DONE

## Contexto

Última pieza de `009-history-realtime-repair`, tras descartar HU23 (autorreparación automática) como decisión definitiva de arquitectura. El backlog original de HU24 decía "reintentar manualmente una generación cuando los intentos automáticos no sean suficientes, para volver a procesar **un objetivo** fallido" — la granularidad siempre fue por *target* (objetivo), no por run completo; sin HU23, la redacción se ajustó a "reintentar manualmente una generación que quedó `INVALID`/`FAILED`... desde cero", pero la implementación sigue operando sobre un target puntual dentro de un run ya terminado, consistente con el texto original.

## Cambios de código

- **Contrato**: `INTEROP-1.3 → 1.4` (aditivo). `POST /test-runs/{runId}/targets/{targetId}/retry` → `202 TargetRetryAcceptedResponse { testRunId, targetId, status: 'PENDING', pollAfterMs }`.
- **`src/generation/retry-target-job.handler.ts`** (nuevo): `RetryTargetJobHandler`, job type `test-run-retry-target`. Reprocesa exactamente un target: extrae el snapshot original de la `ProjectVersion` del run (workspace fresco, no reutiliza el del intento original), corre el mismo pipeline de un-solo-target que `TestGenerationJobHandler.processTarget` (retrieval → `ContextBuilder` → `PromptBuilder` → `LLMProvider` → CREATE/MERGE vía `TestFileMergeService` → `SandboxExecutionService` → `mapSandboxResult`), y termina actualizando en su lugar el `TargetRunResult` y el `Artifact` existentes (nunca los duplica) más los contadores/estado del run. Usa `targetResult.testFilePath` (ya calculado en el intento original) para la ruta relativa, no la recalcula desde `TestTarget.hasTest`/`testFilePaths`.
- **`TestGenerationRunsRepository`**: nuevos métodos `findTargetResult`, `updateTargetResult` (update en vez de insert) y `applyRetryOutcome` (mueve el bucket `invalidTargets`/`failedTargets` → el bucket del nuevo veredicto, recalcula `status` del run con la misma fórmula usada al cerrarlo la primera vez, actualiza `completedAt`).
- **`ArtifactsRepository`**: `findByTestRunAndPath`, `update`.
- **`ArtifactService`**: `persistRetriedArtifact` — escribe el contenido igual que `persistFinalArtifacts`, pero actualiza la fila existente (por `testRunId`+`relativePath`) en vez de insertar una nueva; solo inserta si genuinamente no existía (caso borde).
- **`TestGenerationService.retryTarget`**: valida que el run exista (`404 TEST_RUN_NOT_FOUND`), esté en un estado terminal (`409 TEST_RUN_NOT_FINISHED` si no), que el target tenga un resultado en este run (`404 TARGET_RESULT_NOT_FOUND`) y que ese resultado sea `INVALID`/`FAILED` (`409 TARGET_RETRY_NOT_ALLOWED` en cualquier otro caso, incluyendo un reintento repetido sobre un target ya `VALID`). Encola el job y devuelve la aceptación.
- **`TestGenerationController`**: `POST /test-runs/:id/targets/:targetId/retry`.
- **`RealtimeGateway`**: `RetryTargetJobHandler` reutiliza `emitTestRunUpdate` (mismo evento `test-run:update` de HU22) tras actualizar el resultado, así que un cliente suscrito ve el reintento sin tener que hacer polling.
- **Nuevos error codes**: `TARGET_RESULT_NOT_FOUND`, `TARGET_RETRY_NOT_ALLOWED`.
- **Sin cambios de esquema**: `TargetRunResult` ya tenía todos los campos necesarios; no hizo falta migración.

## Verificación

- `pnpm lint` → OK.
- `pnpm tsc --noEmit` → OK (mismos 2 errores preexistentes no relacionados, confirmados sin tocar esos archivos).
- `pnpm test` → 189/189. Nuevos: `retry-target-job.handler.spec.ts` (7 casos: no-op sin resultado/no reintentable, retry exitoso INVALID→VALID con verificación de `applyRetryOutcome('INVALID','VALID')`, Sandbox no disponible con `applyRetryOutcome(...,'FAILED')`, framework desconocido, retry de un FAILED previo); casos nuevos en `test-generation.service.spec.ts` (los 4 códigos de error + encolado exitoso); casos nuevos en `artifact.service.spec.ts` (`persistRetriedArtifact` actualiza en lugar de duplicar; inserta solo si no existía).
- `pnpm test:e2e` → 14/14 (nuevo: reintento real contra Supabase — primer intento falla por assertion, `POST .../retry` dispara un segundo intento que pasa con el mock por defecto del módulo, confirma que el mismo `Artifact` se actualiza en lugar de duplicarse, y que un segundo reintento sobre un target ya `VALID` devuelve `409 TARGET_RETRY_NOT_ALLOWED`; más un caso 404 sobre un run inexistente).
- `pnpm build` → OK.

## Limitaciones documentadas

- No se agregó un test e2e con cliente `socket.io-client` verificando la emisión de `test-run:update` durante el reintento; la cobertura de esa parte es unitaria (`RetryTargetJobHandler` llama a `emitTestRunUpdate` con el payload esperado, y `RealtimeGateway` ya tiene sus propios tests desde HU21/HU22).
- El reintento no está limitado por ningún `maxAttempts`: un usuario puede reintentar un target fallido tantas veces como quiera mientras siga `INVALID`/`FAILED`. Esto es intencional (HU24 es reintento manual explícito, no una cola con límite) y consistente con la decisión de descartar cualquier mecanismo automático de intentos (HU23).

## Cierre de Sprint 3

Con HU24 completo, Sprint 3 (`009-history-realtime-repair`) queda cerrado: HU20 (historial), HU21/HU22 (WebSockets) y HU24 (reintento manual) implementados; HU23 (autorreparación automática) descartada como decisión definitiva de arquitectura, no como pendiente. Sprint 4 (HU25/HU26, experiencia de producto) queda fuera de alcance de esta sesión.

## Nota de sincronización

Esta adición a `interoperability-contract.md` (propietario canónico de este repositorio) debe reflejarse en las copias espejo de Developer Console y Test Execution Sandbox — responsabilidad del usuario, fuera de este workspace.
