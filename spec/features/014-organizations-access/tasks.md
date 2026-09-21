# 014 — Tareas

Todas sin iniciar. Requiere aprobación humana del work item (`AWAITING_APPROVAL`); `DEC-ORG-001` y `DEC-ORG-002` están aprobados y no bloquean. Contrato consolidado en SYSTEM-2.4 / INTEROP-2.4.

**Regla de CONTRACT_SYNC (única):** un sync de definición al aprobar el contrato (lo emite el leader) y un sync de implementación por cada bundle desplegable: bundle A = corte 1 + 4a; bundle B = cortes 2 + 3 (con 4b) + 5. Nunca uno por corte; nunca se edita el repositorio de Console.

**Orden de publicación:** bundle A primero (la App no debe ser instalable por terceros antes); bundle B (2, 3, 5) siempre junto.

## Corte 1 — HU62 + identidad (bundle A)

- [ ] Migración `user_github_identities` (sin backfill) y repositorio.
- [ ] `SupabaseIdentityPort` + adapter (Admin API por `sub`, `identities[].id` del provider `github`) + fake de tests.
- [ ] Resolver y persistir `githubUserId` tras validar el JWT (HTTP y handshake WebSocket por la misma vía); nunca leer `user_metadata`.
- [ ] `AUTH_BYPASS` de desarrollo con identidad GitHub sintética configurada, sin llamar a Supabase y rechazado en producción.
- [ ] `401 GITHUB_IDENTITY_REQUIRED` y `503 IDENTITY_UNAVAILABLE` con el envelope estándar.
- [ ] Pruebas (identidad presente/ausente, metadata manipulada, Admin API caída con y sin vínculo, bypass).
- [ ] Actualizar `012-web-authentication` (tareas de calidad: login solo GitHub; correo deshabilitado tras la Console; manual linking deshabilitado).

## Corte 4a — HU64, la corrección de seguridad (bundle A; justo tras el corte 1)

- [ ] `GithubAccessPort.getRepositoryOwner`/`getRepositoryPermission` (resolviendo el login por `GET /user/{id}`) con fake y adapter HTTP; resultado `UNVERIFIABLE` distinto de `null`.
- [ ] `POST .../integrations/github` con el orden de INTEROP §6.8: sin permiso -> `404 GITHUB_REPOSITORY_NOT_FOUND` antes de `REPOSITORY_OUTSIDE_WORKSPACE`; `400 REPOSITORY_OUTSIDE_WORKSPACE` (personal: propietario = creador); `403 REPOSITORY_PERMISSION_INSUFFICIENT`; `409 REPOSITORY_ALREADY_BOUND` solo después; `503` ante permiso no verificable.
- [ ] `verify-app-access` y `branches` con permiso mínimo `maintain`/`write`/`admin` (`403`; sin visibilidad `NOT_AUTHORIZED` y `404`; no verificable `503`).
- [ ] `workspaceId` en `GET /integrations/github/repositories` solo con el workspace personal; el de organización responde `404 WORKSPACE_NOT_FOUND` hasta el corte 3.
- [ ] Pruebas del orden de validación y de no sondeo de repositorios ajenos; regresión de `013`.

## Corte 2 — HU63 + HU58 (bundle B; paso de integración)

- [ ] Migración `projects.githubOrgId`/`githubOrgLogin` con check de coherencia e índice.
- [ ] `GithubAccessPort` del lado de organización (instalaciones, membresía, owners) con fake y adapter HTTP; acordar la interfaz completa con 4a.
- [ ] `GET /workspaces` con degradación ante caída de GitHub.
- [ ] `POST /projects` con `workspaceId` solo personal (omitido o el propio id); un `workspaceId` de organización responde `404 WORKSPACE_NOT_FOUND` en todas las rutas hasta el corte 3; `PATCH /projects/{projectId}`; `DELETE` como creador.
- [ ] `ProjectResponse` con `workspace` y `role` (interino: `ADMIN`, predicado del creador).
- [ ] Pruebas del corte y de contrato.

## Corte 3 — HU59 + HU60 + HU64 parte 4b (bundle B)

