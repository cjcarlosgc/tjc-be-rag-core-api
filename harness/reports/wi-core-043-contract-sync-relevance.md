# WI-CORE-043 — Alcance de eventos Contract Sync preexistentes

Fecha: 2026-10-12
Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## Disposición local para este WI

- `CS-20260920-001` (`source: console`, sin `scopePaths`) es un evento global histórico previo a `planningBaseline: 2026-09-24-core-console-transition`. Su contenido trata binding de repositorios, rutas de Projects y acceso/soft-delete; WI-CORE-043 decide topología, red, costo y retención del Sandbox GCE. No modifica ni depende de esos comportamientos.
- `CS-20260921-003` (`source: console`, sin `scopePaths`) es un evento global histórico previo al mismo baseline. Su contenido trata login GitHub/Supabase y orden de despliegue de identidad/workspaces; WI-CORE-043 no cambia autenticación ni despliega Core/Console.
- Ambos eventos conservan su estado y sus acciones pendientes para los WIs/componentes que les correspondan. `NOT_RELEVANT` se registra solo para la puerta de WI-CORE-043, no como cierre ni rechazo global.
- `CS-GH-20261011-003` no se excluye: aunque su scope explícito es `github-integration-contract.md`, el Harness trata eventos de contrato como relevantes a un WI con `contractImpact=true`; su acción de corregir la procedencia ya fue ejecutada y se registrará con su propio reporte de resolución.

## Digests de payload estable

- `CS-20260920-001`: `e5caa28faa910640306afc1f83fdc74a46310fdb4b5489a4ac5af88c1f034c6b`
- `CS-20260921-003`: `db3dd16b293d50820bea71cf17b53968164dc59fde3d7d7e7c397b50d2b86ac0`

No se modifican los eventos importados.
