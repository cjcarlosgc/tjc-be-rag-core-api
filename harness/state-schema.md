# Esquema del estado del harness

`harness/state.json` es un checkpoint operativo, no una segunda fuente funcional.

```json
{
  "schemaVersion": 1,
  "sddVersion": "1.0",
  "allowedStatuses": ["SELECTED","SPEC_VERIFIED","AWAITING_APPROVAL","IN_PROGRESS","IN_REVIEW","BLOCKED","DONE"],
  "activeWorkItem": {
    "id": "HUxx-slug",
    "storyIds": ["HUxx"],
    "sprint": "Sprint N",
    "status": "SELECTED",
    "specPaths": ["spec/features/..."],
    "transversalPaths": [],
    "approved": false,
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601",
    "blockedReason": null
  }
}
```

Reglas: `IN_PROGRESS`, `IN_REVIEW` y `DONE` requieren `approved=true`; `storyIds` debe referenciar IDs existentes; `specPaths` y `transversalPaths` deben existir; al cerrar, `activeWorkItem=null`.
