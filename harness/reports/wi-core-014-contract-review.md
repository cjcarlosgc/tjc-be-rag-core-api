# Revisión contractual — WI-CORE-014

**Fecha:** 2026-09-27 16:30 America/Lima
**Contrato:** `GH-INTEROP-1.2`
**Resultado:** APPROVED después de resolver los hallazgos de forma.

## Puntos revisados

- El webhook incluye siempre `pullRequest.createdAt`: timestamp original validado como ISO-8601 UTC o `null`. La falta/invalidez de `created_at` no se trata como payload malformado ni rechaza la entrega.
- `receivedAt` es independiente y nunca sustituye el instante de creación del PR.
- `pull-request-head` conserva `NOT_FOUND` y `NOT_INSTALLED`; `OK` incluye `createdAt` verificable y una fecha no verificable devuelve `UNVERIFIABLE` sin respuesta parcial.
- Core mantiene ocultos los Runs afectados y programa recuperación durable hasta tener una fecha verificable; no recibe body crudo.
- El cambio está acotado a `GH-INTEROP-1.2`. No cambia `SYSTEM-2.5`, `INTEROP-2.6`, rutas públicas, UI, Sandbox ni configuración externa.
- Core sigue siendo autoridad canónica. El evento saliente solicita sincronizar el archivo contractual completo; GH-007 comunica la entrega implementada en un evento posterior. Core-014 no depende de que Console-008 termine, evitando un ciclo con Core-011.

La revisión previa identificó la regla de aceptación del webhook, el resultado histórico `UNVERIFIABLE`, la sincronización exacta de espejos y el orden de dependencias como puntos necesarios. Todos quedaron expresos en el contrato y la planificación. No quedan hallazgos contractuales abiertos para este corte.
