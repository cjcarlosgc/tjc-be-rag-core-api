# 014 — Tareas

Todas sin iniciar. Requiere aprobación humana (`AWAITING_APPROVAL`) y respuesta a `DEC-ORG-002` antes de los cortes 3 y 4. Contrato ya consolidado en SYSTEM-2.4 / INTEROP-2.4; al terminar cada corte con impacto contractual, Core publica `CONTRACT_SYNC` a Console (nunca se edita su repositorio).

## Corte 1 — HU62 + identidad

- [ ] Migración `user_github_identities` (sin backfill) y repositorio.
- [ ] `SupabaseIdentityPort` + adapter (Admin API por `sub`, `identities[].id` del provider `github`) + fake de tests.
- [ ] Resolver y persistir `githubUserId` tras validar el JWT; nunca leer `user_metadata`.
- [ ] `401 GITHUB_IDENTITY_REQUIRED` y `503 IDENTITY_UNAVAILABLE` con el envelope estándar.
- [ ] Pruebas (identidad presente/ausente, metadata manipulada, Admin API caída con y sin vínculo).
- [ ] Actualizar `012-web-authentication` (tareas de calidad: login solo GitHub; deshabilitar correo es precondición de despliegue).

## Corte 2 — HU63 + HU58

- [ ] Migración `projects.githubOrgId`/`githubOrgLogin` con check de coherencia e índice.
- [ ] `GithubAccessPort` (instalaciones de organización, membresía, owners) con fake y adapter HTTP.
- [ ] `GET /workspaces` con degradación ante caída de GitHub.
- [ ] `POST /projects` con `workspaceId` (verificación viva de owner; `WORKSPACE_NOT_FOUND`, `WORKSPACE_ADMIN_REQUIRED`, `503`); `GET /projects?workspaceId`; `PATCH /projects/{projectId}`; `DELETE` con rol Admin.
- [ ] `ProjectResponse` con `workspace` y `role` (interino: `ADMIN`, predicado del creador).
- [ ] Pruebas del corte y de contrato.

## Corte 3 — HU59 + HU60 (bloqueado por `DEC-ORG-002.1`, `.2`, `.3`)

- [ ] Migración `project_access` + enum `ProjectRole`, con inserción del registro `ADMIN` del creador en la transacción de `POST /projects`.
- [ ] `accessibleProject(userId, minRole)` y `rolesAtLeast`; sustituir todos los usos de `ownedProject` (projects, versions, targets, runs, functional knowledge, questions, publications, bindings, experiments).
- [ ] `ProjectAccessService` (alta al entrar, `404`/`403`/`503`) y decorador de rol mínimo aplicado a cada ruta según la matriz de INTEROP §6.13.
- [ ] Derivación de rol (owner de organización, permiso de repositorio, visibilidad de Project sin repositorio y con binding `REVOKED`) con fakes.
- [ ] Listados sin filtro/`workspaceId` y cross-proyecto sobre Projects visibles; omisión de lo no verificable.
- [ ] `RealtimeGateway`: rol Reader al suscribirse y salida de salas al perder el acceso.
- [ ] Matriz e2e ruta x rol y pruebas de caída de GitHub.

## Corte 4 — HU64 (bloqueado por `DEC-ORG-002.4` solo en su parte de endurecimiento)

- [ ] Filtro por `workspaceId` en `GET /integrations/github/repositories` (organización: solo esa organización; personal: solo propios).
- [ ] `REPOSITORY_OUTSIDE_WORKSPACE` y `REPOSITORY_PERMISSION_INSUFFICIENT` en el orden de INTEROP §6.8; `404` para quien no tiene ningún permiso.
- [ ] Rol Maintainer en binding/`enable`/pausa; sin ruta de revinculación.
- [ ] Permiso mínimo en `verify-app-access` y `branches` si se aprueba `DEC-ORG-002.4`.
- [ ] Pruebas del orden de validación y de no sondeo de repositorios ajenos.

## Corte 5 — HU61

- [ ] Enrutar `member`, `membership`, `organization`, `team` y `repository` en el ingress; encolar `ACCESS_REVERIFY` con el alcance del payload.
- [ ] Ajustar `installation`/`installation_repositories` para borrar registros de acceso; `suspend` no borra.
- [ ] Renombre de repositorio, transferencia fuera del workspace y eliminación (`REVOKED`); renombre de organización; `organization.deleted`.
- [ ] Job `ACCESS_RECONCILIATION` horario, single-flight, auto-reprogramado y sembrado al arrancar; ciclo de vida de la organización (desaparece/App desinstalada/sin owners) y reaparición.
- [ ] Pruebas por evento y `action`, duplicados/fuera de orden, firma alterada, reconciliación y caída de GitHub.

## Cierre

- [ ] Lint, test y build; e2e de la matriz; revisión independiente y `contract-reviewer`.
- [ ] `CONTRACT_SYNC` a Console con las rutas, DTOs y errores nuevos.
- [ ] Registrar la evidencia de las precondiciones de despliegue de `DEC-ORG-001` (GitHub App pública con `Members: read` y eventos, validación contra una organización real, correo deshabilitado en Supabase) como criterio de aceptación, sin bloquear el merge.
