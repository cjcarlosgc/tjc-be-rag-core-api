# Esquema del estado del harness

`harness/state.json` es un checkpoint operativo, no una segunda fuente funcional.

```json
{
  "schemaVersion": 2,
  "sddVersion": "1.9",
  "allowedStatuses": ["SELECTED","SPEC_VERIFIED","AWAITING_APPROVAL","IN_PROGRESS","IN_REVIEW","BLOCKED","DONE"],
  "activeWorkItem": {
    "id": "HUxx-slug",
    "storyIds": ["HUxx"],
    "sprint": "Sprint N",
    "status": "SELECTED",
    "specPaths": ["spec/features/..."],
    "transversalPaths": [],
    "approved": false,
    "decisionGate": {
      "checked": false,
      "blockingDecisionIds": [],
      "nonBlockingDecisionIds": [],
      "checkedAt": null
    },
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601",
    "blockedReason": null
  }
}
```

Reglas:

- `IN_PROGRESS`, `IN_REVIEW` y `DONE` requieren `approved=true`.
- `SPEC_VERIFIED` y estados posteriores requieren `decisionGate.checked=true`, `checkedAt` informado y `blockingDecisionIds=[]`.
- Una decisión bloqueante requiere estado `BLOCKED` y una pregunta concreta en `blockedReason`.
- Los IDs registrados deben existir en las specs referenciadas; el estado no duplica el cuerpo de las decisiones.
- `storyIds` debe referenciar IDs existentes; `specPaths` y `transversalPaths` deben existir.
- Al cerrar, `activeWorkItem=null`.
