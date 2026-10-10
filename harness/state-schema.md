# Harness V3 — esquema de estado

`harness/work-items.json` es la cola local y declara `id`, `component`, `status`, `priority`, `sprint`, `storyIds`, `taskIds`, `caseIds`, `dependsOn`, `contractImpact`, `publishesContract` y `specPaths`. Para un evento histórico sin alcance, `contractSyncReview` puede registrar una clasificación `NOT_RELEVANT` por WI; requiere motivo, reporte y hash del contenido normalizado. `harness/state.json` describe el WI activo y conserva snapshots inmutables de cierre en `completedWorkItems`. Ambos deben coincidir en identidad, estado, sprint, historias, subtareas, casos, rutas y banderas de contrato. Un `activeWorkItem: null` es válido cuando no hay corte seleccionado. Todo WI `W-DONE` requiere un snapshot completo con gates, handoffs, cuatro checkpoints y evidencia; no permanece activo. Los Contract Sync importados nuevos llevan la hora de primera importación local para que eventos posteriores no invaliden retrospectivamente esos snapshots.

```json
{
  "schemaVersion": 4,
  "sddVersion": "3.0",
  "planningBaseline": "2026-09-24-core-console-transition",
  "allowedStatuses": ["W-PLANNED", "W-READY", "W-SELECTED", "W-SPEC_VERIFIED", "W-AWAITING_APPROVAL", "W-IN_PROGRESS", "W-IN_REVIEW", "W-DONE", "W-BLOCKED", "W-DECISION_REQUIRED", "W-CANCELLED"],
  "completedWorkItems": [],
  "activeWorkItem": {
    "id": "WI-CORE-001",
    "component": "CORE",
    "workItemType": "PRODUCT",
    "storyIds": ["HU01"],
    "taskIds": ["ST-CORE-001"],
    "caseIds": [],
    "sprint": "Transition",
    "status": "W-SELECTED",
    "specPaths": ["spec/features/015-sdd-harness-transition/spec.md"],
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
      "sddVerified": "G-NOT_RUN",
      "implementationCompleted": "G-NOT_RUN",
      "independentReviewPassed": "G-NOT_RUN",
      "technicalChecksPassed": "G-NOT_RUN",
      "contractReviewed": "G-NOT_APPLICABLE",
      "canonicalContractSynced": "G-NOT_APPLICABLE",
      "contractSyncPublished": "G-NOT_APPLICABLE",
      "interopSyncChecked": "G-NOT_RUN",
      "noBlockingDecisions": "G-NOT_RUN",
      "retryLimitRespected": "G-NOT_RUN"
    },
    "coordination": {
      "contractImpact": false,
      "publishesContract": false,
      "pullCheckpoints": [],
      "publishedSyncIds": [],
      "pendingRelevantSyncIds": []
    },
    "evidence": [],
    "blockedReason": null
  }
}
```

`contractSyncPublished` solo pasa a `G-PASSED` si `publishesContract=true` y hay eventos reales en outbox registrados en `publishedSyncIds`; de otro modo es `G-NOT_APPLICABLE`. `execution.reviewAgent` es el responsable de la revisión independiente: usa `human-reviewer` por defecto; usa `reviewer` (o el perfil de agente asignado) solo cuando el usuario pide delegarla. Debe ser distinto del implementer y dejar un handoff `APPROVED` con evidencia. La delegación no reemplaza la aprobación humana previa de alcance/arquitectura.

Para ejecutar Contract Sync `resolve`, el WI activo debe registrar `gates.implementationCompleted: G-PASSED` y al menos un reporte existente en `gateEvidence.implementationCompleted`; el comando no trata un archivo suelto como prueba suficiente.

Console añade `coordination.uiImpact`, `coordination.knownIncompatibilities` y gates `uxReviewed`/`noMocksPresentedAsLive`. `PRODUCT` en `W-IN_PROGRESS` o posterior requiere `approved=true`. Antes de `W-DONE`, copiar el WI completo a `completedWorkItems[]` con `status: W-DONE`, `closedAt`, `gateEvidence` (cada gate aprobado apunta a un archivo existente de `harness/reports/`) y `evidence` con al menos un reporte real. El cierre exige cuatro checkpoints Contract Sync ordenados y del mismo WI, ausencia de syncs relevantes pendientes y handoff `APPROVED` de un reviewer distinto del implementer; `contractImpact` exige también handoff contractual. Luego se retira `activeWorkItem`. `W-BLOCKED`/`W-DECISION_REQUIRED` requieren razón concreta. Una decisión bloqueante no permite avanzar a `W-SPEC_VERIFIED`.

Los prefijos `H-`, `O-`, `T-`, `D-`, `C-` y `G-` identifican estados de otros niveles; no se mezclan con `W-`. Los IDs `HU`, `OC`, `ST`, `WI`, `DEC` y `CS` son identificadores, no estados.

`handoffs[]` (agentes IA) incluyen `executedBy: { agent, configuredModel, servedModel, effort }`; `servedModel` puede ser `unknown` si no se observó. Ver `harness/WORKFLOW.md`, «Trazabilidad de modelo». Es informativo y el validador no lo exige.

Cuando el leader hace un cambio mínimo en lugar de delegarlo, su handoff declara `executedBy.agent: leader` con `reason: "cambio mínimo"` y los archivos y líneas tocados (`filesAffected`). Ver `harness/WORKFLOW.md`, «Delegación de implementación». Es informativo y el validador no lo exige.

## Modo fuera de casa (`awayMode`)

Campo opcional de primer nivel de `harness/state.json`. Ausente o `enabled: false` significa desactivado (valor por defecto). Solo el usuario lo activa o desactiva, expresamente en chat; el leader nunca lo activa por inferencia.

```json
"awayMode": {
  "enabled": true,
  "activatedBy": "user",
  "activatedAt": "2026-10-09T00:00:00.000Z",
  "quote": "cita breve y literal del usuario"
}
```

Al desactivarse se conserva el registro con `enabled: false`, `deactivatedAt` y `deactivationQuote`. Mientras `enabled` sea `true`, la revisión independiente la hace el agente `reviewer` (`execution.reviewAgent: "reviewer"`, handoff con `executedBy`); no sustituye decisiones `DEC` ni aprobaciones de alcance o contrato, no autoriza push/PR/infraestructura externa y no relaja gates. El validador exige la forma del campo cuando existe.

