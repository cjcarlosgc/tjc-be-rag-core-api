# WI-CORE-030 — Revisión de alcance de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

`CS-20260920-001` y `CS-20260921-003` siguen reconocidos pero no resueltos. Se clasifican `NOT_RELEVANT` solo para este WI: el primero trata códigos de conflicto de binding, rutas enable/DELETE y lifecycle de Project/RepositoryBinding; el segundo, autenticación GitHub y orden de despliegue. WI-CORE-030 es una recuperación interna de la cola de jobs (`JobsRepository.releaseStale`) y un endurecimiento de repositorios de experimentos; no cambia contrato público (`contractImpact=false`, `publishesContract=false`) ni toca binding, auth ni despliegue de esos eventos.
