# WI-CORE-074 — publicación de Contract Sync (INTEROP-2.18 única, WI-C + WI-D)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Publicados el 2026-10-21 en `harness/contract-sync/outbox/`, `source: core`, `sourceWorkItem: WI-CORE-074`, `sourceRevision` `5c82853c36a419e9839d5474ad9657f714aba4cb`, estado inicial `C-PENDING`:

| Evento | Destino | `breaking` | Acción principal |
|---|---|---|---|
| `CS-CORE-20261021-001` | console | **true** | enviar siempre un token no vacío en el handshake, no abrir el socket sin sesión, manejar `AUTH_REQUIRED`/`INVALID_ACCESS_TOKEN`/`GITHUB_IDENTITY_REQUIRED`/`IDENTITY_UNAVAILABLE`; re-espejar contratos y esquemas |
| `CS-CORE-20261021-002` | github-integration | false | re-espejar INTEROP y esquemas; conservar su política `INVALID_REQUEST`; sin impacto de §6.6 |
| `CS-CORE-20261021-003` | sandbox | false | re-espejar INTEROP, SYSTEM (sin cambio) y esquemas; sin impacto de §6.6 |

Digests finales (sha256), a cruzar al re-espejar byte a byte desde Core: `interoperability-contract.md` (INTEROP-2.18) `22b880d1d677d7a54fb0f909f05d505e1557b6bbcdcfbb35347e9e3b5947e311`; `github-integration-contract.md` (GH-INTEROP-1.8, sin cambio) `6c553ee856d0c53420a75d2bde5a9eb04cce2e029ffae1bf4194dcbc7a25565a`; `system-contract.md` (SYSTEM-2.13, sin cambio) `b70f9358fabdaa6d8ac61d07e25258ec5256f9dacd31049edb4f08e6879a0444`; árbol `spec/contracts/schemas/` con `examples/` `a1ba9a199d0035de85b807fa9ae26b9afb09f8af340a22f1cb34096547dc9091` (receta: `cd spec/contracts/schemas && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`).

Sandbox no espeja `github-integration-contract.md`; el `scopePaths` de su evento todavía lo lista (inocuo, F7 del contract-reviewer). Los espejos de los otros repos están en INTEROP-2.17 hasta que cada consumidor importe estos eventos.
