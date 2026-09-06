# Evidencia — HU02, HU03, HU04, HU05, HU07 (002-project-version-indexing)

**Sprint:** Sprint 1 · **Estado:** DONE

## Decisiones PENDING resueltas antes de implementar

- **Mecanismo durable de jobs:** cola DB-backed en PostgreSQL (tabla `jobs`, despacho con `SELECT ... FOR UPDATE SKIP LOCKED`, backoff exponencial acotado). Ver `spec/constitution/architecture.md`, `spec/transversal/async-jobs/`.
- **Proveedor usado por este corte histórico:** MinIO (S3-compatible) vía `@aws-sdk/client-s3`. La decisión vigente posterior es Supabase Storage vía `@supabase/supabase-js`, detrás de `ObjectStorageService`; ver `spec/constitution/tech-stack.md` y `spec/transversal/object-storage/`.

Ambas decisiones fueron aprobadas explícitamente por el usuario antes de tocar código (no se dieron por cerradas por iniciativa propia).

## Alcance implementado

### Infraestructura transversal (reutilizable por features futuras)

- `JobsModule` (`src/jobs/`): `JobsService` (enqueue + polling + registro de handlers), `JobsRepository` (claim atómico con `FOR UPDATE SKIP LOCKED`, complete/fail con backoff).
- `ObjectStorageModule` (`src/object-storage/`): interfaz `ObjectStorageProvider` (put/get/delete/presignGet) + `S3ObjectStorageProvider` (MinIO, crea el bucket si no existe).
- `ProvidersModule` (`src/providers/`): interfaz `EmbeddingProvider` + `OpenAiEmbeddingProvider` (cliente OpenAI perezoso — no rompe el arranque de la app si falta `OPENAI_API_KEY`; falla solo al intentar generar embeddings reales).
- Prisma: modelos `Job`, `CodeChunk` (columna `embedding` como `Unsupported("vector(1536)")`, insertada/leída por SQL crudo), extensión `vector` e índice `hnsw` (cosine) vía migración.
- `docker-compose.yml` amplía a MinIO (puertos 9000/9001) además de Postgres+pgvector.

### Feature 002 (`src/project-versions/`)

- `POST /projects/index` (multipart `file` + `projectId?` + `name?`): valida el ZIP (extensión/MIME/tamaño/no-vacío) y su compatibilidad (requiere `package.json` + al menos un `.ts/.tsx`, sin extraer a disco) **de forma síncrona**, antes de responder — así HU03 puede informar problemas antes de aceptar el trabajo. Si es válido: resuelve/crea el `Project`, bloquea con 409 `PROJECT_INDEXING_IN_PROGRESS` si ya hay una versión activa, crea el `ProjectVersion` (`PENDING`), sube el ZIP a Object Storage y encola el job de indexación. Responde 202 con `projectId`, `projectVersionId`, `status`, `pollAfterMs`.
- Job asíncrono (`IndexingJobHandler`): `EXTRACTING` (extracción segura a un workspace temporal real, protegida contra Zip Slip, siempre limpiado en `finally`) → `ANALYZING` (file discovery + ts-morph) → `CHUNKING` (chunk por clase/función/interfaz/type/enum top-level, o archivo completo si no hay declaraciones) → `EMBEDDING` (OpenAI, batched) → `PERSISTING` (borra chunks previos del mismo `projectVersionId` para idempotencia, inserta chunks+embeddings, promueve `Project.currentVersionId` transaccionalmente) → `COMPLETED`. Cualquier error deja la versión en `FAILED` con `failureReason` (mensaje, sin stack trace) y relanza el error para que la cola de jobs aplique su política de reintento/backoff.
- `GET /project-versions/:id`: estado y metadatos (404 `PROJECT_VERSION_NOT_FOUND`).
- `GET /project-versions/:id/results`: resumen (archivos procesados, chunks) si `COMPLETED`; 409 `ANALYSIS_NOT_FINISHED` en cualquier otro estado (incluye `FAILED`, con `failureReason` en `details`).

## Interpretaciones tomadas ante ambigüedad de spec (documentadas, no cerradas como "definitivas")

- Criterio mínimo de compatibilidad (`UNSUPPORTED_PROJECT`): requiere `package.json` + al menos un archivo `.ts`/`.tsx` tras aplicar la pool/ignore list. La spec no detalla más criterios; la detección de framework (Jest/Vitest) es responsabilidad de la feature 003 (`test-inventory`, HU06) y **no** se implementó aquí.
- `GET .../results` con versión `FAILED` responde 409 `ANALYSIS_NOT_FINISHED` (no hay un código específico en el catálogo aprobado para "falló"; se opta por reusar el existente en vez de inventar uno nuevo).
- El campo "framework detectado" de HU05 se difiere a cuando exista la feature 003; no se fabricó un valor.

## Verificación

Ejecutado en `app/`:

- `pnpm lint` → OK.
- `pnpm test` → 47/47 pruebas unitarias OK, incluyendo:
  - `zip-entries.util` (entradas seguras, corrupción, Zip Slip, compatibilidad).
  - `zip-validation.service` (ZIP_REQUIRED/INVALID_ZIP/ZIP_TOO_LARGE).
  - `typescript-parser.service` (chunking real con ts-morph sobre archivos temporales).
  - `project-versions.service` (todas las ramas: 404/409/422, feliz).
  - `indexing-job.handler` (pipeline completo, no-op en versión ya completada/inexistente, fallo con y sin workspace, idempotencia de `deleteByProjectVersion`).
  - `jobs.service` / `s3-object-storage.provider` / `openai-embedding.provider` / `all-exceptions.filter` (incluye prueba explícita de que nunca se filtra un stack trace).
- `pnpm test:e2e` → 7/7 OK, incluyendo `test/project-versions.e2e-spec.ts` contra **Postgres y MinIO reales** (Docker) con un `EmbeddingProvider` fake: sube un ZIP válido, espera a `COMPLETED` por polling real, valida `GET .../results`, valida 422 en ZIP incompatible y 409 en indexación concurrente.
- `pnpm build` → OK.
- Verificación manual (servidor real, sin `OPENAI_API_KEY`): confirma que el pipeline llega hasta `EMBEDDING`, falla ahí de forma controlada (`FAILED` + `failureReason` legible, sin crash del proceso) y que el ZIP quedó efectivamente en MinIO bajo `projects/{projectId}/versions/{versionId}/source.zip`.

## Fuera de alcance (diferido)

- Feature 003 (test inventory / detección de framework, HU06).
- Retry/backoff y usage metadata específicos del `EmbeddingProvider` (quedan como PENDING abiertos en `spec/transversal/providers/tasks.md`).
- Stage timings y redaction tests de observabilidad (quedan como PENDING abiertos en `spec/transversal/observability/tasks.md`).
