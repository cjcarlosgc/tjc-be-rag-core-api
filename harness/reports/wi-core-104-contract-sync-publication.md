# WI-CORE-104 — publicación de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Evento publicado en `harness/contract-sync/outbox/`: **`CS-CORE-20261025-002`** (`C-PENDING`, `breaking: false`, `sourceWorkItem: WI-CORE-104`, `sourceRevision 8c3eb0f73b805492ee46887e6024dc33254dbe6d`, el commit que contiene el contrato y el código). Un solo evento para `console`, `github-integration` y `sandbox`; `scopePaths`: `interoperability-contract.md`.

Digests (sobre el árbol commiteado): `interoperability-contract.md` (INTEROP-2.23) `5de10cb7c9717e10fed8ae34f462d4646f1ee768e60e8660feb61dfc6a468d83` (es el digest posterior a las tres observaciones bajas del contract-reviewer, que citaba `6a19c495…`); sin cambio: `system-contract.md` (SYSTEM-2.16) `d0a492b4484c8883d65e709f76d8c7ff2462b0eb8c832649cf75723b9543ea77`, `github-integration-contract.md` (GH-INTEROP-1.9) `dedf00fa2f0f5be928cfaf1e5a12ff19f96e7579524a0a689757f1077bfc6e4e` y el árbol `spec/contracts/schemas/` `8079ab73887e3a74b2dba57fa5ae5c146e47eb21231f9965718a85a3a2619718`.

El evento **subsume** `CS-CORE-20261025-001` (INTEROP-2.22, aún `C-PENDING`) y, para INTEROP, `CS-CORE-20261024-004` (2.21, ya `C-RESOLVED` en los tres consumidores): el re-espejo de `interoperability-contract.md` debe ir directo a INTEROP-2.23. Verificado en lectura (Core no edita otros repositorios): los espejos de Console, GitHub Integration y Sandbox están hoy en INTEROP-2.21 (digest `7f946d55…`) y SYSTEM-2.16.

Acción por consumidor (la entrega la hace cross): re-espejar byte a byte en un solo paso a 2.23; sin cambio de `schemas/` ni de `generated/`; Integration y Sandbox solo re-espejo documental. Console además etiqueta y tolera `BELOW_RELEVANCE_THRESHOLD` (`types.ts`, `ragLabels.ts`, fallback en `RagSidePanel.tsx:103`, ya pedido por `CS-CORE-20261025-001`); `layer`, `strategy` y los demás campos nuevos son opcionales; `dependencyContext.tokenCount` puede llegar a 500.

Despliegue Core → Integration → Console: el Core nuevo no rompe a un consumidor que aún espeje 2.20/2.21/2.22 (el contrato exige ignorar campos desconocidos; Console, Integration, Sandbox y el extractor no asumen el tope de 300). El estado del evento (`C-RESOLVED`) lo cambia cada consumidor con su evidencia.
