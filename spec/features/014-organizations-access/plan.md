# 014 — Plan

## Dependencias

- SYSTEM-2.4 e INTEROP-2.4 (§6.1, §6.8, §6.9, §6.13); `DEC-ORG-001` APROBADO; `DEC-ORG-002` PROPOSED (bloquea los cortes 3 y 4).
- `012-web-authentication` (guard global, `CurrentUserId`), `013-pr-driven-analysis` (bindings, ingress de webhooks, `REPOSITORY_ALREADY_BOUND`, borrado lógico, job handlers) y la cola `jobs` existente.
- `SUPABASE_URL` y `SUPABASE_SECRET_KEY` ya existen en la configuración de Core y bastan para la Admin API; ambos son de servidor.

## Diseño técnico

- **Puertos con fakes en tests** (tokens de inyección; GitHub y Supabase reales solo en adapters productivos):
  - `SupabaseIdentityPort.getGithubIdentity(sub) -> { githubUserId, login? } | null` (`GET /auth/v1/admin/users/{sub}`, `identities[]` con `provider: 'github'`).
  - `GithubAccessPort`, con el installation token de la App: `listOrganizationInstallations()`, `getOrganizationMembership(orgId, githubUserId) -> { role, state } | null`, `listOrganizationOwners(orgId)`, `getRepositoryPermission(repositoryId, githubUserId) -> roleName | null`, `getRepositoryOwner(repositoryId)`, y un resultado explícito `UNVERIFIABLE` (red, `5xx`, límite de tasa, instalación suspendida, `Members: read` ausente) distinto de `null` ("GitHub confirma que no hay acceso"). La distinción confirmado/no verificable es la base de "conservar lo existente, negar lo nuevo".
  - `GET /repos/{owner}/{repo}/collaborators/{username}/permission` se consulta por `login`: Core resuelve el login desde el `githubUserId` (`GET /user/{id}`) y no confía en el `githubLogin` guardado, que solo es presentación; si el permiso responde `404` con un login cacheado, se reintenta una vez con el login recién resuelto. Esta lectura y la de `Members: read` son criterios de aceptación contra GitHub real (`DEC-ORG-001`, precondición 2).
- **Predicado de acceso:** `accessibleProject(userId, minRole)` sustituye a `ownedProject()` (ver `persistence`); `ProjectAccessService.require(userId, projectId, minRole)` cubre el borde de cada petición: registro suficiente -> continúa; registro insuficiente -> `403`; sin registro -> verificación viva y alta, o `404`/`503`. Toda ruta con `projectId` o con un recurso descendiente pasa por él. Se recomienda que controllers/servicios declaren el rol mínimo mediante un decorador (`@RequireProjectRole('MAINTAINER')`) que refleje la matriz de INTEROP §6.13.
- **Webhooks:** el ingress (`github-webhooks.service.ts`) enruta `member`, `membership`, `organization`, `team` y `repository` a un manejador de acceso que solo encola un job `ACCESS_REVERIFY` con el alcance seleccionado (`userId`/`githubUserId`, `repositoryId` u `organizationId`) y responde `202`. Los eventos de acceso no dependen de `binding.status`. `installation`/`installation_repositories` se amplían para borrar registros según INTEROP §6.9. Los eventos que no producen trabajo no persisten `WebhookDelivery` (como hoy `installation`) porque reverificar es idempotente.
- **Reconciliación:** job `ACCESS_RECONCILIATION` sobre `jobs`, sin `Idempotency-Key` (es interno), single-flight (un solo job pendiente, deduplicado por tipo) y auto-reprogramado a `now + 1 h` al terminar, incluso si falla; se siembra al arrancar la aplicación si no existe. Reutiliza la lógica de verificación del alta.
- **WebSocket:** `RealtimeGateway` verifica rol Reader al unir una sala; al borrarse un registro de acceso, un evento interno saca los sockets de ese usuario de las salas del Project.
- **Migraciones Prisma** (una por corte, sin backfill: la base está vacía): `user_github_identities` (corte 1); `projects.githubOrgId/githubOrgLogin` + check (corte 2); `project_access` + enum `ProjectRole` (corte 3).
- **Escala:** listar instalaciones de la App y verificar la membresía por organización es aceptable a escala de tesis; no se agrega caché de permisos. Si la latencia de `GET /workspaces` se vuelve un problema con la App pública, se evalúa una caché corta solo de la lista de instalaciones (nunca de accesos) en una decisión aparte.

## Cortes de implementación

