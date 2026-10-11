# WI-CORE-039 — Aprobación de alcance

Fecha: 2026-10-11

El usuario aprobó iniciar el alcance recomendado para `WI-CORE-039` con el mensaje «si», en respuesta a la solicitud de aprobar la regla contractual completa.

## Alcance aprobado

- Publicar el código neutral `422 GITHUB_CHECK_CREATE_REJECTED`, con `retryable: false`, mensaje neutral y sin cuerpo crudo de GitHub.
- Persistir `CREATE_REJECTED` únicamente cuando GitHub devuelve una respuesta HTTP 422 inequívoca y una reconciliación completa/paginada de la identidad exacta (repositorio, App, SHA y nombre) confirma cero candidatos.
- Si la reconciliación encuentra un candidato, adoptarlo/actualizarlo por su `checkId`; si encuentra varios, conservar la respuesta de ambigüedad; si es incompleta o no verificable, conservar `CREATE_UNKNOWN`/`RECONCILIATION_REQUIRED`, no enviar otro POST y responder con el error reintentable de coordinación.
- El replay de la misma huella de un rechazo confirmado devuelve el 422 terminal sin POST; un request corregido requiere huella distinta, reconciliación completa en cero y transición durable serializada antes de crear.
- Actualizar solo los contratos canónicos y documentación/Harness de Core, resolver el Contract Sync entrante y publicar un nuevo Contract Sync dirigido a GitHub Integration.

No incluye cambios en `app/`, otro repositorio, infraestructura, despliegue, provisión o cutover.
