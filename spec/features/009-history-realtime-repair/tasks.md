# 009-history-realtime-repair — Tareas

- [x] Historial paginado (HU20: `GET /project-versions/:id/test-runs?cursor&limit` → `Page<TestRunSummaryResponse>`, orden `createdAt` desc; primera implementación real del patrón `Page<T>` del contrato, agregado a `INTEROP-1.2`).
- [x] WebSocket progress events (HU21/HU22: `RealtimeGateway` global vía Socket.IO, salas por id (`project-version:{id}`, `test-run:{id}`), eventos `project-version:update`/`test-run:update` reusando los DTOs HTTP existentes; `IndexingJobHandler` y `TestGenerationJobHandler` emiten en cada transición de estado. Complemento del polling HTTP, nunca reemplazo. Contrato agregado a `INTEROP-1.3`).
- [x] RepairContext/RepairService (HU23: `RepairContext` — test que falló, tipo de fallo/resumen, `RunnerFacts` completo incluye stdout/stderr relevante por caso, y el `GenerationContext` original; `RepairService` separado del generation first-shot, arma un prompt de reparación vía `PromptBuilder.buildRepair` y delega en el mismo `LLMProvider`).
- [x] maxAttempts config (`GENERATION_MAX_REPAIR_ATTEMPTS`, default 2, `0` deshabilita la autorreparación).
- [ ] retry manual (HU24, Sprint 4, fuera de alcance por ahora).
- [x] tests de no interacción con experimental mode (`ExperimentJobHandler` no referencia `RepairService`; test dedicado confirma que un resultado `INVALID` en cualquiera de las 6 repeticiones no dispara reintento ni repair loop, exactamente 1 llamada al Sandbox por repetición).

## Calidad

- [ ] Agregar/actualizar pruebas.
- [ ] Verificar manejo de errores.
- [ ] Verificar observabilidad mínima.
- [ ] Ejecutar lint/test/build.
- [ ] Registrar evidencia de revisión en `harness/reports/`.
