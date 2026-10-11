[leader] · WI-CORE-038 · Cierre

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## Resultado

`WI-CORE-038` queda `W-DONE`. Core registra `DEC-CHECK-002` y publica `GH-INTEROP-1.5`: PostgreSQL administrado, dedicado y propiedad de GitHub Integration es el mecanismo de coordinación compartida entre réplicas; no es persistencia de dominio Core ni se limita el servicio a una réplica. La garantía es una reserva única y no repetir automáticamente una creación cuyo resultado remoto sea incierto; no se promete exactly-once.

El POST exitoso y su DTO se conservan. El contrato incluye coordinación de mutaciones y updates, `CREATE_UNKNOWN`/`UPDATE_UNKNOWN`, reconciliación, fallos cerrados, resolución operativa auditada, retención, migración aditiva y cutover. Core no implementa la base ni el código de GitHub Integration.

## Revisión y gates

- SDD: `SPEC_VERIFIED`; revisión contractual: `APPROVED`.
- Revisión independiente: `APPROVED`, sin findings ni blockers; evidencia en `wi-core-038-independent-review.md`, perfil reviewer distinto del implementer.
- Ciclos de revisión: `0/2`.
- Implementación documental y checks Harness: PASS.
- Contract Sync `start`, `implementation-delivery`, `before-review` y `before-done`: registrados en orden; cero eventos entrantes relevantes pendientes al cierre. Los eventos históricos excluidos tienen revisión de alcance propia.
- `CS-CORE-20261011-004` está publicado en el outbox como `C-PENDING` para Console y GitHub Integration. Esa transición demuestra publicación, no importación, ACK/resolución o implementación de los consumidores.

## Verificación

- `node harness/validate-harness.mjs` — PASS.
- `node harness/validate-work-items.mjs` — PASS (38 WI).
- `node --test harness/*.test.mjs` — PASS (29/29).
- `git diff --check` — PASS.
- `git fetch origin develop` + `git merge-base --is-ancestor origin/develop feature/jean` — PASS; la rama `feature/jean` contiene el `origin/develop` actualizado en la verificación.
- Lint/build de producto no aplican: no se modificó `app/`.

## Estado de los consumidores

Console debe importar y validar los tres espejos por su WI local. GitHub Integration debe actualizar el WI-GH-012 existente, su excepción de stack para esta sola base técnica, y entregar esquema, coordinación entre dos o más instancias, pruebas, migración y operación según el evento. Esos trabajos, espejos, configuración externa, despliegue y cutover siguen pendientes en los componentes dueños y no se infieren desde el cierre de Core.
