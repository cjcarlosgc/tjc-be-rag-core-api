# errors — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Unificar errores HTTP y distinguir fallos de plataforma de resultados inválidos.

## Reglas y comportamiento

- Todo error HTTP sigue `ErrorEnvelope` de `spec/contracts/interoperability-contract.md` y conserva `x-correlation-id`.
- DTOs de entrada usan validación whitelist y rechazan campos desconocidos.
- Errores de dominio se traducen centralmente; controllers no construyen envelopes manualmente.
- Una excepción HTTP del framework sin código propio se traduce a un código genérico de `INTEROP-2.18` §4.1 (`DEC-ERR-001`): el estado HTTP se conserva, el `message` es fijo en español y no repite el texto de la excepción, y `retryable` solo aparece en `TOO_MANY_REQUESTS` (true) y `SERVICE_UNAVAILABLE` (true). Un código explícito de la aplicación siempre prevalece. El parser de body no cambia.
- Un resultado de test inválido o un fallo posterior a aceptar una operación asíncrona se persiste como resultado, no se convierte automáticamente en HTTP 5xx.
- La ausencia o formato inválido del header se normaliza como `400 IDEMPOTENCY_KEY_REQUIRED`/`400 INVALID_IDEMPOTENCY_KEY`; key válida reutilizada con otro request produce `409 IDEMPOTENCY_CONFLICT`.
- En Sandbox, `requestId` distinto de `Idempotency-Key` produce `400 IDEMPOTENCY_KEY_MISMATCH`; Bearer ausente o inválido produce `401/403` sin revelar el token.
- En navegador→Core, credencial ausente produce `401 AUTH_REQUIRED` y token inválido/expirado `401 INVALID_ACCESS_TOKEN`; los recursos ajenos usan el mismo `404` que los inexistentes.
- Las trazas usan `404 CONTEXT_TRACE_NOT_FOUND` y `409 CONTEXT_TRACE_NOT_FINISHED`.
- El binding usa `409 REPOSITORY_BINDING_ALREADY_EXISTS` (el Project ya tiene uno) y `409 REPOSITORY_ALREADY_BOUND` (otro Project usa el repositorio, con mensaje genérico que no revela al otro Project ni usuario). Una violación de unicidad de base de datos se mapea a estos `409`, nunca a `500`. Un Project borrado lógicamente responde igual que uno inexistente (`404 PROJECT_NOT_FOUND`).
- Acceso por rol (`INTEROP-2.6` §6.13, soporte de HU01/HU02): un recurso no visible conserva su `404` y uno visible con rol insuficiente es `403 PROJECT_ROLE_INSUFFICIENT` (`details: { requiredRole, currentRole }`). Códigos: `GITHUB_IDENTITY_REQUIRED` (401), `IDENTITY_UNAVAILABLE` (503), `WORKSPACE_NOT_FOUND` (404), `WORKSPACE_ADMIN_REQUIRED` (403), `REPOSITORY_OUTSIDE_WORKSPACE` (400), `REPOSITORY_PERMISSION_INSUFFICIENT` (403) y `GITHUB_VERIFICATION_UNAVAILABLE` (503). Una caída de GitHub al verificar un acceso nuevo es `503`, nunca `404` ni `500`; los accesos ya registrados no se revocan por un error de red.

## Decisiones

### DEC-ERR-001 — Códigos genéricos de error HTTP sin código propio

**Estado:** PROPOSED (registrada en WI-CORE-073 con el alcance aprobado por el usuario el 2026-10-19; pendiente de aprobación formal de la decisión)

**Blocks:** NONE. No bloquea WI-CORE-073 ni WI-CORE-074.

**Propuesta:** adoptar como norma los códigos genéricos de `INTEROP-2.18` §4.1: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `METHOD_NOT_ALLOWED` 405, `NOT_ACCEPTABLE` 406, `CONFLICT` 409, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `UNPROCESSABLE_ENTITY` 422, `TOO_MANY_REQUESTS` 429 y `SERVICE_UNAVAILABLE` 503; `HTTP_ERROR` para otro 4xx; `INTERNAL_ERROR` para 5xx sin código distinto de 503. Nombres alineados con Test Execution Sandbox, mensaje fijo en español, `retryable` solo en los genéricos, código explícito de la aplicación con precedencia y parser de body sin cambio.

**Trazabilidad:** Anexo E de la tesis (criterios C-01 a C-10), citado solo por referencia; su texto no se transcribe en este repositorio.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
