# WI-CORE-045 — revisión de eventos históricos globales de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Dos eventos históricos sin `scopePaths` (que por compatibilidad se consideran globales) siguen sin `C-RESOLVED`; se revisan por WI como `NOT_RELEVANT` (sin cambiar su estado ni sus acciones pendientes).

| Evento | sha256 | Disposición | Razón |
|---|---|---|---|
| `CS-20260920-001` | `e5caa28faa910640306afc1f83fdc74a46310fdb4b5489a4ac5af88c1f034c6b` | `NOT_RELEVANT` | Códigos de conflicto de binding, rutas enable/DELETE y lifecycle de Project/RepositoryBinding; este WI precisa errores, estados y semántica del pipeline PR-driven (§6.10/§6.11 y clasificación) sin tocar binding. |
| `CS-20260921-003` | `db3dd16b293d50820bea71cf17b53968164dc59fde3d7d7e7c397b50d2b86ac0` | `NOT_RELEVANT` | Autenticación GitHub y orden de despliegue; este WI no cambia auth, identidad ni despliegue. |

Mismas disposiciones y digest ya aceptados en `WI-CORE-004`, `WI-CORE-043` y `WI-CORE-044`.
