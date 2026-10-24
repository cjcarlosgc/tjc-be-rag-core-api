# WI-CORE-079 — publicación de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Eventos publicados en `harness/contract-sync/outbox/` (estado `C-PENDING`, `breaking: false`, `sourceWorkItem: WI-CORE-079`, `sourceRevision 208c3bdfe21bfc4b294da118d8ab1318f0432ca5`, el commit que contiene los contratos finales). Un evento por consumidor (decisión A-5), con `scopePaths` exactos:

| Evento | Consumidor | `scopePaths` |
|---|---|---|
| `CS-CORE-20261024-001` | github-integration | `interoperability-contract.md`, `github-integration-contract.md`, `system-contract.md`, `schemas` |
| `CS-CORE-20261024-002` | sandbox | `interoperability-contract.md`, `system-contract.md`, `schemas` (sin `github-integration-contract.md`: corrige E-02) |
| `CS-CORE-20261024-003` | console | los cuatro |

Digests finales (calculados sobre el árbol commiteado): `system-contract.md` (SYSTEM-2.15) `f3b61da59fcff613b86c0e2945c165fbf808eb44b48504bfe86521fe78f728ce`; `interoperability-contract.md` (INTEROP-2.20) `f0b395785eed3a42818c2a81f020edecc0cc0eaac912961e81aba2a9ff8e4a6a`; `github-integration-contract.md` (GH-INTEROP-1.9) `dedf00fa2f0f5be928cfaf1e5a12ff19f96e7579524a0a689757f1077bfc6e4e`; árbol `spec/contracts/schemas/` con `examples/` `8079ab73887e3a74b2dba57fa5ae5c146e47eb21231f9965718a85a3a2619718` (receta: `cd spec/contracts/schemas && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`).

Acciones por consumidor: re-espejar byte a byte y ejecutar `contracts:generate` + `contracts:check` (el nuevo esquema cambia `generated/`, no es «sin cambio de código»); Integration además valida lo que emite contra `GithubWebhookEvent` en un WI propio (`action` informativo); Console puede alinear su tipo local `ExperimentResultsResponse` (opcional). Core no edita otros repositorios: **cross entrega e importa los eventos** y decide el orden. Condición previa señalada por el contract-reviewer (CR-4): `CS-CORE-20261021-001..004` siguen `C-PENDING` en el outbox de Core; conviene un solo re-espejo por consumidor. No reescribir el commit `208c3bd` después de publicar.
