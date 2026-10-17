# Publicación de Contract Sync — CS-CORE-20261009-012
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09 (America/Lima). Origen: WI-CORE-026 (`DEC-TRACE-001`, aprobada por el usuario). Destino: `github-integration`. `breaking=false`. Estado inicial `C-PENDING`. Canal: Contract Sync (único canal entre repositorios); no hay handoff manual.

`CS-CORE-20261009-012` (`harness/contract-sync/outbox/CS-CORE-20261009-012.yaml`): `GH-INTEROP-1.3` hace que `POST /internal/v1/github/checks` responda `200 { checkId: string }`; Core tolera `204` (checkId null), por lo que puede desplegarse en cualquier orden. `sourceRevision` `0a9d5ba`. Texto ratificado por el contract-reviewer (`harness/reports/wi-core-026-gh-interop-review.md`). GitHub Integration debe importar, acusar, actualizar contrato y espejo, implementar, probar y avisar con un `CS-GH-...` para que Core persista el id. Los espejos de Console y GitHub Integration los actualizan sus sesiones.
