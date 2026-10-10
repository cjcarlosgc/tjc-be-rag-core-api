# WI-CORE-007 — Revisión de alcance de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

`CS-20260920-001` y `CS-20260921-003` siguen reconocidos pero no resueltos. Se clasifican `NOT_RELEVANT` solo para este WI: el primero trata códigos de conflicto de binding, rutas enable/DELETE y lifecycle de Project/RepositoryBinding; el segundo, autenticación GitHub y orden de despliegue. WI-CORE-007 persiste el detalle diagnóstico de fallos experimentales (`SandboxFailureFact`) en `ExperimentRepetition` sin cambiar `ExperimentRepetitionResponse` (`contractImpact=false`); no toca binding, auth ni despliegue de esos eventos.
