# WI-CORE-009 — Verificación SDD

**Estado:** APPROVED por `sdd-analyst` tras resolver los hallazgos del primer análisis.
**Aprobación de alcance:** solicitada implícitamente por el usuario al indicar que empiece la implementación del trabajo Harness.
**Alcance:** gate local de dependencias externas y ciclo de vida Contract Sync en Core; sin cambio al contrato de producto.

## Hallazgos resueltos

- El gate utiliza los estados ya definidos `G-NOT_RUN`, `G-PASSED` y `G-FAILED`, y bloquea la transición de un WI consumidor a `W-READY` hasta `G-PASSED`.
- El pre-requisito de un consumidor requiere que los WIs fuente estén `W-DONE` y todos los eventos de salida estén importados y `C-ACKNOWLEDGED` o `C-RESOLVED`. `C-ACKNOWLEDGED` acepta la obligación y permite empezar; no finge que el consumidor ya la implementó.
- `C-RESOLVED` se exige tras implementar, antes de `implementation-delivery`, `before-review` y `before-done`; así no hay ciclo de “resolver antes de empezar”.
- El reporte enumera exhaustivamente los eventos de cada WI para un SHA completo del repo fuente; el `sourceRevision` de cada evento se verifica por separado del SHA del checkout.
- El import repetido conserva el estado local solo cuando todos los campos fuente salvo lifecycle/metadata local son idénticos. Cambiar el contenido contractual con el mismo ID sigue fallando.
- La comprobación de estado fuente sigue siendo manual y revisable; el Harness no consulta el repositorio vecino ni declara despliegue/cutover.

## Revisión de alcance y verificaciones

`WI-CORE-009` modifica Harness/SDD Core y se registra en el backlog como `ST-CORE-009`, enlazado a HU02, HU14 y HU16. No hay una decisión `PENDING` que alcance este trabajo. `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs` y `node harness/validate-harness.mjs` pasan; la evidencia completa de implementación y checks está en `harness/reports/wi-core-009-implementation.md`.

La primera revisión pidió cambios sobre el vocabulario de gate y el orden de ACK/RESOLVED; ambos puntos se incorporaron. La segunda revisión aprobó la semántica corregida y confirma que elimina el ciclo sin alterar el significado de ACK.
