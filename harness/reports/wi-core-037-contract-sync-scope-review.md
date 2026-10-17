# WI-CORE-037 — Revisión de alcance de Contract Sync histórico

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

Fecha: 2026-10-11.

Los siguientes eventos siguen `C-ACKNOWLEDGED` en el inbox y no se resuelven ni alteran por esta clasificación. Su exclusión `NOT_RELEVANT` aplica únicamente a WI-CORE-037.

| Evento | SHA-256 estable | Disposición | Motivo |
|---|---|---|---|
| `CS-20260920-001` | `e5caa28faa910640306afc1f83fdc74a46310fdb4b5489a4ac5af88c1f034c6b` | `NOT_RELEVANT` | Solicita cambios de lifecycle/rutas de Project y RepositoryBinding. WI-CORE-037 solo transporta el `effectiveProjectRoot` congelado al Sandbox y conserva paths repo-relative; no cambia binding, lifecycle ni autorización. |
| `CS-20260921-003` | `db3dd16b293d50820bea71cf17b53968164dc59fde3d7d7e7c397b50d2b86ac0` | `NOT_RELEVANT` | Trata login de Console, identidad y orden de despliegue. WI-CORE-037 no cambia auth, login ni infraestructura; no autoriza despliegue. |

Los digests corresponden al payload estable del inbox Core; la normalización excluye los campos de ciclo de vida local. La clasificación permite que los checkpoints de este WI no queden bloqueados por solicitudes fuera de alcance y no cancela las acciones pendientes para sus WIs correspondientes.
