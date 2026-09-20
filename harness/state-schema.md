# Esquema del estado del Harness V2

`harness/state.json` es un checkpoint operativo, no una segunda fuente funcional. `storyIds` y `sprint` siempre se conservan; un trabajo puramente de harness puede usar `storyIds: []` y `workItemType: "HARNESS"`.

```json
{
  "schemaVersion": 3,
  "allowedStatuses": ["SELECTED", "SPEC_VERIFIED", "AWAITING_APPROVAL", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DECISION_REQUIRED", "DONE"],
  "activeWorkItem": {
    "id": "work-item-id",
    "workItemType": "PRODUCT | HARNESS",
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
    "execution": {
      "leaderAgent": "leader",
      "analysisAgent": null,
      "implementationAgent": null,
      "contractReviewAgent": null,
      "reviewAgent": null,
      "handoffs": [],
      "reviewCycles": 0,
      "maxReviewCycles": 2
    },
    "gates": {
      "sddVerified": "NOT_RUN",
      "implementationCompleted": "NOT_RUN",
      "independentReviewPassed": "NOT_RUN",
      "technicalChecksPassed": "NOT_RUN",
      "contractReviewed": "NOT_APPLICABLE",
      "canonicalContractSynced": "NOT_APPLICABLE",
      "contractSyncPublished": "NOT_APPLICABLE",
      "interopSyncChecked": "NOT_RUN",
      "noBlockingDecisions": "NOT_RUN",
      "retryLimitRespected": "NOT_RUN"
    },
    "coordination": {
      "contractImpact": false,
      "pullCheckpoints": [],
      "publishedSyncIds": [],
      "pendingRelevantSyncIds": []
    },
    "evidence": [],
    "blockedReason": null
  }
}
```

Reglas:

- `SPEC_VERIFIED` y estados posteriores requieren `decisionGate.checked=true`, `checkedAt` y cero `blockingDecisionIds`.
- `IN_PROGRESS`, `IN_REVIEW` y `DONE` requieren `approved=true` solo para `workItemType: "PRODUCT"`; un cambio de harness documenta explícitamente su alcance no funcional en `evidence`.
- `DONE` requiere gates obligatorios en `PASSED`, `interopSyncChecked=PASSED`, `pendingRelevantSyncIds=[]` y `reviewCycles <= maxReviewCycles`.
- Si `contractImpact=true`, `contractReviewed`, `canonicalContractSynced` y `contractSyncPublished` no pueden ser `NOT_APPLICABLE`.
- Una decisión bloqueante exige `BLOCKED` o `DECISION_REQUIRED` y una pregunta concreta en `blockedReason`.
- Los IDs de decisiones deben existir en paths referenciados; el estado no duplica su contenido.
