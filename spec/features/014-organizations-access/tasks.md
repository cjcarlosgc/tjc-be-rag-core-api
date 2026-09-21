# 014 — Tareas

Todas sin iniciar. Requiere aprobación humana del work item (`AWAITING_APPROVAL`); `DEC-ORG-001` y `DEC-ORG-002` están aprobados y no bloquean. Contrato consolidado en SYSTEM-2.4 / INTEROP-2.4.

**Regla de CONTRACT_SYNC (única):** un sync de definición al aprobar el contrato (lo emite el leader) y un sync de implementación por cada bundle desplegable: bundle A = corte 1 + 4a; bundle B = cortes 2 + 3 (con 4b) + 5. Nunca uno por corte; nunca se edita el repositorio de Console.

**Orden de publicación:** la Console solo GitHub primero; bundle A después (espera a esa publicación porque `GITHUB_IDENTITY_REQUIRED` aplica a toda la sesión; la App no debe ser instalada por terceros, idealmente privada, hasta desplegarlo); bundle B (2, 3, 5) siempre junto, y solo tras su sync de implementación la Console envía `workspaceId` a `POST /projects` y `GET /projects` y consume `workspace`/`role`.

## Corte 1 — HU62 + identidad (bundle A)

- [x] Migración `user_github_identities` (sin backfill) y repositorio. Evidencia: `app/prisma/migrations/20260921120000_user_github_identities/migration.sql` (generada con `prisma migrate diff`, **escrita y NO aplicada a Supabase**), `UserGithubIdentitiesRepository`.
- [x] `SupabaseIdentityPort` + adapter (Admin API por `sub`, `identities[].id` del provider `github`) + fake de tests. Evidencia: `app/src/common/auth/supabase-admin-identity.adapter.ts` y `app/test/support/fake-supabase-identity.port.ts`.
- [x] Resolver y persistir `githubUserId` tras validar el JWT (HTTP y handshake WebSocket por la misma vía); nunca leer `user_metadata`. Evidencia: `GithubIdentityService`, `SessionAuthService` (guard HTTP/WS y `io.use()` del `RealtimeGateway` con `err.data`).
- [x] `AUTH_BYPASS` de desarrollo con identidad GitHub sintética configurada (`AUTH_BYPASS_GITHUB_USER_ID`), sin llamar a Supabase y rechazado en producción (validación de entorno y resolvedor).
- [x] `401 GITHUB_IDENTITY_REQUIRED` y `503 IDENTITY_UNAVAILABLE` con el envelope estándar (HTTP y rechazo de handshake WebSocket).
- [x] Pruebas (identidad presente/ausente, metadata manipulada, Admin API caída con y sin vínculo, bypass). Evidencia: specs de `common/auth`, `realtime.gateway.spec.ts`, `env.validation.spec.ts` y `test/github-identity.e2e-spec.ts`.
- [x] Actualizar `012-web-authentication` (tareas de calidad: login solo GitHub; correo deshabilitado tras la Console; manual linking deshabilitado). Las tareas de despliegue quedaron registradas en `012-web-authentication/tasks.md` sin marcar.

## Corte 4a — HU64, la corrección de seguridad (bundle A; justo tras el corte 1)

- [x] `GithubAccessPort.getRepositoryOwner`/`getRepositoryPermission` (resolviendo el login por `GET /user/{id}`) con fake y adapter HTTP; resultado `UNVERIFIABLE` distinto de `null`. Evidencia: `app/src/github-app/github-access.port.ts` (resultado `OK | NOT_FOUND | NOT_INSTALLED | UNVERIFIABLE`; los métodos reciben `{ installationId, repositoryName }` porque las lecturas de GitHub se direccionan por `owner/repo` con el installation token), `github-access-http.adapter.ts` y `app/test/support/fake-github-access.port.ts`.
- [x] `POST .../integrations/github` con el orden de INTEROP §6.8: sin permiso -> `404 GITHUB_REPOSITORY_NOT_FOUND` antes de `REPOSITORY_OUTSIDE_WORKSPACE`; `400 REPOSITORY_OUTSIDE_WORKSPACE` (personal: propietario = creador); `403 REPOSITORY_PERMISSION_INSUFFICIENT`; `409 REPOSITORY_ALREADY_BOUND` solo después; `503` ante permiso no verificable.
- [x] `verify-app-access` y `branches` con permiso mínimo `maintain`/`write`/`admin` (`403`; sin visibilidad `NOT_AUTHORIZED` y `404`; no verificable `503`).
- [x] `POST .../enable` sobre un binding `REVOKED` valida propietario (personal) y `repositoryId` como `POST` binding (`404 GITHUB_REPOSITORY_NOT_FOUND`, `400 REPOSITORY_OUTSIDE_WORKSPACE`; sigue `REVOKED`); la rama de organización va en el corte 3.
- [x] Orden en `branches` (App no instalada `403` antes de los `404`/`403` de permiso) y en `verify-app-access` (`NOT_AUTHORIZED`) con la App no instalada.
- [x] `workspaceId` en `GET /integrations/github/repositories` solo con el workspace personal; el de organización responde `404 WORKSPACE_NOT_FOUND` hasta el corte 3.
- [x] Pruebas del orden de validación y de no sondeo de repositorios ajenos; regresión de `013`. Evidencia: specs de `repository-bindings/` y `github-app/`, `test/repository-access.e2e-spec.ts` (HTTP: orden de `POST` binding, `enable` sobre `REVOKED`, `verify-app-access`, `branches`, discovery).

