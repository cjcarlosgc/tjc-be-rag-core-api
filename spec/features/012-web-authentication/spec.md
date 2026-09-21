# 012-web-authentication — Especificación

**Estado:** aprobado; login solo con GitHub (`DEC-ORG-001`, HU62, 2026-09-20; deshabilitar el correo en Supabase es precondición de despliegue); GitHub OAuth habilita identidad y discovery user-centric sin autorizar repositorios.
**Historia:** HU29
**Decisión:** `DEC-WEB-AUTH-001` APROBADO

## Objetivo

Establecer `PlatformUser` mediante Supabase Auth para todos los flujos de Console y autorizar recursos por Project, manteniendo el login independiente de la GitHub App.

## Reglas y comportamiento

- Supabase Auth admite únicamente `Continue with GitHub`; el correo y la contraseña se retiraron (HU62) y Google OAuth queda fuera de alcance. RAG Core acepta el access token únicamente como `Authorization: Bearer` y valida firma, issuer, audience y expiración.
- `GET /health` permanece público. Todos los endpoints de proyectos, versiones, inventario, runs, artefactos, experimentos, trazas y los handshakes WebSocket requieren identidad válida.
- Al crear un `Project`, Core persiste como creador el `sub` validado del token. Hasta `T-003` todo recurso descendiente se autorizaba recorriendo esa propiedad; con `014-organizations-access` (HU58-HU64) se autoriza por el rol de la persona sobre el Project, derivado de GitHub, y `ownerUserId` queda como dato del creador que no autoriza por sí solo.
- Un recurso inexistente o no visible para el usuario produce el mismo `404` para evitar enumeración; uno visible con rol insuficiente produce `403 PROJECT_ROLE_INSUFFICIENT` (`INTEROP-2.4` §6.13). `401` se reserva para credencial ausente, inválida o expirada.
- Los tokens de usuario no se persisten, no se registran y nunca llegan a Storage, Sandbox o containers.
- La política de provisión puede ser por invitación o solicitud de acceso empresarial. HU29 no aprueba auto-registro público, roles múltiples, organizaciones ni proyectos compartidos; estos últimos los introduce `014-organizations-access` (`DEC-ORG-001`).
- Un bypass solo puede existir bajo configuración explícita de desarrollo no productivo y datos mock/locales. La aplicación debe negarse a arrancar en producción si ese bypass está activo.
- GitHub OAuth es proveedor de identidad de Supabase Auth y, cuando la sesión expone un provider token, permite listar los repositorios visibles al usuario para iniciar un binding. Ese token viaja únicamente en `X-GitHub-Provider-Token`, no se persiste ni registra, y jamás se usa para snapshots, AnalysisRun, Checks, ramas o companion PR.
- Toda sesión tiene identidad GitHub. Core obtiene el `githubUserId` numérico de la Admin API de Supabase (`GET /auth/v1/admin/users/{sub}`, `identities[].id`) y nunca de `user_metadata`, que el usuario puede editar. El Core no implementa linking propio ni recibe credenciales GitHub fuera del header de discovery.
- Discovery no concede repository binding ni sustituye la autorización de la GitHub App. Core resuelve la instalación y opera ramas/automatización exclusivamente con credenciales de la App.
- `PlatformUser`, `GitHubInstallation`, `GitHubRepository` y `GitHubActor` son independientes. No se implementa linking propio por coincidencia de correo; se aceptan únicamente las garantías nativas de Supabase Auth para identidades verificadas.
- Los deep links de Runs/Focus Mode preservan `returnTo` durante login y no redirigen al home genérico.

## Cambio aprobado (HU62)

2026-09-20 (`DEC-ORG-001`): el inicio de sesión con correo y contraseña se retira y solo se autentica con GitHub. Está consolidado arriba; su despliegue exige deshabilitar el proveedor de correo en Supabase Auth y que la Console solo ofrezca GitHub.

## Fuera de alcance

- Linking custom de cuentas por correo, persistencia de tokens del proveedor GitHub o automatización con OAuth de usuario.
- SSO empresarial distinto de Supabase Auth y RBAC propio de Core: los workspaces y los roles Admin/Maintainer/Reader se derivan de GitHub (`014-organizations-access`) y los miembros se administran en GitHub, no en Core.
- Resolver por sí sola las condiciones restantes de `DEC-VAL-001`.
