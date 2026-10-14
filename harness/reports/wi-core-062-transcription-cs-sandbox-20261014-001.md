# WI-CORE-062 — transcripción de CS-SANDBOX-20261014-001
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Original (solo lectura, no se modificó):** `tjc-be-test-execution-sandbox/harness/contract-sync/outbox/CS-SANDBOX-20261014-001.json` · `sha256` `eb0c8a255cc4e5daed4c6105a733bde5bf2d3e1f0b7c98bcd5082575c41ecf8e` · `sourceRevision` `19dfde456795c0a533d4823c25b546f3d372a970` (existente en la historia del Sandbox, «feat(sandbox): agregar startedAt/completedAt opcionales por etapa»).

**Por qué es una transcripción:** el original está en JSON (formato anterior del Sandbox) sin `sourceWorkItem` ni `scopePaths`; el `import` de Core solo lee YAML con esos campos. Autorizado por Jean (mensaje directo) a transcribirlo conservando ruta y hash, sin fabricar campos.

## Correspondencia campo a campo
| Campo YAML | Origen en el JSON |
|---|---|
| `id`, `source` (`sandbox`), `targets` (`[core]`), `breaking` (`false`), `sourceRevision` | `id`, `source`, `targets`, `breaking`, `sourceRevision` literales |
| `changed` | `changedContractAreas` (`executions`, `evidence`) literales |
| `requiredAction` | `requiredActions[0]` literal (inglés) |
| `sourceWorkItem` | `WI-SANDBOX-007`, referencia literal que figura en el texto de `requiredActions` («WI-SANDBOX-007, approved by Jean 2026-10-14») |
| `scopePaths` | **Derivado** del texto («INTEROP section 7.3»): `spec/contracts/interoperability-contract.md`; el JSON no trae `scopePaths` y omitirlo lo haría global (`*`) y relevante para todo WI |
| `status` | `PENDING` del JSON, canonizado como `C-PENDING` |
| `originalCreatedAt` | `createdAt` del JSON |
| `originalPath`, `originalSha256`, `transcription` | metadatos de la transcripción (no del productor) |
| `consumerImportedAt` | marca del consumidor (momento de la transcripción) |
