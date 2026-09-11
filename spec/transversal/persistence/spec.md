# persistence — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Persistir datos, chunks, embeddings, jobs y resultados autoritativos con trazabilidad por versión en PostgreSQL + pgvector de Supabase.

## Reglas y comportamiento

- Prisma es la fuente versionada del esquema relacional; pgvector se habilita y evoluciona mediante migraciones SQL del repositorio. No crear tablas manualmente como sustituto de las migraciones.
- La migración actual materializa `projects`, `project_versions`, `code_chunks`, `test_targets` y `jobs`, además de la extensión `vector`. Las entidades de generación, validación, artifacts y experimento se añadirán en los work items que las implementen; no declararlas existentes antes de ello.
- `project_versions.snapshotKey` almacena la key privada y estable del objeto. No almacenar URLs firmadas.
- RAG Core es propietario de la persistencia del estado y resultado de ejecución. Sandbox devuelve hechos estructurados y no conecta directamente a esta base por defecto.
- Si una arquitectura futura exige acceso directo de un worker Sandbox, requiere una decisión separada y un rol PostgreSQL restringido a tablas/operaciones mínimas; nunca el usuario administrador `postgres`.
- `DATABASE_URL` es configuración de servidor y no se expone a Frontend, Sandbox ni contenedores de código no confiable.
- La dimensionalidad `1536` es definitiva conforme a `DEC-EMB-001` (`text-embedding-3-small`), resuelta en `spec/transversal/providers/spec.md`.
- `DEC-IDEMP-001` se materializa con un registro durable de idempotencia para los scopes `TEST_RUN_CREATE`, `EXPERIMENT_CREATE` y `TARGET_RETRY`. Cada registro conserva `idempotencyKey` UUID, `requestFingerprint` SHA-256, `operationId` UUID y `createdAt`, con unicidad `(scope, idempotencyKey)`.
- La huella canónica cubre scope, ruta/params normalizados y body validado con keys JSON ordenadas. Campos omitidos no se convierten silenciosamente en `null`; cambios de `currentVersionId` posteriores no alteran la huella ni el replay de una operación ya aceptada.
- `operationId` referencia lógicamente el `runId`, `experimentId` o `retryJobId` original. En V1 el registro vive al menos tanto como el recurso/resultado correspondiente y no expira de forma independiente, para impedir que una key antigua vuelva a crear trabajo.
- Crear el recurso, insertar el registro idempotente y encolar el job ocurre en una misma transacción PostgreSQL. Ante carrera por la unicidad, el perdedor relee el registro ganador, compara la huella y devuelve la operación original o `409 IDEMPOTENCY_CONFLICT`.
- `Project.ownerUserId` es UUID, indexado y obligatorio para datos live; vincula todo el árbol de recursos a la identidad autenticada de HU29. Las consultas deben filtrar por propietario desde el repositorio. Las tablas de dominio no se conceden a `anon`/`authenticated` por Data API; si permanecen en un schema expuesto, RLS se habilita como defensa adicional sin sustituir ese scoping.
- `ContextTrace` conserva una cabecera relacional consultable y un payload tipado `RAG|AGENT` para HU27/HU28. Siempre referencia mediante foreign keys una `ProjectVersion` inmutable, target, origen e intento; las foreign keys se indexan y se agrega un índice compuesto que respalde el listado por origen/target/intento vigente. Los discriminantes/estados se restringen mediante enum o check; no guarda archivos completos ni chain-of-thought.
- Los archivos descubiertos por `list_files` deben poder paginarse sin cargar el conjunto completo junto al detalle principal de la traza. Fechas usan `timestamptz`; hashes y paths usan `text` con constraints de formato/longitud donde aporten integridad.


## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.

## Cierre de la brecha de implementación SDD 1.14

Resuelto en SDD 1.15: el modelo `IdempotencyRecord` (migración Prisma versionada, aplicada contra la Supabase real vía el flujo normal del repositorio) materializa exactamente lo descrito arriba — `scope`/`idempotencyKey`/`requestFingerprint`/`operationId`/`createdAt`, unicidad compuesta `(scope, idempotencyKey)`. `IdempotencyService` centraliza la huella canónica (keys JSON ordenadas recursivamente vía `canonicalJsonStringify`), el registro transaccional junto con la creación del recurso/job, y la resolución de la carrera por unicidad releyendo al ganador.