## Corte 2 — HU63 + HU58 (bundle B; paso de integración)

- [ ] Migración `projects.githubOrgId`/`githubOrgLogin` con check de coherencia e índice.
- [ ] `GithubAccessPort` del lado de organización (instalaciones, membresía, owners) con fake y adapter HTTP; acordar la interfaz completa con 4a.
- [ ] `GET /workspaces` con degradación ante caída de GitHub a solo el personal (el respaldo de organizaciones con acceso registrado llega con el corte 3).
- [ ] `POST /projects` y `GET /projects` con `workspaceId` solo personal (omitido o el propio id); el discovery no cambia en este corte; un `workspaceId` de organización responde `404 WORKSPACE_NOT_FOUND` en todas las rutas hasta el corte 3; `PATCH /projects/{projectId}`; `DELETE` como creador.
- [ ] `ProjectResponse` con `workspace` y `role` (interino: `ADMIN`, predicado del creador).
- [ ] Pruebas del corte y de contrato.

## Corte 3 — HU59 + HU60 + HU64 parte 4b (bundle B)

- [ ] Migración `project_access` + enum `ProjectRole` (solo Projects de organización), con inserción del registro `ADMIN` del creador en la transacción de `POST /projects` en una organización; un Project personal no crea registro.
- [ ] `accessibleProject(userId, minRole)` (rama personal por `ownerUserId`; rama de organización por registro suficiente Y binding no `REVOKED` o rol `ADMIN`, evaluada en cada petición) con prueba de que un registro Maintainer/Reader no da acceso con el binding `REVOKED`, y `rolesAtLeast`; sustituir todos los usos de `ownedProject` (projects, versions, targets, runs, functional knowledge, questions, publications, bindings, experiments).
- [ ] `ProjectAccessService` (alta al entrar sin carreras: UN advisory lock transaccional por `(projectId, userId)`, el mismo que toman reverificaciones y revocaciones, acotado por el presupuesto de verificaciones; `404`/`403`/`503`) con tope de concurrencia y presupuesto por petición, sin memoizar denegaciones.
- [ ] Guard default-deny y decoradores (`@RequireProjectRole`, `@NoProjectRole`) aplicados a cada ruta según la matriz de INTEROP §6.13; prueba que enumera el router y falla ante rutas sin declaración.
- [ ] Derivación de rol: owner de organización; membresía activa SIEMPRE (colaborador externo con `write` denegado, repos privados, internal y públicos) y permiso de repositorio para Maintainer/Reader; visibilidad de Project sin repositorio y con binding `REVOKED` solo a Admin.
- [ ] 4b: creación de Projects en organización (`WORKSPACE_ADMIN_REQUIRED`), `workspaceId` de organización en `POST /projects`, `GET /projects` y discovery; rama de organización de `REPOSITORY_OUTSIDE_WORKSPACE`; rol Maintainer en binding/`enable`/pausa (reactivar `REVOKED` lo hace un Admin). Sin ninguna tarea duplicada con el 4a.
- [ ] `GET /workspaces`: respaldo con las organizaciones de Projects con acceso registrado ante una caída de GitHub; una organización con la App desinstalada (`NOT_INSTALLED`) no se ofrece y sus Projects responden `404`, no `503`.
- [ ] `POST .../enable` sobre `REVOKED`, rama de organización (propietario = organización del Project y `repositoryId`), reactivado por un Admin.
- [ ] Listados: `GET /projects`, `GET /analysis-runs` y `GET /action-required` (personales del usuario más organización con registro); `GET /action-required?projectId` de un Project no visible responde `404 PROJECT_NOT_FOUND`.
- [ ] `RealtimeGateway`: mapa socket -> Project, rol Reader al suscribirse, `SubscribeAck` (rechazo reintentable con `GITHUB_VERIFICATION_UNAVAILABLE`), expulsión por pérdida de acceso, borrado lógico y binding `REVOKED` para no Admin.
- [ ] Matriz e2e ruta x rol, pruebas de caída de GitHub y **prueba de carrera alta vs revocación**.

