# Evidencia — 005-test-generation + 006-validation-orchestration + 007-artifacts

**Sprint:** Sprint 2 · **Historias:** HU08, HU09, HU10, HU11, HU12, HU13, HU14, HU15, HU16, HU17, HU18 · **Estado:** DONE (código); validación end-to-end contra un Sandbox real queda pendiente (ver limitación abajo)

## Contexto

Con `004-rag-retrieval-context` ya implementado, estas tres features forman un único pipeline funcional: generar una prueba (005), validarla en el Sandbox (006) y persistir/entregar el artefacto resultante (007). Se implementan juntas porque HU08-18 solo son observables end-to-end como una sola cadena — generar sin validar, o validar sin persistir, no es un incremento verificable por sí solo.

## Cambios de código

- **`src/providers/`**: `LLMProvider`/`OpenAiLLMProvider` (mismo patrón lazy-client que `OpenAiEmbeddingProvider`), token `LLM_PROVIDER`. Config `LLM_MODEL` (default `gpt-4o-mini`).
- **`src/generation/`** (nuevo módulo):
  - `GapAnalyzer`: resuelve `GenerationMode` (`TARGET`/`CLASS_ALL`/`CLASS_MISSING`/`PROJECT_MISSING`/`PROJECT_ALL`) a la lista concreta de `TestTarget` a procesar, validando la forma target/modo del contrato (`INVALID_GENERATION_TARGET`).
  - `PromptBuilder`: arma el prompt determinístico a partir de un `GenerationContext` (target + related chunks + framework).
  - `TestFileMergeService`: CREATE usa el contenido generado tal cual; MERGE parsea ambos archivos con ts-morph y agrega al existente los imports nuevos (o los named imports faltantes de un import ya presente) y los statements no-import del contenido generado, sin tocar el resto.
  - `WorkspaceFileTracker`: rastrea el contenido evolutivo de cada archivo de test tocado durante un run — un mismo archivo puede recibir CREATE/MERGE de varios targets; decide CREATED/MODIFIED una sola vez, en el primer toque contra el disco real del workspace extraído.
  - `TestGenerationRunsRepository`, `TestGenerationJobHandler` (job async, mismo patrón que `IndexingJobHandler`: 202 + cola DB-backed), `TestGenerationService` (validaciones síncronas: proyecto existe, no hay indexación activa, versión `COMPLETED`, forma modo/targetId), `TestGenerationController` (`POST /test-runs`, `GET /test-runs/:id`, `GET /test-runs/:id/results`).
- **`src/sandbox/`** (nuevo módulo): `SandboxExecutionService` implementa el contrato `INTEROP-1.1` completo — `EphemeralDownloadRef` (URL firmada vía `ObjectStorageService.presignGet`, SHA-256/tamaño calculados en memoria, nunca persistida), `POST /executions` con `Idempotency-Key` + `x-correlation-id`, polling de `GET /executions/:id` respetando `pollAfterMs`, `GET /executions/:id/result`, timeout por request (`AbortController`) y por máximo de intentos de polling. `SANDBOX_URL` es opcional: sin configurar, cada target falla limpiamente como `FAILED`/`INFRASTRUCTURE` sin abortar el run.
- **`src/artifacts/`** (nuevo módulo): `ArtifactService` (persistencia final + diff + downloads), `ArtifactsRepository`, `computeLineDiff` (LCS línea a línea), `ArtifactsController` (`GET /test-runs/:id/artifacts`, `GET /artifacts/:id/diff`, `GET /artifacts/:id/download`, `GET /test-runs/:id/artifacts/download` como ZIP).
- **Prisma**: nuevos modelos `TestGenerationRun`, `TargetRunResult` (incluye `testFilePath` para correlacionar con artifacts), `Artifact`; enums `GenerationMode`, `TestRunStatus`, `TargetRunStatus`, `FailureType`, `ArtifactType`. Dos migraciones (`20260906060628_generation_pipeline`, `20260906062305_target_run_result_test_file_path`) generadas con `prisma migrate diff --from-config-datasource` contra la Supabase real (sin shadow DB) y aplicadas con `prisma migrate deploy`.
- **Fix de infraestructura no relacionado, encontrado durante la verificación**: `vitest.config.e2e.ts` corría los archivos `*.e2e-spec.ts` en paralelo por defecto; como cada archivo levanta su propia app Nest con `JobsService` pollando la misma tabla `jobs` real (no scoped por proceso de test), el poller de un archivo podía reclamar un job encolado por otro archivo, cuyo `ObjectStorageService` fake (en memoria, por-app) no tenía el objeto — "Objeto no encontrado" intermitente. Se agregó `fileParallelism: false`.

