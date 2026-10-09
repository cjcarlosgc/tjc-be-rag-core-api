# 011-context-traces — Subtareas vigentes

- [ ] **ST-CORE-033 · T-BACKLOGGED · WI-CORE-026 · HU12, HU15:** trace operativo de nueve enlaces con `retrieval_id`, `context_id` y `execution_id` según INTEROP-2.7 §6.16; `NOT_APPLICABLE` solo en terminación legítima; sin otros identificadores ni chain-of-thought. **Obligación heredada de WI-CORE-021:** el `context_id` persiste `functionalRuleIds` seleccionados, conteos de recuperadas/seleccionadas/omitidas y motivo de omisión (al menos `TOKEN_BUDGET`) con `knowledgeId` para reconstruir la procedencia desde Functional Knowledge; prueba de persistencia real que invierta la aserción actual de ausencia en `experiment-job.handler.spec.ts`; INTEROP-2.7 §6.16 y Contract Sync a Console si se exponen en el trace o el bundle (ver `plan.md`).

Los checklists anteriores se conservan en Git, CHANGELOG y `harness/reports/open-task-triage-3.0.md`.
