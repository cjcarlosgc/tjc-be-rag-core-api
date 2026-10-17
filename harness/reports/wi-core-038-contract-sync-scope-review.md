[sdd-analyst::GPT-6 Luna / high] · WI-CORE-038 · Clasificación de Contract Sync histórico

Modelo: sdd-analyst · configurado gpt-6-luna · atendido unknown · esfuerzo high

Clasificación limitada a WI-CORE-038; no cambia el estado global de los eventos.

| Evento | SHA-256 estable del inbox Core | Clasificación | Fundamento |
|---|---|---|---|
| `CS-20260920-001` | `e5caa28faa910640306afc1f83fdc74a46310fdb4b5489a4ac5af88c1f034c6b` | `NOT_RELEVANT` | Solicita cambios de lifecycle, conflictos y borrado de Project/RepositoryBinding. WI-CORE-038 solo resuelve coordinación técnica de Check Runs y no cambia esos flujos. |
| `CS-20260921-003` | `db3dd16b293d50820bea71cf17b53968164dc59fde3d7d7e7c397b50d2b86ac0` | `NOT_RELEVANT` | Trata autenticación GitHub, workspaces/roles y secuencia de despliegue Console. WI-CORE-038 mantiene esas políticas y no autoriza despliegue; sus referencias SYSTEM/INTEROP solo apuntan a la decisión de Checks. |

Los digests son del payload estable de `harness/contract-sync/inbox`, normalizando `status` y omitiendo `acknowledgementEvidence`, `resolutionEvidence` y `consumerImportedAt`. La clasificación de alcance no resuelve estos eventos para otros WIs.
