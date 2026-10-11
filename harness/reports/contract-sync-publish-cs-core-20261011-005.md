# WI-CORE-039 — Publicación Contract Sync

Modelo: leader · configurado `gpt-6-luna` · atendido `unknown` · esfuerzo `xhigh`

Se publicó `CS-CORE-20261011-005` desde Core, con `sourceWorkItem: WI-CORE-039`, dirigido a `console` y `github-integration`, estado de productor `C-PENDING`.

- Revisión fuente: `4246685534bfdbb2de631c526cebce6ebb51ac99` (`docs(checks): define confirmed create rejection`).
- Alcance: `spec/contracts/system-contract.md` y `spec/contracts/github-integration-contract.md`.
- SHA-256 de SYSTEM: `4d14f5b2204287bdff88060a51578cc97443e93b34a729059a5427cff67b3f5d`.
- SHA-256 de GH: `dd02c32f89efc463c06165ce9ead785b8afeee782e464c4e6f7b1d4a532a167e`.
- Console debe importar y comprobar los espejos byte por byte; el evento no exige cambio de UI/API/DTO.
- GitHub Integration debe reflejar los contratos en su WI-GH-012 existente e implementar/probar el rechazo HTTP 422 confirmado, reconciliación, replay y serialización según GH-INTEROP-1.6.
- La publicación no importa ni modifica inboxes externos y no afirma ACK, resolución, implementación, infraestructura, despliegue o cutover.

**Evidencia:** `harness/contract-sync/outbox/CS-CORE-20261011-005.yaml`, hashes de los archivos fuente y commit de origen arriba indicado.
