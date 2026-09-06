# 009-history-realtime-repair — Tareas

- [x] Historial paginado (HU20: `GET /project-versions/:id/test-runs?cursor&limit` → `Page<TestRunSummaryResponse>`, orden `createdAt` desc; primera implementación real del patrón `Page<T>` del contrato, agregado a `INTEROP-1.2`).
- [x] WebSocket progress events (HU21/HU22: `RealtimeGateway` global vía Socket.IO, salas por id (`project-version:{id}`, `test-run:{id}`), eventos `project-version:update`/`test-run:update` reusando los DTOs HTTP existentes; `IndexingJobHandler` y `TestGenerationJobHandler` emiten en cada transición de estado. Complemento del polling HTTP, nunca reemplazo. Contrato agregado a `INTEROP-1.3`).
- [ ] RepairContext/RepairService.
- [ ] maxAttempts config.
- [ ] retry manual.
- [ ] tests de no interacción con experimental mode.

## Calidad

- [ ] Agregar/actualizar pruebas.
- [ ] Verificar manejo de errores.
- [ ] Verificar observabilidad mínima.
- [ ] Ejecutar lint/test/build.
- [ ] Registrar evidencia de revisión en `harness/reports/`.
