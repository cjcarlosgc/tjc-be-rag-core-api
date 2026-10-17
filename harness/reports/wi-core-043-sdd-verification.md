# WI-CORE-043 — Verificación SDD

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## Fuente y alcance

- WI local: `WI-CORE-043`; historia aplicable: `HU11`; subtarea: `ST-CORE-050`.
- Fuente canónica: `spec/contracts/system-contract.md` en Core. El cambio decide el destino y controles de infraestructura del Sandbox; no cambia API, DTOs ni el comportamiento de `app/`.
- Se conserva `sddVersion: 3.0` para Core/Console y `planningBaseline: 2026-09-24-core-console-transition`. Sandbox permanece en SDD 2.1; una sincronización del contrato SYSTEM no es homologación global.

## Gate de decisiones

- `DEC-INF-001`: resuelta como APROBADO en SYSTEM-2.9. Se reutiliza la VM GCE existente y quedan expresamente fijados costo, control de ingreso, alcance de datos y retención.
- `DEC-VAL-001`: continúa PENDING. Su alcance bloqueante es código/evidencia empresarial; este WI se limita a repositorios controlados de piloto, así que no bloquea este corte.
- `blockingDecisionIds: []`; `nonBlockingDecisionIds: [DEC-VAL-001]`.

## Contract Sync

Checkpoint `start` ejecutado el `2026-10-12T08:13:44Z` con `node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-043 --record`: `relevantPendingSyncIds: []`. La acción afecta el espejo SYSTEM de Console y el contrato/decisión aplicable de Sandbox; deben recibir evento Contract Sync namespaced y generar sus WIs locales. El ACK del consumidor no se considerará implementación.

## Reconciliación del destino y estado de despliegue

- El usuario confirmó el 2026-10-12 que el repositorio ya está clonado en `rag-test-execution-sandbox` y que hubo un primer despliegue con fallas antes de las correcciones recientes. El SHA/versión desplegada no está verificado; no inferir que los fixes ya llegaron.
- Consulta de solo lectura a GCE a las 08:19 UTC: VM `RUNNING`, `e2-standard-4`, disco 100 GB, IP externa, OS Login/2FA, tags HTTP/HTTPS y snapshots diarios/14 días con conservación al borrar el disco.
- El firewall aún admite ingreso público SSH, RDP, HTTP, HTTPS e ICMP desde `0.0.0.0/0`; no existe regla IAP. El servicio Sandbox usa TCP 3000 por defecto (`app/src/main.ts` del repo Sandbox), aunque el `PORT` efectivo del despliegue debe confirmarse. Por ello, la decisión está resuelta pero no satisfecha operacionalmente.
- La línea base SDD de Sandbox sigue en 2.1. Console mantiene SYSTEM-2.8 hasta que importe/atienda `CS-CORE-20261012-001`; no afirmar sincronización completada antes del evento y su WI consumidor.

## Resultado del gate

La decisión queda registrada como cambio documental canónico. No se autoriza ni se ejecuta una mutación GCE, despliegue, firewall, parada/arranque, modificación de disco o política de snapshots. La siguiente prueba remota queda condicionada a aplicar y verificar el ingreso IAP-only, identificar el commit previamente desplegado y actualizar a la revisión corregida bajo autorización operativa explícita. No se infiere una línea base SDD común.
