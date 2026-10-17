# Contract Sync heredado — alcance de WI-CORE-003

El `start` revisa los dos eventos históricos del inbox de Core. Ambos son anteriores a `planningBaseline`; continúan en estado `ACKNOWLEDGED` y esta clasificación no los resuelve ni cierra sus acciones ajenas al corte.

| Evento | Clasificación para WI-CORE-003 |
| --- | --- |
| `CS-20260920-001` | `NOT_RELEVANT`: el evento describe rutas y reglas públicas de binding/Project ya consolidadas en `INTEROP-2.4`. WI-CORE-003 conserva esas rutas y resultados; solo sustituye la implementación GitHub detrás del Core. La regresión de esa superficie sigue siendo criterio de aceptación. |
| `CS-20260921-003` | `NOT_RELEVANT`: el evento trata el login GitHub a través de Supabase, orden de despliegue e integración organizacional. Este corte preserva Supabase Auth y no modifica ni publica despliegues externos; migra el uso de GitHub App/API a un servicio interno. |

El digest registrado por WI cubre el contenido del evento normalizado reemplazando solo la línea `status`; un cambio de contenido invalida la clasificación. Si la decisión de alcance cambia e incluye el login OAuth o altera rutas/DTOs públicos, se debe reabrir la pertinencia y no reutilizar este informe.
