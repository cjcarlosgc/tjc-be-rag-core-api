# WI-CORE-016 — Revisión de alcance Contract Sync

Los dos eventos históricos reconocidos en `start` no aplican a este WI:

- `CS-20260920-001` define rutas y transiciones de `Project`/`RepositoryBinding`; WI-CORE-016 no modifica esas rutas ni su lifecycle.
- `CS-20260921-003` registra autenticación GitHub y secuencia de despliegue; WI-CORE-016 no cambia autenticación, configuración ni despliegue.

El corte solo corrige la clasificación del handler de Validation cuando no hay candidatos `METHOD`/`FUNCTION`, y sus pruebas. Los IDs y hashes se conservan tal como aparecen en el inbox. La clasificación `NOT_RELEVANT` se limita a este WI y no resuelve ni altera los eventos originales.
