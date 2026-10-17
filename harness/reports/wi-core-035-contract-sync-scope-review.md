# WI-CORE-035 — Revisión de alcance de Contract Sync histórico

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

Fecha: 2026-10-11.

## Eventos excluidos de este corte

- `CS-20260920-001` no declara `scopePaths` y es anterior a la línea base Core/Console. Sus acciones pendientes pertenecen al binding de repositorio, lifecycle de Projects y acceso; este WI solo modifica la entrada de experimentos para recibir un AnalysisRun/símbolo y mapearlo internamente.
- `CS-20260921-003` tampoco declara `scopePaths` y es anterior a la línea base. Trata login de Console y orden de despliegue/configuración externa; este WI no altera identidad, publicación ni infraestructura.

Se mantienen sus estados/evidencia en inbox. La clasificación `NOT_RELEVANT` es local a `WI-CORE-035` y usa los digests estables del contenido, normalizando solo la línea `status`.