1. **HU62 + identidad.** `SupabaseIdentityPort`, tabla `user_github_identities`, resolución perezosa del `githubUserId` tras validar el JWT, `401 GITHUB_IDENTITY_REQUIRED` y `503 IDENTITY_UNAVAILABLE`. Sin cambio de rutas. Actualiza `012-web-authentication`.
2. **HU63 + HU58.** `GET /workspaces`, `workspaceId` en `POST /projects`, `GET /projects` y `GET /integrations/github/repositories`, `PATCH /projects/{id}`, `workspace` y `role` en `ProjectResponse`, columnas de organización. Interino hasta el corte 3: el predicado sigue siendo el creador (`ownerUserId`) y `role` es `ADMIN`; `POST /projects` en una organización ya verifica en vivo que el usuario es owner. Nada de esto comparte Projects todavía.
3. **HU59 + HU60.** `project_access`, `accessibleProject`, `ProjectAccessService`, alta al entrar, roles Admin/Maintainer/Reader, `403 PROJECT_ROLE_INSUFFICIENT` en toda la matriz, listados omitiendo lo no verificable, `503 GITHUB_VERIFICATION_UNAVAILABLE`, WebSocket. Migra todos los repositorios que usan `ownedProject`. Depende de `DEC-ORG-002.1`, `.2` y `.3`.
4. **HU64.** Filtro por workspace en el discovery, `REPOSITORY_OUTSIDE_WORKSPACE`, `REPOSITORY_PERMISSION_INSUFFICIENT`, orden de validación de `POST .../integrations/github` y, si se aprueba, permiso mínimo en `verify-app-access`/`branches` (`DEC-ORG-002.4`).
5. **HU61.** Eventos de acceso en el ingress, `ACCESS_REVERIFY`, ajustes de `installation`/`installation_repositories`, reconciliación horaria, renombre/transferencia/eliminación de repositorio, ciclo de vida de la organización.

## Dependencias entre cortes y trabajo en paralelo

```text
1 ──> 2 ──> 3 ──┬──> 4
                └──> 5
```

- 2 depende de 1 (necesita `githubUserId` para el workspace personal y la verificación de owner); 3 depende de 2 (columnas de organización y `role` de `ProjectResponse`); 4 y 5 dependen de 3 (`GithubAccessPort` verificado y `project_access`) y son independientes entre sí.
- Dos desarrolladores pueden trabajar en paralelo así: tras el corte 1, A implementa el corte 2 mientras B construye el `GithubAccessPort` (puerto, fake y adapter HTTP, sin esquema) que necesitan 2 (verificación de owner) y 3; tras el corte 3, A toma el 4 y B el 5. Los cortes 4 y 5 solo comparten el servicio de verificación del corte 3 y no tocan los mismos archivos salvo `github-webhooks.service.ts` (5) y `repository-bindings.service.ts` (4); el conflicto de esquema Prisma se evita porque cada corte tiene su propia migración.
- Publicación: 1 y 2 pueden publicarse solos (no comparten Projects). 3, 4 y 5 se publican juntos, porque conceder acceso sin poder revocarlo por evento no es aceptable.

## Verificación

- **Fakes del puerto GitHub y de Supabase** en tests unitarios e integración; ningún test llama a GitHub o Supabase reales. Cada fake permite fijar por usuario/organización/repositorio: rol de organización, permiso (`role_name`, incluido personalizado), membresía `pending`, repositorio público/privado, y el resultado `UNVERIFIABLE`.
- **Corte 1:** identidad presente, ausente (`401`), `user_metadata` manipulado ignorado, Admin API caída con y sin vínculo persistido.
- **Corte 2:** workspaces (solo personal, con organizaciones, organización sin `Members: read`, GitHub caído), creación en organización como owner/miembro/no miembro, `PATCH` (nombre válido, vacío, campo extra, no visible), `DELETE` solo Admin.
- **Corte 3:** matriz e2e completa de INTEROP §6.13 por cada ruta y cada rol (`404` sin visibilidad, `403` con rol insuficiente, `2xx` con el mínimo), jerarquía, alta al entrar por deep link, Project sin repositorio visible solo a Admin, binding `REVOKED`, repositorio público (`DEC-ORG-002.1`), listado sin filtro con Projects personales compartidos (`DEC-ORG-002.2`), GitHub caído (accesos existentes vigentes, nuevos `503`), WebSocket con y sin rol.
- **Corte 4:** filtro por workspace, orden de validación completo de `POST .../integrations/github`, sin sondeo de repositorios ajenos (`REPOSITORY_ALREADY_BOUND` solo tras las validaciones de propietario y permiso), no revinculación.
- **Corte 5:** por evento (`member`, `membership`, `organization`, `team`, `repository`) y `action`, deduplicación, orden inverso y duplicados, firma alterada, evento no listado ignorado con `202`; reconciliación: rol cambiado, acceso perdido, GitHub caído (no revoca), reprogramación tras fallo, organización desaparecida/App desinstalada/sin owners y reaparición.
- **Regresión:** los tests actuales de `013` (bindings, borrado lógico, job handlers) siguen en verde con el predicado nuevo; fixtures compartidos por copia para los contract tests de INTEROP-2.4.
- **Criterios de aceptación de despliegue (no bloquean implementar):** validación contra una organización real de las lecturas no probadas (rol de owner, permiso heredado por Team o base, membresía `pending`, `GET /user/{id}` y colaborador con `Metadata: read`), App pública con `Members: read` y los eventos suscritos, y correo/contraseña deshabilitado en Supabase.
- Lint, unit, integración, e2e, build y revisión consolidada antes de cada push.
