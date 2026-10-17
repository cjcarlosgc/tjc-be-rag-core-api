# Contract Sync heredado — alcance de WI-CORE-011

El start de WI-CORE-011 detectó los dos eventos antiguos todavía `ACKNOWLEDGED`. Ambos son anteriores a `planningBaseline` y sus acciones quedan fuera de este corte; se mantienen abiertos para sus WIs dueños.

| Evento | Clasificación para WI-CORE-011 |
| --- | --- |
| `CS-20260920-001` | `NOT_RELEVANT`: la petición cubre errores/rutas de binding, soft delete y ocultamiento de Projects. WI-CORE-011 conserva esas reglas y añade elegibilidad de Runs por fecha original; no cambia binding ni soft delete. El predicado `accessibleProject` existente permanece en las consultas owner-scoped. |
| `CS-20260921-003` | `NOT_RELEVANT`: el evento trata login GitHub/Supabase, despliegue y comprobaciones organizacionales reales. Este corte no altera autenticación, configuración externa ni despliegue. |

El digest cubre el contenido contractual estable, omitiendo solo el estado del evento. Una modificación de los YAML invalida esta clasificación. La revisión no cambia sus estados ni resuelve las acciones pendientes de otros work items.
