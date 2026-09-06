# 009-history-realtime-repair — Tareas

- [x] Historial paginado (HU20: `GET /project-versions/:id/test-runs?cursor&limit` → `Page<TestRunSummaryResponse>`, orden `createdAt` desc; primera implementación real del patrón `Page<T>` del contrato, agregado a `INTEROP-1.2`).
- [ ] WebSocket progress events.
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
