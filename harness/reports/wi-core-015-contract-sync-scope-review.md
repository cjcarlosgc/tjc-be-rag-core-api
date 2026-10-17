# WI-CORE-015 — revisión de eventos Contract Sync previos a la línea base

Ambos eventos ya estaban `C-ACKNOWLEDGED` al iniciar WI-CORE-015 y preceden la línea base `2026-09-24-core-console-transition`. Se clasifican como `NOT_RELEVANT` solo para este WI; sus acciones y estados fuente no se alteran.

| Evento | SHA-256 estable | Disposición para WI-CORE-015 | Motivo |
| --- | --- | --- | --- |
| `CS-20260920-001` | `e5caa28faa910640306afc1f83fdc74a46310fdb4b5489a4ac5af88c1f034c6b` | `NOT_RELEVANT` | Trata el lifecycle de RepositoryBinding/Project, distinto a corregir el estado narrativo de GH-INTEROP-1.2 y sincronizar sus espejos. |
| `CS-20260921-003` | `db3dd16b293d50820bea71cf17b53968164dc59fde3d7d7e7c397b50d2b86ac0` | `NOT_RELEVANT` | Trata login GitHub de Console y configuración de despliegue del bundle; WI-CORE-015 no cambia auth ni configura/despliega servicios. |

El digest de cada fila se calculó desde el payload estable local, sin estados ni anotaciones del consumidor. Ninguna clasificación cierra los eventos ni sustituye su trabajo dueño.
