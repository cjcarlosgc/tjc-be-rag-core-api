# WI-CORE-079 — revisión de eventos históricos globales de Contract Sync
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Dos eventos históricos sin `scopePaths` se consideran globales. Se clasifican para este WI contra el cambio real (esquema CT-01 del payload que Integration ya emite y Core ya valida, E-01, SYSTEM-2.15, ejemplo del Sandbox y versiones; sin cambio de rutas, DTO, enums ni comportamiento).

| Evento | sha256 | Disposición | Razón |
|---|---|---|---|
| `CS-20260920-001` | `e5caa28faa910640306afc1f83fdc74a46310fdb4b5489a4ac5af88c1f034c6b` | `NOT_RELEVANT` | Binding y lifecycle de Project/RepositoryBinding. El esquema CT-01 solo hace ejecutable el payload normalizado que ya existe; no cambia el binding, su lifecycle ni cómo Core procesa los eventos. |
| `CS-20260921-003` | `db3dd16b293d50820bea71cf17b53968164dc59fde3d7d7e7c397b50d2b86ac0` | `NOT_RELEVANT` | Autenticación GitHub y orden de despliegue; WI-CORE-079 no cambia auth ni despliegue. |
