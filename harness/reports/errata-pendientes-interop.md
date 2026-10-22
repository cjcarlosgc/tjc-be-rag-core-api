# Erratas pendientes del contrato INTEROP (para la próxima versión documental)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Decisión del usuario (2026-10-21): las erratas que no cambian el comportamiento se acumulan y se corrigen **junto con el próximo cambio de INTEROP** por otro motivo; no se publica una versión solo por una errata. INTEROP-2.19 y SYSTEM-2.14 ya se publicaron (`CS-CORE-20261021-004`) y los espejos son idénticos byte a byte.

| ID | Dónde | Qué dice | Qué emite el servidor | Estado |
|---|---|---|---|---|
| E-01 | INTEROP §6.5, `ExperimentResultsResponse` (≈ líneas 359-362) | lista `analysisRunId` y `symbol` | emite `targetId` (`app/src/experiments/dto/experiment.response.ts`) | pendiente; el DTO no cambia, solo se documenta lo real (mismo criterio que `ExperimentStatusResponse` en INTEROP-2.18) |
| E-02 | `CS-CORE-20261021-003` (Sandbox) | `scopePaths` lista `github-integration-contract.md`, que Sandbox no espeja | — | informativo, inocuo; no se reescribe el evento |
