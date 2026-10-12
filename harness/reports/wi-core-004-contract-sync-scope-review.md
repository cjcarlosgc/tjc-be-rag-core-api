# WI-CORE-004 — Revisión de alcance de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

`WI-CORE-004` es documental (`contractImpact=false`, `publishesContract=false`): formaliza casos operativos sin cambiar rutas, DTOs, enums ni errores. El resultado del PULL `start` se registra con `contract-sync.mjs check --checkpoint start --work-item WI-CORE-004 --record`. Cualquier evento relevante pendiente que aparezca se clasifica aquí antes de seleccionar.

## Reanudación (2026-10-12, tras cerrar WI-CORE-044)
`WI-CORE-004` se retoma con un nuevo PULL `start`. `CS-20260920-001` y `CS-20260921-003` siguen reconocidos pero no resueltos; se clasifican `NOT_RELEVANT` solo para este WI documental: el primero trata códigos de conflicto de binding, rutas enable/DELETE y lifecycle de Project/RepositoryBinding; el segundo, autenticación GitHub y orden de despliegue. Formalizar casos operativos no los toca.
