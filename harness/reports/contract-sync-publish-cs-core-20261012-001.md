# WI-CORE-043 — Publicación Contract Sync

Fecha: 2026-10-12

- Evento: `CS-CORE-20261012-001`
- Work item productor: `WI-CORE-043`
- Targets: `console`, `sandbox`
- Scope: `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`
- Breaking: `false` (no cambia DTO, endpoint ni comportamiento HTTP)
- Source revision: `76053463e1b073364861d417bc9c2217dccd11a2`
- Outbox: `harness/contract-sync/outbox/CS-CORE-20261012-001.yaml`

El evento comunica la resolución de DEC-INF-001 y el estado informativo de INTEROP-2.8. Distingue el reporte del usuario sobre el clon/despliegue previo de la evidencia no disponible sobre el SHA desplegado. Console solo debe sincronizar contratos y registrar su WI local, sin cambios UI. Sandbox debe atender la decisión aplicable con su Harness SDD 2.1 y preservar `SYSTEM-2.2`/la línea base local; el ACK no es implementación. El evento no autoriza firewall, despliegue ni otra operación GCE.

La publicación quedó acreditada en el outbox; las importaciones se registran debajo y aún no equivalen a resolución por los consumidores.

## Importación observada

- Console: importación dirigida de este único evento con su Harness V3; salida `imported: 1`. El inbox conserva `C-PENDING` y metadata local `consumerImportedAt`.
- Sandbox: importación con su Harness V2 mediante una proyección JSON compatible, persistida en el inbox del consumidor. La proyección conserva ID, `sourceWorkItem`, `scopePaths`, `sourceRevision`, `breaking` y `sourceStatus: C-PENDING`; adapta el estado a `PENDING`, reduce `targets` a `sandbox` y mapea el área local a `executions` porque el Harness V2 solo reconoce sus áreas históricas. El inbox permanece `PENDING`; no se cambió el espejo SYSTEM-2.2 ni la línea base SDD 2.1.

Ambos consumidores aún deben seleccionar y atender su WI local. Ningún evento se ACK o RESOLVED por esta importación; el WI-CORE-043 continúa abierto.