- [ ] Migración `project_access` + enum `ProjectRole` (solo Projects de organización), con inserción del registro `ADMIN` del creador en la transacción de `POST /projects` en una organización; un Project personal no crea registro.
- [ ] `accessibleProject(userId, minRole)` (rama personal por `ownerUserId`, rama de organización por registro) y `rolesAtLeast`; sustituir todos los usos de `ownedProject` (projects, versions, targets, runs, functional knowledge, questions, publications, bindings, experiments).
- [ ] `ProjectAccessService` (alta al entrar sin carreras: advisory lock por `(projectId, userId)` o marca de inicio + reverificación reencolada; `404`/`403`/`503`) con tope de concurrencia y presupuesto por petición, sin memoizar denegaciones.
- [ ] Guard default-deny y decoradores (`@RequireProjectRole`, `@NoProjectRole`) aplicados a cada ruta según la matriz de INTEROP §6.13; prueba que enumera el router y falla ante rutas sin declaración.
- [ ] Derivación de rol: owner de organización; membresía activa SIEMPRE (colaborador externo con `write` denegado, repos privados, internal y públicos) y permiso de repositorio para Maintainer/Reader; visibilidad de Project sin repositorio y con binding `REVOKED` solo a Admin.
- [ ] 4b: creación de Projects en organización (`WORKSPACE_ADMIN_REQUIRED`), `workspaceId` de organización en `POST /projects`, `GET /projects` y discovery; rama de organización de `REPOSITORY_OUTSIDE_WORKSPACE`; rol Maintainer en binding/`enable`/pausa (reactivar `REVOKED` lo hace un Admin). Sin ninguna tarea duplicada con el 4a.
- [ ] Listados: `GET /projects`, `GET /analysis-runs` y `GET /action-required` (personales del usuario más organización con registro); `GET /action-required?projectId` de un Project no visible responde `404 PROJECT_NOT_FOUND`.
- [ ] `RealtimeGateway`: mapa socket -> Project, rol Reader al suscribirse, `SubscribeAck` (rechazo reintentable con `GITHUB_VERIFICATION_UNAVAILABLE`), expulsión por pérdida de acceso, borrado lógico y binding `REVOKED` para no Admin.
- [ ] Matriz e2e ruta x rol, pruebas de caída de GitHub y **prueba de carrera alta vs revocación**.

## Corte 5 — HU61 (bundle B)

5a (no depende del 3):
- [ ] Renombre de repositorio, transferencia fuera del workspace y eliminación (`REVOKED`); renombre y `deleted` de organización; ajustes de `installation`/`installation_repositories` sobre bindings (`suspend` no borra).
- [ ] Infraestructura de jobs `ACCESS_RECONCILIATION`/`ACCESS_REVERIFY`: migración del índice único parcial (o advisory lock), reclamo de locks obsoletos, siguiente ocurrencia encolada AL INICIO de la ejecución, siembra al arrancar que trata un job en ejecución obsoleto como ausente, backoff creciente acotado a una hora para lo no verificable.
- [ ] La reconciliación revalida propietario y nombre del repositorio de cada binding (transferido o eliminado -> `REVOKED`; renombrado -> actualiza el nombre).

5b (depende del 3):
- [ ] Enrutar `member`, `membership`, `organization`, `team` y `repository` en el ingress; encolar `ACCESS_REVERIFY` con el alcance del payload (el payload solo selecciona, el rol sale de una verificación viva).
- [ ] Borrado de registros de acceso por `installation.deleted`/`installation_repositories.removed`; ciclo de vida de la organización (desaparece/App desinstalada/sin owners) y reaparición con binding `REVOKED` reactivado por un Admin.
- [ ] Reconciliación de registros de acceso: mismas reglas que el alta, borra lo confirmado como perdido y conserva lo no verificable.
- [ ] Pruebas por evento y `action`, duplicados/fuera de orden, firma alterada, jobs (dedupe, lock obsoleto, cadena que sobrevive a un fallo), reconciliación, caída de GitHub y **carrera alta vs evento de revocación**.

## Cierre

- [ ] Lint, test y build; e2e de la matriz; revisión independiente y `contract-reviewer`.
- [ ] `CONTRACT_SYNC` a Console: el de definición al aprobar el contrato (leader) y uno de implementación por bundle (A y B), con las rutas, DTOs, errores, orden de despliegue y `breaking: false` cualificado.
- [ ] Registrar la evidencia de las precondiciones de despliegue (bundle A antes de que terceros instalen la App, App pública con `Members: read` y eventos, validación contra una organización real incluido un colaborador externo, manual linking deshabilitado, correo deshabilitado tras la Console solo GitHub) como criterio de aceptación, sin bloquear el merge.
