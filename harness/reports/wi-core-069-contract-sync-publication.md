# WI-CORE-069 — publicación de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Publicados el 2026-10-18 en `harness/contract-sync/outbox/`, `sourceRevision` `67519a20a5e061bd81a880fe539693c9a364bba3` (commit que contiene el texto final de los contratos), `breaking: false`, estado inicial `C-PENDING`:

| Evento | Destino | Acción del consumidor |
|---|---|---|
| `CS-CORE-20261018-001` | github-integration | re-espejar contratos y esquemas; emitir `ErrorEnvelope` completo con `retryable` |
| `CS-CORE-20261018-002` | console | re-espejar; tipo generado `ErrorEnvelope`; origen en `CONSOLE_CORS_ORIGINS` |
| `CS-CORE-20261018-003` | sandbox | re-espejar; emitir `executionProfile` y `stage` válido; aceptar requests sin `phase` |

Digests finales (sha256): `system-contract.md` `b70f9358…0444`, `interoperability-contract.md` `b9ed40dc…ea05`, `github-integration-contract.md` `6c553ee8…565a`, árbol `spec/contracts/schemas/` `c45e4513…1fa31b` (los completos están en el campo `changed` de cada evento). Los espejos que cross sincronizó antes de las notas editoriales de INTEROP §5 y §10 quedan desfasados hasta que cada consumidor re-espeje desde Core.

## Aclaraciones tras la revisión contractual

- **Receta del digest del árbol de schemas** (`c45e4513…1fa31b`): `cd spec/contracts/schemas && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256` (rutas relativas). Con rutas completas sale otro valor; los eventos no se reescriben.
- **`CS-CORE-20261018-003` (sandbox):** «los 3 contratos» se refiere a los que cada repo espeja. Sandbox espeja `system-contract.md` e `interoperability-contract.md`; `github-integration-contract.md` solo se espeja en Core, github-integration y console, así que Sandbox no lo necesita.
- Un Sandbox anterior rechaza `phase` (request con `additionalProperties: false`); está declarado en INTEROP y en el esquema.
