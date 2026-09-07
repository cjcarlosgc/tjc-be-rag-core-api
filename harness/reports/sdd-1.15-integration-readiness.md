# Evidencia — SDD 1.15 (CORS, DEC-AUTH-001, DEC-IDEMP-001)

**Sprint:** transversal (preparación de integración cross-repo) · **Estado:** DONE

## Contexto

El usuario preguntó si el backend ya estaba listo para probar contra el Sandbox real y el frontend. Se hizo una auditoría (subagente de solo lectura) que encontró 3 bloqueantes reales: CORS deshabilitado, falta el `Authorization: Bearer` Core↔Sandbox, e `Idempotency-Key` documentado en el contrato pero nunca aplicado en código. El usuario resolvió `DEC-AUTH-001`/`DEC-IDEMP-001` en la SDD (consolidados como `SDD 1.14`, solo especificación) y pidió arreglar el CORS directamente. Esta entrada implementa las tres cosas en `app/`.

## Cambios de código

### CORS
- `src/main.ts`: `app.enableCors()` antes de los pipes/filtros globales.

### DEC-AUTH-001 (Core↔Sandbox)
- `src/config/env.validation.ts`: `SANDBOX_SERVICE_TOKEN` (opcional a nivel de campo, pero validación cruzada en `validateEnv`: `SANDBOX_URL` y `SANDBOX_SERVICE_TOKEN` deben configurarse juntos o ninguno — falla el arranque ante una configuración parcial).
- `src/sandbox/sandbox-execution.service.ts`: header `authorization: Bearer <token>` en las 3 llamadas HTTP (`POST /executions`, `GET /executions/{id}`, `GET /executions/{id}/result`). `SandboxExecutionRequest.requestId` ahora lo provee el caller (antes lo generaba el servicio con `randomUUID()` — ver DEC-IDEMP-001 abajo).

### DEC-IDEMP-001 (idempotencia raíz + identidades hijas Sandbox)
- **`prisma/schema.prisma`**: `IdempotencyRecord` (`scope`, `idempotencyKey`, `requestFingerprint`, `operationId`, `createdAt`; `@@unique([scope, idempotencyKey])`), exactamente el diseño de `spec/transversal/persistence/spec.md`. Migración `20260907010601_idempotency_records`, aplicada contra la Supabase real. (Nota: una primera implementación con un diseño distinto — `IdempotencyKey` con PK simple y `responseBody` serializado — se revirtió dentro de esta misma sesión antes de commitear nada, al notar que ya existía un diseño canónico más preciso en `persistence/spec.md`; la migración final reemplaza limpiamente esa tabla intermedia por la correcta.)
- **`src/common/canonical-json.util.ts`**: `canonicalJsonStringify` — ordena keys recursivamente (arrays conservan orden), sin coercionar `undefined` a `null`.
- **`src/common/idempotency/idempotency.service.ts`**: `IdempotencyService.run({scope, key, fingerprintInput, create, rebuildResponse})`. Valida el header (`400 IDEMPOTENCY_KEY_REQUIRED`/`INVALID_IDEMPOTENCY_KEY`), calcula la huella (`sha256(scope + input canónico)`), busca por `(scope, key)`: si existe y la huella coincide reconstruye la respuesta desde `operationId` (`rebuildResponse`, sin body persistido); si la huella difiere, `409 IDEMPOTENCY_CONFLICT`. Si no existe, abre una transacción, re-verifica (evita duplicar en la ventana de carrera), ejecuta `create(tx)` (crea el recurso + encola el job, ambos dentro de la misma transacción) y persiste el registro. Ante `P2002` (carrera concurrente perdida), relee al ganador y aplica la misma resolución replay/conflicto.
- **`JobsService.enqueue`/`JobsRepository.create`**: aceptan un `Prisma.TransactionClient` opcional para poder encolar el job dentro de la transacción de `IdempotencyService`.
- **`TestGenerationRunsRepository.create`/`ExperimentRunsRepository.create`**: ídem.
- **`TestGenerationService.createRun`/`.retryTarget`, `ExperimentsService.createRun`**: envueltos en `IdempotencyService.run` con los scopes `TEST_RUN_CREATE`/`TARGET_RETRY`/`EXPERIMENT_CREATE`. `operationId` = `run.id`/`retryJobId`/`run.id` respectivamente.
- **Controllers**: `@Headers('idempotency-key')` en `POST /test-runs`, `POST /test-runs/:id/targets/:targetId/retry`, `POST /experiments`.
- **`sandbox-request-id.util.ts`**: `sandboxGenerationRequestId`/`sandboxExperimentRequestId`/`sandboxManualRetryRequestId` — UUID v5 (namespace `6ba7b811-9dad-11d1-80b4-00c04fd430c8`) con los nombres canónicos exactos de `DEC-IDEMP-001`. Verificado contra el vector de prueba estándar RFC 4122 (namespace DNS + `www.example.com` → `2ed6657d-e927-568b-95e1-2665a8aea6a2`).
- **`TestGenerationJobHandler`/`ExperimentJobHandler`/`RetryTargetJobHandler`**: ahora reciben `jobId` (segundo parámetro de `JobHandler.handle`, ya lo pasaba `JobsService.runOnce` pero no se usaba) y lo usan para derivar el `requestId` estable que se envía al Sandbox.
- **Nuevos error codes**: `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_CONFLICT`.

## Verificación

- `pnpm lint` → OK.
- `pnpm tsc --noEmit` → OK (mismos 2 errores preexistentes no relacionados en `zip-validation.service.spec.ts`/`projects.service.spec.ts`).
- `pnpm test` → 228/228. Nuevos: `env.validation.spec.ts` (6 casos, incluye la validación cruzada de DEC-AUTH-001), `uuid-v5.util.spec.ts` (4 casos, incluye el vector RFC 4122), `sandbox-request-id.util.spec.ts` (4 casos), `canonical-json.util.spec.ts` (5 casos), `idempotency.service.spec.ts` (7 casos: key requerida/inválida, creación+persistencia, replay, scoping por `scope`, conflicto, carrera concurrente), más casos de delegación (`scope`/`fingerprintInput`) en `test-generation.service.spec.ts` y `experiments.service.spec.ts`, y aserciones de `Authorization`/`requestId` en `sandbox-execution.service.spec.ts` y en los 3 job handlers.
- `pnpm test:e2e` → 21/21 contra la Supabase real. Nuevos en `test-generation.e2e-spec.ts`: falta de header (400), header malformado (400), replay exitoso con el mismo body (mismo `runId`, sin duplicar en el historial), conflicto con distinto body (409). Todos los POST existentes (`/test-runs`, `/experiments`, retry) se actualizaron para enviar `Idempotency-Key` real.
- `pnpm build` → OK.

## Limitaciones documentadas

- La integración Core↔Sandbox sigue sin verificarse de extremo a extremo contra un Sandbox real desplegado — eso es responsabilidad conjunta de ambos repos, fuera de este workspace. Lo que se cierra acá es la deuda de implementación del lado de Core.
- El registro `IdempotencyRecord` no expira de forma independiente en V1 (vive mientras exista el recurso/resultado correspondiente), tal como especifica `persistence/spec.md`; no se implementó ningún job de limpieza/TTL.