## Corte 5 — HU61 (bundle B)

5a (solo depende del 4a; sin `project_access` ni columnas del corte 2):
- [ ] `repository.renamed`/`transferred`/`deleted` sobre el binding (nombre o `REVOKED`, sin borrar registros); ajustes de `installation`/`installation_repositories` sobre bindings (`suspend` no borra).
- [ ] Infraestructura de jobs `ACCESS_RECONCILIATION`/`ACCESS_REVERIFY`: migración de `jobs.dedupeKey` y del índice único parcial solo sobre `PENDING`, reclamo de locks obsoletos (un `PENDING` no se reclama mientras exista un `RUNNING` no obsoleto con la misma `dedupeKey`), siguiente ocurrencia encolada AL INICIO de la ejecución, siembra al arrancar que omite solo si hay un `PENDING` o un `RUNNING` no obsoleto, backoff creciente acotado a una hora para lo no verificable.
- [ ] La reconciliación (c) revalida propietario y nombre del repositorio de todo Project vivo con binding, personales incluidos (transferido o eliminado -> `REVOKED`; renombrado -> actualiza el nombre), sin el borrado de registros.

5b (depende del 3 y del 5a):
- [ ] Enrutar `member`, `membership`, `organization`, `team` y `repository` en el ingress; encolar `ACCESS_REVERIFY` con el alcance del payload (el payload solo selecciona, el rol sale de una verificación viva bajo el advisory lock).
- [ ] Efectos de organización con `projects.githubOrgId/githubOrgLogin`: `organization.renamed` y `organization.deleted`.
- [ ] Borrado de registros Maintainer y Reader al pasar un binding a `REVOKED` (por `repository.transferred`/`deleted`, `installation.deleted`, `installation_repositories.removed` o reconciliación (c)); ciclo de vida de la organización (desaparece/App desinstalada/sin owners) y reaparición con binding `REVOKED` reactivado por un Admin.
- [ ] Reconciliación (a) y (b) de registros de acceso: mismas reglas que el alta, borra lo confirmado como perdido y conserva lo no verificable.
- [ ] Pruebas por evento y `action`, duplicados/fuera de orden, firma alterada, jobs (dedupe solo `PENDING`, lock obsoleto, siembra, cadena que sobrevive a un fallo, evento durante un `ACCESS_REVERIFY` `RUNNING`), reconciliación, caída de GitHub y **carrera alta vs evento de revocación**.

## Cierre

- [ ] Lint, test y build; e2e de la matriz; revisión independiente y `contract-reviewer`.
- [ ] `CONTRACT_SYNC` a Console: el de definición al aprobar el contrato (leader) y uno de implementación por bundle (A y B), con las rutas, DTOs, errores, orden de despliegue y `breaking: false` cualificado.
- [ ] Registrar la evidencia de las precondiciones de despliegue (Console solo GitHub publicada antes del bundle A, bundle A antes de que terceros instalen la App (hasta entonces no instalada por terceros, idealmente privada), App pública con `Members: read` y eventos, validación contra una organización real incluido un colaborador externo, manual linking deshabilitado, correo deshabilitado tras la Console solo GitHub) como criterio de aceptación, sin bloquear el merge.

## Notas de implementación de la revisión contractual (2026-09-21, no requieren nuevo ciclo)

- Jobs (corte 5a): al reprogramar un `ACCESS_REVERIFY` cuyo `dedupeKey` ya tiene otro `PENDING` (por backoff de "no verificable" o por reclamo de un lock obsoleto), completar o descartar el job actual en lugar de devolverlo a `PENDING`, para no chocar con el índice único parcial.
- Reclamo de jobs: `claimNext` debe excluir un `PENDING` cuyo `dedupeKey` coincida con un `RUNNING` no obsoleto (una sola sentencia; los tipos sin `dedupeKey` no cambian). El reclamo de `RUNNING` obsoletos es infraestructura nueva del corte 5a.
- `repository.transferred` y la reconciliación (c) para Projects de organización comparan con `projects.githubOrgId` (columna del corte 2): esa rama se implementa en el corte 5b. Hasta el corte 3 solo existen Projects personales.
- WebSocket (corte 1): añadir la tarea de rechazo en el handshake con `io.use()` y `err.data` (`GITHUB_IDENTITY_REQUIRED`, `IDENTITY_UNAVAILABLE`, `INVALID_ACCESS_TOKEN`). Hoy la autenticación es un guard por mensaje. Un rechazo de middleware desactiva la reconexión automática del cliente, así que `retryable: true` exige `connect()` manual; la Console actual no usa `auth` y cae al polling.

