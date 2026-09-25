# Harness V3 — Core

El Harness ejecuta **work items locales** registrados en `harness/work-items.json`. La planificación de épicas, HU, casos, ideas y subtareas vive en `spec/`; `harness/state.json` guarda el WI activo y snapshots verificables de los WI cerrados. Ver `spec/constitution/planning-model.md` para IDs y estados de cada nivel.

## Ciclo de un WI

`W-PLANNED → W-READY → W-SELECTED → W-SPEC_VERIFIED → W-AWAITING_APPROVAL → W-IN_PROGRESS → W-IN_REVIEW → W-DONE`. `W-BLOCKED`, `W-DECISION_REQUIRED` y `W-CANCELLED` conservan causa y evidencia. Un WI terminado sale de `activeWorkItem`, pero su snapshot completo persiste en `completedWorkItems`, además del reporte y Git. `W-READY` exige taskIds, HU, componente, criterios, dependencias y rutas; `W-SELECTED` designa el corte activo.

1. **Pre-tarea:** leader selecciona WI, verifica `dependsOn`, hace PULL `start` de Contract Sync y encarga a sdd-analyst la revisión de spec, decisiones `Blocks`, aceptación y riesgos de datos. Contract-reviewer evalúa contratos si aplica. Un cambio funcional o arquitectónico espera aprobación humana en `W-AWAITING_APPROVAL`. Solo decisiones que bloquean este WI impiden `W-SPEC_VERIFIED`.
2. **Durante la tarea:** implementer trabaja el corte aprobado. Subtareas independientes pueden dividirse entre implementers en paralelo; una dependencia real se respeta y no se marca completa antes de su precedente. Leader consolida los handoffs. Antes de entregar, PULL `implementation-delivery`, checks técnicos y evidencia.
3. **Post-tarea:** PULL `before-review`, revisión independiente y contract-reviewer si afecta contrato; roles compatibles pueden revisar en paralelo. Leader hace fan-in, corrige hallazgos (máximo dos ciclos), PULL `before-done`, valida gates y registra el cierre. Después hay revisión acumulada del rango antes de cualquier push solicitado.

Las asignaciones de implementer/reviewer/ux-reviewer pueden quedar vacías hasta que se designen los agentes. Un WI seleccionado o en implementación no falla solo por no tener reviewer asignado; al entrar en `W-IN_REVIEW` implementer y reviewer deben estar asignados y ser distintos, y los cortes con UI requieren además `ux-reviewer`.

El implementer no aprueba su propio corte. Un handoff tiene `status` de veredicto (`APPROVED|CHANGES_REQUESTED|BLOCKED|DECISION_REQUIRED`), `findings`, `blockers`, `filesAffected`, `evidence` y `recommendedNextStep`; el veredicto no sustituye los gates.

## Gates

`WI-CORE-001` es una migración del propio Harness y SDD (`workItemType: HARNESS`): durante este único corte, la spec y el validador se construyen dentro de `W-IN_PROGRESS`, y `sddVerified` debe pasar antes de `W-IN_REVIEW`. Esto no autoriza a un WI de producto a implementar antes de `W-SPEC_VERIFIED` y aprobación humana.

Los valores son `G-NOT_RUN`, `G-PASSED`, `G-FAILED` y `G-NOT_APPLICABLE`. Para `W-DONE` deben pasar `sddVerified`, `implementationCompleted`, `independentReviewPassed`, `technicalChecksPassed`, `interopSyncChecked`, `noBlockingDecisions` y `retryLimitRespected`. Si `contractImpact=true`, también `contractReviewed` y `canonicalContractSynced`. `contractSyncPublished` pasa solo cuando `publishesContract=true` y hay un evento en outbox; los demás casos usan `G-NOT_APPLICABLE`. Cada gate necesita evidencia reproducible, no solo un estado declarado.

Contract Sync corre en `start`, `implementation-delivery`, `before-review` y `before-done`. Todo evento relevante no `C-RESOLVED` o incompatibilidad conocida impide `interopSyncChecked=G-PASSED`. Para un evento histórico sin `scopePaths`, que por compatibilidad se considera global, el registry puede registrar `contractSyncReview` por WI con `NOT_RELEVANT`, motivo y digest estable del contenido. Eso permite excluirlo solo del gate de ese WI; no cambia el estado del evento ni sus acciones pendientes. Cambiar el contenido invalida el digest. Un evento notifica una necesidad contractual; no autoriza implementar un endpoint no aprobado ni cambia otro repositorio.

## Validación local

```sh
node scripts/sdd-check.mjs
node harness/validate-work-items.mjs
node harness/validate-harness.mjs
node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-001
```

También se ejecutan lint, tests y build del componente antes de cerrar. Los archivos históricos en `harness/reports/` son evidencia, no reglas vigentes. No se hace push, PR, merge ni cambios de infraestructura externa sin solicitud explícita del usuario.
