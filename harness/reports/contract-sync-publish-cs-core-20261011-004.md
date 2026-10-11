[leader] · WI-CORE-038 · Publicación Contract Sync

Modelo: leader · configurado gpt-6-luna · atendido gpt-6-luna · esfuerzo xhigh

**Resultado:** publicado `CS-CORE-20261011-004` para `console` y `github-integration`, estado de productor `C-PENDING`.

- Fuente canónica: commit `0adbede3e89b154dc720115189822333748c1d2a` en `feature/jean`.
- Alcance: `system-contract.md`, `interoperability-contract.md` y `github-integration-contract.md`.
- Console recibe solo la obligación de importar, espejar byte por byte y validar; no necesita cambio de UI/API/DTO.
- GitHub Integration recibe, además del espejo, acciones concretas para incorporar el diseño a su WI-GH-012, actualizar su excepción de tech-stack solo para PostgreSQL técnico propio y completar implementación, migración, pruebas multi-réplica y operación conforme a GH-INTEROP-1.5.
- La publicación no importa/edita inboxes de otros repositorios ni afirma ACK, resolución, implementación, provisión, deploy o cutover. Esos estados y gates pertenecen a los consumidores.
- Contract Sync `before-review` para WI-CORE-038: PASS, cero eventos entrantes pendientes relevantes; checkpoint registrado el 2026-10-11.

**Evidencia:** `harness/contract-sync/outbox/CS-CORE-20261011-004.yaml`; `harness/state.json`; `spec/contracts/github-integration-contract.md` §Coordinación durable.
