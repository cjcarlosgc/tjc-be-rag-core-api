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

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
