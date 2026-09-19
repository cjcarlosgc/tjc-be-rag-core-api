# errors — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Unificar errores HTTP y distinguir fallos de plataforma de resultados inválidos.

## Reglas y comportamiento

- Todo error HTTP sigue `ErrorEnvelope` de `spec/contracts/interoperability-contract.md` y conserva `x-correlation-id`.
- DTOs de entrada usan validación whitelist y rechazan campos desconocidos.
- Errores de dominio se traducen centralmente; controllers no construyen envelopes manualmente.
- Un resultado de test inválido o un fallo posterior a aceptar una operación asíncrona se persiste como resultado, no se convierte automáticamente en HTTP 5xx.
- La ausencia o formato inválido del header se normaliza como `400 IDEMPOTENCY_KEY_REQUIRED`/`400 INVALID_IDEMPOTENCY_KEY`; key válida reutilizada con otro request produce `409 IDEMPOTENCY_CONFLICT`.
- En Sandbox, `requestId` distinto de `Idempotency-Key` produce `400 IDEMPOTENCY_KEY_MISMATCH`; Bearer ausente o inválido produce `401/403` sin revelar el token.
- En navegador→Core, credencial ausente produce `401 AUTH_REQUIRED` y token inválido/expirado `401 INVALID_ACCESS_TOKEN`; los recursos ajenos usan el mismo `404` que los inexistentes.
- Las trazas usan `404 CONTEXT_TRACE_NOT_FOUND` y `409 CONTEXT_TRACE_NOT_FINISHED`.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
