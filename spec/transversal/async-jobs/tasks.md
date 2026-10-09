# async-jobs — Subtareas vigentes

- [ ] **ST-CORE-037 · T-READY · WI-CORE-030 · HU17:** recuperar jobs sin `dedupeKey` (en particular de experimento) cuyo worker murió con el lock vencido, sin ejecución duplicada; reutiliza el latido por repetición de `WI-CORE-025` y respeta `JOBS_MAX_ATTEMPTS`. Origen: `IDEA-008`, a pedido del usuario (2026-10-09). Incluye el endurecimiento de la revisión de `WI-CORE-025` (guarda `RUNNING` en `updateRepetitionById`; limpiar `failureCode`/`failureMessage` al reanudar o completar).

El comportamiento vigente está en `spec.md` y `plan.md`; cualquier otra ejecución futura requiere una ST local y un WI registrado antes de comenzar.

Los checklists anteriores se conservan en Git, CHANGELOG y `harness/reports/open-task-triage-3.0.md`.
