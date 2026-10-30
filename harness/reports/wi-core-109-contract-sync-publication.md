# WI-CORE-109 — publicación de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Evento publicado en `harness/contract-sync/outbox/`: **`CS-CORE-20261030-001`** (`C-PENDING`, `breaking: false`, `sourceWorkItem: WI-CORE-109`, `sourceRevision 55bf4241431329a50db4ab85676b68c5888c01b8`, el commit que contiene el contrato y el código). Un solo evento para tres consumidores (`console`, `github-integration`, `sandbox`).

Digests (sobre el árbol commiteado): `interoperability-contract.md` (INTEROP-2.25) `b2f3845296451bd3e593c00cb1e5955029f3d77ef4d69d1fd9326d07f1fdb651`; `system-contract.md` (SYSTEM-2.16, sin cambio) `d0a492b4484c8883d65e709f76d8c7ff2462b0eb8c832649cf75723b9543ea77`; `github-integration-contract.md` (GH-INTEROP-1.9, sin cambio) `dedf00fa2f0f5be928cfaf1e5a12ff19f96e7579524a0a689757f1077bfc6e4e`; árbol `spec/contracts/schemas/` con `examples/` (sin cambio) `8079ab73887e3a74b2dba57fa5ae5c146e47eb21231f9965718a85a3a2619718`.

El evento **subsume** `CS-CORE-20261026-001` (INTEROP-2.24, aún `C-PENDING`): el re-espejo de `interoperability-contract.md` debe ir directo a INTEROP-2.25 (Console espeja hoy 2.23; Integration y Sandbox, 2.21).

Acción por consumidor (la entrega la hace cross): re-espejar byte a byte en un solo paso a 2.25; sin cambio de `schemas/` ni de `generated/`. Console además tipa `experimentCapture` en `AnalysisRunSummaryResponse` y los tipos de `ExperimentCaptureResponse` (sin UI en este corte; WI de Console aparte) e incluye lo pendiente de `CS-CORE-20261026-001`. Integration y Sandbox: solo re-espejo documental, sin cambio de código. Core no resuelve eventos de otros.
