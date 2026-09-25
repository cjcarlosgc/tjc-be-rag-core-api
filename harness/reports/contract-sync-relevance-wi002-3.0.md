# Relevancia Contract Sync — WI-CORE-002

Fecha: 2026-09-24. Clasificación por alcance de WI, no cierre de eventos.

El WI-CORE-002 elimina los flujos de entrada manual ZIP y exportación legacy de artefactos. Los eventos siguientes no gobiernan esos flujos: se registran como `NOT_RELEVANT` solo para este WI. Los YAML de inbox permanecen sin modificar y sus estados `ACKNOWLEDGED` continúan abiertos para los trabajos a los que sí aplican.

| Evento | Estado | Relevancia en WI-CORE-002 | Qué queda pendiente / próximo WI |
| --- | --- | --- | --- |
| CS-20260920-001 | ACKNOWLEDGED | No relevante: trata creación/pausa/reactivación de RepositoryBinding, baja de Project y aislamiento de sus lecturas; WI-CORE-002 no cambia esos flujos. | Releer sus requisitos durante WI-CORE-003, que mueve la interacción con GitHub y binding. No declarar el evento cerrado solo por esta clasificación. |
| CS-20260921-003 | ACKNOWLEDGED | No relevante: trata identidad GitHub, orden de despliegue de bundles y verificación organizacional; WI-CORE-002 no modifica identidad ni despliegues. | La evidencia de despliegue/validación externa sigue pendiente en WI-CORE-008; revisar requisitos de identidad al diseñar WI-CORE-003. |

Los digests en `harness/work-items.json` cubren el contenido completo salvo el campo mutable `status`; cualquier cambio al requisito invalida la clasificación. La excepción solo reduce el bloqueo del WI indicado y nunca convierte `ACKNOWLEDGED` en `C-RESOLVED`.
