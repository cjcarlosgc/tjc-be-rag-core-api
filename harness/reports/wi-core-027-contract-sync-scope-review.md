# WI-CORE-027 — Revisión de alcance de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

`CS-20260920-001` y `CS-20260921-003` siguen reconocidos pero no resueltos. Se clasifican `NOT_RELEVANT` solo para este WI: el primero trata códigos de conflicto de binding, rutas enable/DELETE y lifecycle de Project/RepositoryBinding; el segundo, autenticación GitHub y orden de despliegue. WI-CORE-027 implementa la exportación de evidencia versionada (INTEROP-2.7 §6.16 `/evidence`) y la jerarquía de métricas y emite su propio Contract Sync de implementación a Console; no toca binding, auth ni despliegue de esos eventos.
