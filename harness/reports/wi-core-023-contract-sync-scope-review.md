# WI-CORE-023 — Revisión de alcance de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

`CS-20260920-001` y `CS-20260921-003` siguen reconocidos pero no resueltos. Se clasifican `NOT_RELEVANT` solo para este WI: el primero trata códigos de conflicto de binding, rutas enable/DELETE y lifecycle de Project/RepositoryBinding; el segundo, autenticación GitHub y orden de despliegue. WI-CORE-023 solo confina el SDK de OpenAI al adaptador de `LLMProvider` y unifica la configuración efectiva del LLM, sin cambiar DTOs, rutas ni contratos.
