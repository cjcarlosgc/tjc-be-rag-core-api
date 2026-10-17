[sdd-analyst::GPT-6 Luna / high] · WI-CORE-034 · Clasificación de eventos históricos de Contract Sync

Modelo: sdd-analyst · configurado gpt-6-luna · atendido gpt-6-luna · esfuerzo high

Clasificación limitada a WI-CORE-034; no cambia el estado global de estos eventos.

| Evento | SHA-256 del evento en el inbox Core | Clasificación para WI-CORE-034 | Fundamento |
|---|---|---|---|
| `CS-20260920-001` | `e5caa28faa910640306afc1f83fdc74a46310fdb4b5489a4ac5af88c1f034c6b` | `NOT_RELEVANT` | Solicita cambios de conflictos y lifecycle de `Project`/`RepositoryBinding` (incluye enable, DELETE y aislamiento). WI-CORE-034 solo aclara identidad y concurrencia de Checks; no toca esos flujos. |
| `CS-20260921-003` | `db3dd16b293d50820bea71cf17b53968164dc59fde3d7d7e7c397b50d2b86ac0` | `NOT_RELEVANT` | Trata autenticación GitHub, workspace/roles y secuencia de despliegue. WI-CORE-034 no modifica auth, binding, workspaces ni despliegue; sus referencias a SYSTEM/INTEROP se limitan a la semántica de Check. |

Los SHA corresponden al digest que usa `contract-sync.mjs`: payload estable del inbox, normalizando `status` y omitiendo `acknowledgementEvidence`, `resolutionEvidence` y `consumerImportedAt`. Se recalcularon con `stableContractSyncPayload` y SHA-256. La clasificación es de alcance y no afirma que los eventos históricos estén resueltos; pueden seguir pendientes o ACKNOWLEDGED globalmente para otros trabajos.

`CS-GH-20261010-001` no se clasifica como no relevante: sí aplica y su solicitud quedó contestada por GH-INTEROP-1.4. Permanece `C-ACKNOWLEDGED` hasta registrar formalmente su resolución en Core.

Modelo: sdd-analyst · configurado gpt-6-luna · atendido gpt-6-luna · esfuerzo high
