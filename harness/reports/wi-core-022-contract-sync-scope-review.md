# WI-CORE-022 — Revisión de alcance de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

`CS-20260920-001` y `CS-20260921-003` siguen reconocidos pero no resueltos. Se clasifican `NOT_RELEVANT` solo para este WI: el primero trata códigos de conflicto de binding, rutas enable/DELETE y lifecycle de Project/RepositoryBinding; el segundo, autenticación GitHub y orden de despliegue. WI-CORE-022 implementa la comparación de retrieval OE2 (INTEROP-2.7 §6.15: SE vs SEM, job asíncrono, tablas aditivas) y emite su propio Contract Sync de implementación a Console; no toca binding, auth ni despliegue de esos eventos.
