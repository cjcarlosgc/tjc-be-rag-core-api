# 012-web-authentication — Especificación

**Estado:** aprobado para implementar.
**Historia:** HU29
**Decisión:** `DEC-WEB-AUTH-001` APROBADO

## Objetivo

Proteger el flujo vigente por ZIP con identidad de usuario y autorización por propietario, sin depender de la integración futura con GitHub.

## Reglas y comportamiento

- Supabase Auth con correo y contraseña establece la sesión del navegador. RAG Core acepta el access token únicamente como `Authorization: Bearer` y valida firma, issuer, audience y expiración.
- `GET /health` permanece público. Todos los endpoints de proyectos, versiones, inventario, runs, artefactos, experimentos, trazas y los handshakes WebSocket requieren identidad válida.
- Al crear un `Project`, Core persiste como propietario el `sub` validado del token. Todo recurso descendiente se autoriza recorriendo esa propiedad.
- Un recurso inexistente o perteneciente a otro usuario produce el mismo `404` para evitar enumeración. `401` se reserva para credencial ausente, inválida o expirada.
- Los tokens de usuario no se persisten, no se registran y nunca llegan a Storage, Sandbox o containers.
- La política de provisión puede ser por invitación o solicitud de acceso empresarial. HU29 no aprueba auto-registro público, roles múltiples, organizaciones ni proyectos compartidos.
- Un bypass solo puede existir bajo configuración explícita de desarrollo no productivo y datos mock/locales. La aplicación debe negarse a arrancar en producción si ese bypass está activo.
- GitHub no forma parte de HU29. `DEC-GH-001` conserva `PENDING` el login GitHub, repositorios y Pull Requests; correo + ZIP es un producto funcional independiente.

## Fuera de alcance

- Vincular una cuenta de correo con una identidad GitHub.
- SSO empresarial distinto de Supabase Auth, RBAC, workspaces compartidos y administración de organizaciones.
- Resolver por sí sola las condiciones restantes de `DEC-VAL-001`.
