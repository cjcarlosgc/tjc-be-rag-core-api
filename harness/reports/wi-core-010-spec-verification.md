# WI-CORE-010 — verificación SDD

**Resultado:** aprobado para implementación del corte Harness.

- El cambio está limitado a `consumerImportedAt` local en inboxes Contract Sync y a la validación temporal de snapshots `W-DONE`.
- No agrega ni cambia épicas, HU, historias de producto, contratos API, datos persistidos o almacenamiento de snapshots.
- Los eventos antiguos sin marca permanecen conservadores: siguen considerándose conocidos al cierre y no se autoexcluyen.
- Un cambio de estado o evidencia del consumidor no cambia el hash estable del payload productor; la reimportación preserva la primera marca local.
- Decisiones bloqueantes aplicables: ninguna.

Se mantiene `WI-CORE-003` detrás de esta corrección porque el fallo del validador apareció al importar sus Contract Sync previos.
