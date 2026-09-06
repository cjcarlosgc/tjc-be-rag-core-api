# async-jobs — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Garantizar que indexaciones y generaciones sobrevivan al ciclo HTTP y reinicios razonables.

## Reglas y comportamiento

- Indexación, generación, experimento y validación sobreviven al request HTTP mediante la cola DB-backed aprobada.
- Toda aceptación devuelve `202`, identidad estable y `pollAfterMs` según `INTEROP-1.0`.
- Los handlers son idempotentes frente a reintentos y los estados terminales permanecen consultables.
- Los resultados detallados se consultan por una ruta separada y antes de terminar responden `409 *_NOT_FINISHED`.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
