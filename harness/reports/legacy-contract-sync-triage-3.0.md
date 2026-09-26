# Contract Sync heredado — alcance de WI-CORE-001

Este WI modifica planificación, specs y Harness, no despliega ni verifica de nuevo el runtime. Los siguientes inbox siguen en `ACKNOWLEDGED` y **no** se convierten a `C-RESOLVED`: sus acciones de implementación/despliegue deben revisarse al seleccionar un WI de producto o publicación relacionado.

| Evento | Motivo de diferimiento solo para WI-CORE-001 |
| --- | --- |
| CS-20260920-001 | Solicitud de Console para binding, errores y lifecycle; ya reflejada en contratos vigentes, pero su evidencia de runtime pertenece al corte de producto, no a la renumeración SDD. |
| CS-20260921-003 | Orden de despliegue y validación organizacional real siguen sujetos a evidencia externa; WI-CORE-008 conserva esa verificación. |

El diferimiento se limita al WI HARNESS 001, se reporta en cada checkpoint y no equivale a resolver la acción. Cualquier WI de producto debe volver a evaluar estos eventos. Si una contradicción contractual nueva aparece, se detiene el corte.

## Checkpoints invalidados

El `start` de 2026-09-24T21:38:49.499Z y `implementation-delivery` de 2026-09-24T21:59:36.604Z registraron `relevantPendingSyncIds: []` con la semántica anterior, que omitía `ACKNOWLEDGED`. No son evidencia válida. Se retiraron del estado activo y se repitieron en orden a las 23:03:13.830Z y 23:03:14.018Z, ahora con ambos `deferredSyncIds` explícitos; las marcas originales se conservan aquí y en el diff de Git.
