# WI-CORE-041 — Revisión de alcance de Contract Sync

Modelo: leader · configurado `gpt-6-luna` · atendido `unknown` · esfuerzo `xhigh`

## Clasificación

Los eventos históricos siguientes no afectan el WI. Sus inbox payloads son globales por no tener `scopePaths`; la clasificación `NOT_RELEVANT` se limita a WI-CORE-041 y no altera los estados C-ACKNOWLEDGED ni elimina sus acciones para otros trabajos.

| Evento | SHA-256 estable | Disposición | Motivo |
| --- | --- | --- | --- |
| `CS-20260920-001` | `e5caa28faa910640306afc1f83fdc74a46310fdb4b5489a4ac5af88c1f034c6b` | `NOT_RELEVANT` | Trata lifecycle, binding y autorización de Projects; WI-CORE-041 solo alinea la clasificación local del nombre de manifiesto Composer y el filtro de snapshot. |
| `CS-20260921-003` | `db3dd16b293d50820bea71cf17b53968164dc59fde3d7d7e7c397b50d2b86ac0` | `NOT_RELEVANT` | Trata autenticación de Console, orden de despliegue y configuración; WI-CORE-041 no cambia login, autorización, despliegue ni infraestructura. |

La regla de Contract Sync conserva sus estados locales en `C-ACKNOWLEDGED`; esta revisión no equivale a `C-RESOLVED`. Los eventos de INTEROP-2.8 que sí están resueltos permanecen sin cambios.
