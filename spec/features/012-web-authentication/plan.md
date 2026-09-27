# 012-web-authentication — Plan

## Dependencias

- `DEC-WEB-AUTH-001`, `DEC-ORG-001`, Supabase Auth e `INTEROP-2.5` (§3, §6.6 y §6.13).
- Todas las features que consultan recursos descendientes de `Project`.

## Diseño técnico

- Implementar un guard global de usuario y verificación configurable por issuer/audience. Preferir JWKS cacheable cuando el proyecto use signing keys asimétricas; si conserva la clave simétrica legacy, validar el token contra Supabase Auth desde servidor. No implementar criptografía JWT manualmente; excluir solo health y preflight.
- Agregar `ownerUserId` UUID a `Project`, indexado y obligatorio para datos live. La migración de datos existentes debe exigir una asignación explícita o limitar los registros sin propietario al modo local; no se adjudican silenciosamente a una cuenta.
- Cambiar repositorios/servicios para recibir la identidad autenticada y aplicar el predicado `accessibleProject` desde la consulta: Project personal visible solo a su creador; Project organizacional visible solo con membresía y rol vigentes según `014-organizations-access`.
- Propagar la autorización a evidencia de Runs, contexto, historial, retry, experimentos y suscripciones WebSocket; no existe una descarga agrupada legacy para el usuario.
- Usar GitHub OAuth para identidad y, mediante provider token efímero, discovery/verificación de repositorio nuevo; el binding se autoriza con la GitHub App, sin callbacks de instalación. En la topología directa, Console envía el token a GitHub Integration y no lo incluye en el callback a Core. La ruta Core heredada de discovery lo recibe y reenvía temporalmente a Integration hasta retirar esa compatibilidad en un corte separado. La frontera y autorización síncrona se especifican en `016-github-integration` / `WI-CORE-003`.
- Preservar deep-link `returnTo` tras login para rutas de AnalysisRun/Focus Mode.
- Exponer errores `AUTH_REQUIRED` e `INVALID_ACCESS_TOKEN` mediante el envelope estándar, sin incluir claims o token.

## Validación

- Casos sin token, token inválido/expirado y usuario propietario.
- Matriz e2e de acceso cruzado sobre proyecto y cada recurso descendiente, esperando `404` sin filtración.
- Pruebas de WebSocket, acceso a evidencia de Runs y bypass rechazado en producción.
- `lint`, `test`, `build` y SDD check antes de cierre.
