# 009-history-realtime-repair — Tareas

- [x] Historial paginado (HU20: `GET /project-versions/:id/test-runs?cursor&limit` → `Page<TestRunSummaryResponse>`, orden `createdAt` desc; primera implementación real del patrón `Page<T>` del contrato, agregado a `INTEROP-1.2`).
- [x] WebSocket progress events (HU21/HU22: `RealtimeGateway` global vía Socket.IO, salas por id (`project-version:{id}`, `test-run:{id}`), eventos `project-version:update`/`test-run:update` reusando los DTOs HTTP existentes; `IndexingJobHandler` y `TestGenerationJobHandler` emiten en cada transición de estado. Complemento del polling HTTP, nunca reemplazo. Contrato agregado a `INTEROP-1.3`).
- ~~RepairContext/RepairService.~~ **Descartado (decisión definitiva de arquitectura):** una generación validada = una ejecución en el Sandbox; sin autorreparación automática ni reintento de corrección vía LLM. Se implementó y se revirtió en esta misma sesión (ver `CHANGELOG.md`); no es una evolución futura pendiente, es alcance definitivo.
- ~~maxAttempts config.~~ **Descartado**, mismo motivo.
- [x] retry manual (HU24: `POST /test-runs/:id/targets/:targetId/retry` → `202 TargetRetryAcceptedResponse`. Reintenta desde cero un target `INVALID`/`FAILED` a pedido del usuario, sin ningún mecanismo de corrección automática; `RetryTargetJobHandler` reprocesa exactamente ese target, actualiza el `TargetRunResult` existente en su lugar y reajusta `validTargets`/`invalidTargets`/`failedTargets`/`status` del run vía `applyRetryOutcome`. Contrato agregado a `INTEROP-1.4`).
- ~~tests de no interacción con experimental mode.~~ **N/A**: sin autorreparación no hay nada de qué aislar a HU19.

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
