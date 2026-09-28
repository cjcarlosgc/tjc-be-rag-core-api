# Contract Sync — CS-CORE-20260927-004

- **Work item emisor:** `WI-CORE-015`.
- **Destinos:** `github-integration`, `console`.
- **Estado publicado:** `C-PENDING` en `harness/contract-sync/outbox/CS-CORE-20260927-004.yaml`.
- **sourceRevision:** `606006b44c23c0515c73dc21518102bb49edcb8c` (`docs(contracts): align GH-INTEROP implementation status`).
- **breaking:** `false`.
- **Alcance:** `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md` y `spec/contracts/github-integration-contract.md`.
- **Hashes canónicos:** SYSTEM-2.5 `e0423375f15d0e4c29feac96475292e530902f60742fbd07238a50b3f9f9e13d`; INTEROP-2.6 `1f5cc04a7fc73388a49d1c1de4f79f873d0e95edec7db6e102b5f828f6a2f852`; GH-INTEROP-1.2 `8a80c056359af74dc8b3b704f47efb232eaafb250bd4efb1d923450435a9e9f9`.
- **Acción para GitHub Integration:** importar byte a byte los tres canónicos desde Core y actualizar su espejo INTEROP-2.5 a INTEROP-2.6; corregir referencias activas asociadas y acusar el evento.
- **Acción para Console:** actualizar SYSTEM y GH con el estado narrativo corregido y verificar que INTEROP-2.6 siga idéntico; acusar el evento.
- **Límite:** no cambia comportamiento, semántica ni versiones. La publicación no acredita importación de los consumidores, despliegue ni cutover.
