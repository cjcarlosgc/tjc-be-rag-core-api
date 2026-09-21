# persistence — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Persistir datos, chunks, embeddings, jobs y resultados autoritativos con trazabilidad por versión en PostgreSQL + pgvector de Supabase.

## Reglas y comportamiento

- Prisma es la fuente versionada del esquema relacional; pgvector se habilita y evoluciona mediante migraciones SQL del repositorio. No crear tablas manualmente como sustituto de las migraciones.
- La migración actual materializa `projects`, `project_versions`, `code_chunks`, `test_targets` y `jobs`, además de la extensión `vector`. Las entidades de generación, validación, artifacts y experimento se añadirán en los work items que las implementen; no declararlas existentes antes de ello.
- `projects.deletedAt` (nullable, HU56) materializa el borrado lógico; toda lectura owner-scoped filtra `deletedAt IS NULL`. `repository_bindings.repositoryId` sigue siendo único: borrar un Project elimina su fila de binding para liberarlo, mientras que desconectar (`DISABLED`) la conserva. Un motivo de `DISABLED` (usuario vs. suspensión de la instalación) permite que `unsuspend` no reactive lo pausado por el usuario. Un `DISABLED` anterior a la migración (`disabledReason` null) se trata como pausa del usuario: `unsuspend` no lo reactiva y solo `POST .../enable` lo rehabilita. Ambos cambios son migraciones Prisma.
- `project_versions.snapshotKey` almacena la key privada y estable del objeto. No almacenar URLs firmadas.
- RAG Core es propietario de la persistencia del estado y resultado de ejecución. Sandbox devuelve hechos estructurados y no conecta directamente a esta base por defecto.
- Si una arquitectura futura exige acceso directo de un worker Sandbox, requiere una decisión separada y un rol PostgreSQL restringido a tablas/operaciones mínimas; nunca el usuario administrador `postgres`.
- `DATABASE_URL` es configuración de servidor y no se expone a Frontend, Sandbox ni contenedores de código no confiable.
- La dimensionalidad `1536` es definitiva conforme a `DEC-EMB-001` (`text-embedding-3-small`), resuelta en `spec/transversal/providers/spec.md`.
- `DEC-IDEMP-001` se materializa con un registro durable de idempotencia. Los scopes `TEST_RUN_CREATE` y `TARGET_RETRY` quedaron retirados junto con la generación manual (SDD 2.0); `EXPERIMENT_CREATE` permanece vigente para HU19. Cada registro conserva `idempotencyKey` UUID, `requestFingerprint` SHA-256, `operationId` UUID y `createdAt`, con unicidad `(scope, idempotencyKey)`.
- La huella canónica cubre scope, ruta/params normalizados y body validado con keys JSON ordenadas. Campos omitidos no se convierten silenciosamente en `null`; cambios de `currentVersionId` posteriores no alteran la huella ni el replay de una operación ya aceptada.
- `operationId` referencia lógicamente el `runId`, `experimentId` o `retryJobId` original. En V1 el registro vive al menos tanto como el recurso/resultado correspondiente y no expira de forma independiente, para impedir que una key antigua vuelva a crear trabajo.
- Crear el recurso, insertar el registro idempotente y encolar el job ocurre en una misma transacción PostgreSQL. Ante carrera por la unicidad, el perdedor relee el registro ganador, compara la huella y devuelve la operación original o `409 IDEMPOTENCY_CONFLICT`.
- `Project.ownerUserId` es UUID, indexado y obligatorio para datos live; vincula todo el árbol de recursos a la identidad autenticada de HU29. Las consultas deben filtrar por propietario desde el repositorio (T-003 sustituye este filtro por el predicado de acceso `accessibleProject`, ver "Organizaciones y acceso"). Las tablas de dominio no se conceden a `anon`/`authenticated` por Data API; si permanecen en un schema expuesto, RLS se habilita como defensa adicional sin sustituir ese scoping.
- **Organizaciones y acceso (`DEC-ORG-001`, HU58-HU64, `INTEROP-2.4` §6.13; definido, pendiente de implementación).** La base no tiene datos que migrar: las migraciones solo crean estructura, sin backfill, y no se conserva `ownedProject()` como camino paralelo. Persistencia mínima, sin tablas `Organization` ni `Membership`:
  - `user_github_identities`: `userId` (PK, el `sub` de Supabase, mismo tipo que `Project.ownerUserId`), `githubUserId` (texto numérico, único, inmutable), `githubLogin` (opcional, solo presentación, nunca autoriza), `createdAt`/`updatedAt`. Se puebla una vez con la Admin API de Supabase por `sub` (`identities[].id`); nunca se lee de `user_metadata`.
  - `projects`: columnas nullable `githubOrgId` y `githubOrgLogin` (texto; ambas nulas = workspace personal, ambas presentes = organización; check constraint que impide una sola), índice por `githubOrgId`. `ownerUserId` pasa a ser el creador y deja de autorizar por sí mismo; el workspace no cambia tras crear el Project.
  - `project_access`: `(projectId, userId, role, verifiedAt)` con `role` enum `ProjectRole` (`ADMIN`, `MAINTAINER`, `READER`), clave única `(projectId, userId)`, índice por `userId` (listados) y por `projectId` (reconciliación, eventos), `verifiedAt` `timestamptz`. `verifiedAt` es la última confirmación viva, no una caducidad. Se crea al entrar (verificación viva), se actualiza o borra por webhook o reconciliación, y la creación de un Project inserta el registro `ADMIN` del creador en la misma transacción que el Project.
  - Sustituto de `ownedProject(ownerUserId)`: un predicado `accessibleProject(userId, minRole = 'READER')` que devuelve `{ deletedAt: null, access: { some: { userId, role: { in: rolesAtLeast(minRole) } } } }` (jerarquía `ADMIN` ⊃ `MAINTAINER` ⊃ `READER`), con el mismo uso que hoy: en la consulta, no cargando y comparando, y como filtro de relación (`project: accessibleProject(...)`) en los repositorios de proyectos, versiones, targets, Runs, Functional Knowledge, preguntas, publicaciones, bindings y experimentos. Un servicio de acceso (`ProjectAccessService`) resuelve el caso "sin registro" (verificación viva y alta) en el borde de cada petición, y los repositorios solo conocen el predicado. Los job handlers, que no tienen identidad de usuario, siguen sin filtrar por acceso (autoriza la GitHub App).
  - `repository_bindings.repositoryName` se actualiza con el renombre del repositorio; una transferencia fuera del workspace o la eliminación del repositorio pasa el binding a `REVOKED` (evidencia intacta).
  - La reconciliación horaria es un `jobs.type` propio sobre la cola existente, que se reprograma a sí mismo una hora después de cada ejecución, aunque falle.
