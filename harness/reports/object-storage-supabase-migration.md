# Evidencia — Migración de Object Storage a Supabase Storage

**Sprint:** Sprint 1 (infra transversal) · **Estado:** DONE

## Contexto

La decisión de proveedor de Object Storage (antes MinIO/S3-compatible, ver `harness/reports/HU02-HU05-HU07-project-version-indexing.md`) fue sustituida por el usuario: **Supabase Storage** vía `@supabase/supabase-js`, detrás de una abstracción interna inyectable `ObjectStorageService`, sin filtrar tipos del SDK a la lógica de dominio. PostgreSQL + pgvector (conceptualmente "en Supabase") no cambia: sigue siendo el almacén de datos de dominio, chunks, embeddings y la cola DB-backed de jobs. Specs ya actualizadas (`tech-stack.md`, `architecture.md`, `mission.md`, `object-storage/{spec,plan,tasks}.md`, `persistence/plan.md`, `007-artifacts/plan.md`) antes de este corte de código.

## Cambios de código

- **Eliminado:** `S3ObjectStorageProvider`, `ObjectStorageProvider` (interfaz), `OBJECT_STORAGE_PROVIDER` (token symbol), dependencias `@aws-sdk/client-s3` y `@aws-sdk/s3-request-presigner`, servicio `minio` de `docker-compose.yml` (y su volumen).
- **Nuevo:** `ObjectStorageService` (clase abstracta — sirve como su propio token de inyección en Nest, sin necesitar `@Inject(symbol)`) con `put/get/delete/presignGet`.
- **Nuevo:** `SupabaseObjectStorageAdapter` implementa `ObjectStorageService` con `@supabase/supabase-js` (`.storage.from(bucket).upload/download/remove/createSignedUrl`). El bucket se verifica/crea de forma **perezosa** (en el primer uso real, memoizado), no en `onModuleInit`: así la app arranca aunque Supabase no sea alcanzable todavía, igual que ya ocurría con `OpenAiEmbeddingProvider` y `OPENAI_API_KEY`. Si Supabase no responde, el primer `put/get/delete/presignGet` falla con un error claro (capturado por `AllExceptionsFilter`: 500 `INTERNAL_ERROR`, sin stack trace al cliente, logueado server-side).
- Todos los consumidores (`ProjectVersionsService`, `IndexingJobHandler`) ahora inyectan `ObjectStorageService` directamente (sin `@Inject` ni symbol).
- `env.validation.ts`: se retiran `OBJECT_STORAGE_ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE`; se agregan `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (requeridas, igual que `DATABASE_URL`). `OBJECT_STORAGE_BUCKET` se conserva.
- `.env`/`.env.example` actualizados con placeholders de Supabase.

## Verificación

- `pnpm lint` → OK.
- `pnpm test` → 63/63 unitarias OK. Nuevo `supabase-object-storage.adapter.spec.ts` (mock de `@supabase/supabase-js`): bucket-check una sola vez y memoizado, creación perezosa cuando falta, error propagado si falla la creación, `put/get/delete/presignGet` con mapeo de errores del SDK a `Error` de dominio (sin tipos de Supabase filtrados).
- `pnpm test:e2e` → 7/7 OK. Se agregó `test/support/fake-object-storage.service.ts` (en memoria) y ambos e2e (`projects`, `project-versions`) ahora sobreescriben `ObjectStorageService` con este fake — igual patrón que ya se usaba para `EMBEDDING_PROVIDER`. Esto evita depender de un proyecto Supabase real en CI/local sin credenciales, y sigue probando el pipeline de indexación completo de punta a punta contra Postgres real.
- `pnpm build` → OK.
- Verificación manual (servidor real, con `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` de placeholder, sin proyecto Supabase real): la app arranca sin error (confirma que el bucket-check perezoso no bloquea el boot); `POST /projects/index` responde `500 INTERNAL_ERROR` limpio (sin stack trace al cliente, con `correlationId`) cuando Supabase no es alcanzable; el log del servidor sí muestra el error real (`fetch failed` al crear el bucket) para depuración.

## Hallazgo detectado durante la verificación manual — corregido en el mismo corte

Durante la verificación manual noté que si `objectStorageService.put()` fallaba **después** de `ProjectVersionsRepository.createPending()` pero antes de encolar el job, la `ProjectVersion` quedaba huérfana en estado `PENDING` (sin `snapshotKey` ni job asociado). Como `hasActiveVersion()` considera `PENDING` como "activa", ese `Project` quedaba bloqueado para cualquier reintento de indexación futuro (409 `PROJECT_INDEXING_IN_PROGRESS` permanente). Este comportamiento ya existía con el adaptador anterior (MinIO); no fue introducido por esta migración, pero quedó más visible al probarlo manualmente contra Supabase inalcanzable.

**Corrección aplicada** (`ProjectVersionsService.startIndexing`): la secuencia `put` → `setSnapshot` → `enqueue` ahora está envuelta en un `try/catch`; si cualquiera de los tres pasos falla, la `ProjectVersion` se marca `FAILED` (con `failureReason`) antes de relanzar el error. Así `hasActiveVersion()` deja de considerarla activa y un reintento posterior sobre el mismo `Project` ya no queda bloqueado por un 409 permanente.

Verificación:
- Unit: `project-versions.service.spec.ts` — casos nuevos que cubren fallo en `put()` (verifica `markFailed` + que `setSnapshot`/`enqueue` no se llamen) y fallo en `enqueue()` (verifica `markFailed`).
- Manual (servidor real, Supabase inalcanzable): se creó un proyecto, se intentó indexar dos veces seguidas; ambos intentos fallaron por la causa raíz esperada (Supabase inalcanzable) pero el **segundo intento no fue bloqueado por 409** — confirmado en Postgres que ambas `ProjectVersion` quedaron en `FAILED` con `failureReason` legible, no huérfanas en `PENDING`.
- `pnpm lint` / `pnpm test` (65/65) / `pnpm test:e2e` (7/7) / `pnpm build` → OK tras el fix.

## Fuera de alcance (ya lo estaba antes de esta migración)

- Retry/backoff y usage metadata del `EmbeddingProvider`.
- Stage timings y redaction tests de observabilidad.
