# Publicación de Contract Sync — CS-CORE-20261009-008 y CS-CORE-20261009-009
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09 (America/Lima). Origen: WI-CORE-025. Destino: Console. `breaking=false`. Estado inicial `C-PENDING` (Console debe importar y acusar).

- `CS-CORE-20261009-008` (`harness/contract-sync/outbox/CS-CORE-20261009-008.yaml`): INTEROP-2.7 §6.5.1 implementado en Core (campos de pareado nullables, `executionDurationMs` nullable, nuevos 422/503, denominadores de métricas, semántica de reintento). `sourceRevision` `d1d04b7`.
- `CS-CORE-20261009-009` (`harness/contract-sync/outbox/CS-CORE-20261009-009.yaml`): aclaración documental que acota el texto de `executionDurationMs` de la `-008`, que no se modifica (precedente 006/007): null si el Sandbox nunca se invocó y en corridas previas; el tiempo transcurrido si la llamada al Sandbox falla. Surgió de la revisión independiente (hallazgo 1).

Revisión contractual: `harness/reports/wi-core-025-contract-review.md`. El importe y el acuse por Console son externos a este repositorio.