- `ContextTrace` conserva una cabecera relacional consultable y un payload tipado `RAG|AGENT` para HU27/HU28. Siempre referencia mediante foreign keys una `ProjectVersion` inmutable, target, origen e intento; las foreign keys se indexan y se agrega un índice compuesto que respalde el listado por origen/target/intento vigente. Los discriminantes/estados se restringen mediante enum o check; no guarda archivos completos ni chain-of-thought.
- Los archivos descubiertos por `list_files` deben poder paginarse sin cargar el conjunto completo junto al detalle principal de la traza. Fechas usan `timestamptz`; hashes y paths usan `text` con constraints de formato/longitud donde aporten integridad.


## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.

## Cierre de la brecha de implementación SDD 1.14

Resuelto en SDD 1.15: el modelo `IdempotencyRecord` (migración Prisma versionada, aplicada contra la Supabase real vía el flujo normal del repositorio) materializa exactamente lo descrito arriba — `scope`/`idempotencyKey`/`requestFingerprint`/`operationId`/`createdAt`, unicidad compuesta `(scope, idempotencyKey)`. `IdempotencyService` centraliza la huella canónica (keys JSON ordenadas recursivamente vía `canonicalJsonStringify`), el registro transaccional junto con la creación del recurso/job, y la resolución de la carrera por unicidad releyendo al ganador.
