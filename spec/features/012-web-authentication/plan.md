# 012-web-authentication — Plan

## Dependencias

- `DEC-WEB-AUTH-001`, Supabase Auth y `INTEROP-2.0` sección 3.
- Todas las features que consultan recursos descendientes de `Project`.

## Diseño técnico

- Implementar un guard global de usuario y verificación configurable por issuer/audience. Preferir JWKS cacheable cuando el proyecto use signing keys asimétricas; si conserva la clave simétrica legacy, validar el token contra Supabase Auth desde servidor. No implementar criptografía JWT manualmente; excluir solo health y preflight.
- Agregar `ownerUserId` UUID a `Project`, indexado y obligatorio para datos live. La migración de datos existentes debe exigir una asignación explícita o limitar los registros sin propietario al modo local; no se adjudican silenciosamente a una cuenta.
- Cambiar repositorios/servicios para recibir `userId` y filtrar por propietario desde la consulta, no después de cargar el recurso.
- Propagar la autorización a descargas, contexto, historial, retry, experimentos y suscripciones WebSocket.
- Mantener GitHub OAuth limitado a login; repository binding y callbacks de instalación pertenecen a GitHub Integration y se autorizan además por Project.
- Preservar deep-link `returnTo` tras login para rutas de AnalysisRun/Focus Mode.
- Exponer errores `AUTH_REQUIRED` e `INVALID_ACCESS_TOKEN` mediante el envelope estándar, sin incluir claims o token.

## Validación

- Casos sin token, token inválido/expirado y usuario propietario.
- Matriz e2e de acceso cruzado sobre proyecto y cada recurso descendiente, esperando `404` sin filtración.
- Pruebas de WebSocket, descargas y bypass rechazado en producción.
- `lint`, `test`, `build` y SDD check antes de cierre.
