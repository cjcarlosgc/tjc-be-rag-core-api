# 012-web-authentication — Especificación

**Estado:** aprobado; correo/contraseña implementado en Core; GitHub OAuth habilita identidad y discovery user-centric sin autorizar repositorios.
**Historia:** HU29
**Decisión:** `DEC-WEB-AUTH-001` APROBADO

## Objetivo

Establecer `PlatformUser` mediante Supabase Auth para todos los flujos de Console y autorizar recursos por Project, manteniendo el login independiente de la GitHub App.

## Reglas y comportamiento

- Supabase Auth admite únicamente correo/contraseña y `Continue with GitHub`; Google OAuth queda fuera de alcance. RAG Core acepta el access token únicamente como `Authorization: Bearer` y valida firma, issuer, audience y expiración.
- `GET /health` permanece público. Todos los endpoints de proyectos, versiones, inventario, runs, artefactos, experimentos, trazas y los handshakes WebSocket requieren identidad válida.
- Al crear un `Project`, Core persiste como propietario el `sub` validado del token. Todo recurso descendiente se autoriza recorriendo esa propiedad.
- Un recurso inexistente o perteneciente a otro usuario produce el mismo `404` para evitar enumeración. `401` se reserva para credencial ausente, inválida o expirada.
- Los tokens de usuario no se persisten, no se registran y nunca llegan a Storage, Sandbox o containers.
- La política de provisión puede ser por invitación o solicitud de acceso empresarial. HU29 no aprueba auto-registro público, roles múltiples, organizaciones ni proyectos compartidos.
- Un bypass solo puede existir bajo configuración explícita de desarrollo no productivo y datos mock/locales. La aplicación debe negarse a arrancar en producción si ese bypass está activo.
- GitHub OAuth es proveedor de identidad de Supabase Auth y, cuando la sesión expone un provider token, permite listar los repositorios visibles al usuario para iniciar un binding. Ese token viaja únicamente en `X-GitHub-Provider-Token`, no se persiste ni registra, y jamás se usa para snapshots, AnalysisRun, Checks, ramas o companion PR.
- Para una sesión de correo/contraseña, la Console puede usar el linking oficial de Supabase Auth para añadir GitHub con scope `repo`; no crea otro `PlatformUser`. El Core no implementa linking propio ni recibe credenciales GitHub fuera del header de discovery.
- Discovery no concede repository binding ni sustituye la autorización de la GitHub App. Core resuelve la instalación y opera ramas/automatización exclusivamente con credenciales de la App.
- `PlatformUser`, `GitHubInstallation`, `GitHubRepository` y `GitHubActor` son independientes. No se implementa linking propio por coincidencia de correo; se aceptan únicamente las garantías nativas de Supabase Auth para identidades verificadas.
- Los deep links de Runs/Focus Mode preservan `returnTo` durante login y no redirigen al home genérico.

## Fuera de alcance

- Linking custom de cuentas por correo, persistencia de tokens del proveedor GitHub o automatización con OAuth de usuario.
- SSO empresarial distinto de Supabase Auth, RBAC, workspaces compartidos y administración de organizaciones.
- Resolver por sí sola las condiciones restantes de `DEC-VAL-001`.
