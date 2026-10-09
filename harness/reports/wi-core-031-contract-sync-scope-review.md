# WI-CORE-031 — Revisión de alcance de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

`CS-20260920-001` y `CS-20260921-003` siguen reconocidos pero no resueltos. Se clasifican `NOT_RELEVANT` solo para este WI: el primero trata códigos de conflicto de binding, rutas enable/DELETE y lifecycle de Project/RepositoryBinding; el segundo, autenticación GitHub y orden de despliegue. WI-CORE-031 migra el cliente del proveedor LLM a `/v1/responses` (interno, endpoint efectivo solo en `modelConfig`), sin cambio de contrato público (`contractImpact=false`), sin tocar binding, auth ni despliegue de esos eventos.