## Diseño de CREATE/MERGE y su interacción con targets del mismo run

Cuando un target no tiene test propio (`hasTest=false`), la ruta convencional es co-localizada `<archivo>.spec.ts`. Si ese archivo **ya existe** (por ejemplo, cubre otro método de la misma clase), el `WorkspaceFileTracker` lo detecta al leer el disco y fuerza MERGE en vez de CREATE — confirmado con un caso real en el e2e (`subtract` sin test propio, pero `calculator.spec.ts` ya existía cubriendo `add`; el resultado es `MODIFIED`, preservando el test de `add`). Dos targets del mismo run que comparten archivo ven siempre el estado ya evolucionado por el anterior (no el original en disco), cumpliendo "múltiples métodos deben fusionarse sobre workspace/artifact evolucionado del run" de la spec de 005.

## Verificación

- `pnpm lint` → OK.
- `pnpm test` → 125/125 (nuevas: `gap-analyzer.service.spec.ts` 9, `prompt-builder.service.spec.ts` 5, `test-file-merge.service.spec.ts` 4, `workspace-file-tracker.spec.ts` 3, `test-generation-job.handler.spec.ts` 8, `openai-llm.provider.spec.ts` 3, `sandbox-execution.service.spec.ts` 4, `artifact.service.spec.ts` 6, `diff.util.spec.ts` 4).
- `pnpm test:e2e` → 9/9 (`test-generation.e2e-spec.ts`, 2 casos nuevos), contra la Supabase real, con `LLM_PROVIDER` y `SandboxExecutionService` reemplazados por fakes (`ObjectStorageService` ya se fakeaba desde antes). El caso principal ejercita la cadena completa: indexar → `POST /test-runs` (`PROJECT_MISSING`) → generación → MERGE real vía ts-morph → validación (fake) → `COMPLETED` → artifact `MODIFIED` con `valid=true` → download individual (contenido correcto) → diff (líneas `ADDED` reales) → download ZIP del run.
- `pnpm build` → OK.
- `npx tsc --noEmit` → sin errores nuevos (los 5 preexistentes en specs ajenos a este cambio siguen igual).

## Limitación real — no resuelta en este corte

**No hay verificación contra un Sandbox real.** `tjc-be-test-execution-sandbox` es otro repositorio, ausente en este workspace. `SandboxExecutionService` implementa el contrato HTTP completo y está probado con `fetch` mockeado (unit) y con un fake inyectado (e2e), pero nunca contra el servicio real corriendo. Cuando ese repositorio esté disponible (Docker Desktop local, según `DEC-INF-001`), la siguiente verificación pendiente es un smoke test end-to-end con el Sandbox real detrás de `SANDBOX_URL`.

`evidenceIds` en `ValidationResponse` queda siempre `[]`: la captura/almacenamiento de `ExecutionEvidenceFact` (stdout/stderr) no se implementó — el Sandbox real los devolvería, pero Core todavía no los persiste como artefactos de evidencia independientes.

`Batch validation` (validar el conjunto final de artefactos del run además de cada target individual) no se implementó; solo se valida por target individual (`scope: TARGET`). Ver `006-validation-orchestration/tasks.md`.
