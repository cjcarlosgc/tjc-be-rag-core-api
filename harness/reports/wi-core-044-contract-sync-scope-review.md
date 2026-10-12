# WI-CORE-044 — Revisión de alcance de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

`WI-CORE-044` corrige defectos internos de búsqueda de chunks, selección de candidatos y ubicación del test (`contractImpact=false`, `publishesContract=false`): sin cambio de rutas, DTO, enums ni errores. El PULL `start` se registra con `contract-sync.mjs check --checkpoint start --work-item WI-CORE-044 --record`.

`CS-20260920-001` y `CS-20260921-003` siguen reconocidos pero no resueltos. Se clasifican `NOT_RELEVANT` solo para este WI: el primero trata códigos de conflicto de binding, rutas enable/DELETE y lifecycle de Project/RepositoryBinding; el segundo, autenticación GitHub y orden de despliegue. `WI-CORE-044` corrige búsqueda de chunks y selección de candidatos sin tocar binding, auth ni despliegue.
