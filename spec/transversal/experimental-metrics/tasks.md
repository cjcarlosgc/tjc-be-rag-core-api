# experimental-metrics — Tareas

- [x] Schema metrics (`ExperimentRepetition`: compiled/executed/passed/valid/failureType, tiempos, tokens/costo, `retrievedChunks`/`selectedChunks`/`contextTokens` para RAG, `toolCalls`/`filesInspected`/`trajectory` para el agente).
- [x] Aggregator (`ExperimentsService.aggregateStrategy`: tasas, medias de tiempos/tokens/chunks/tool calls, media de `estimatedCost`, distribución de `failureType`).
- [x] Export/API para análisis (`GET /experiments/:id/results`).
- [ ] Coverage secundaria Sprint 4 si se aprueba.
- [ ] Investigar `DEC-MET-001` inmediatamente después del núcleo de Sprint 2 y solicitar decisión humana.
- [ ] Solo tras aprobación, crear un work item separado para mutation score/StrykerJS y sincronizar RAG Core, Sandbox y frontend.

## Calidad

- [x] Agregar/actualizar pruebas (`cost-calculator.spec.ts`, `experiments.service.spec.ts` — agregación).
- [x] Verificar manejo de errores (`EXPERIMENT_NOT_FOUND`, `EXPERIMENT_NOT_FINISHED`).
- [x] Verificar observabilidad mínima (ver `observability/tasks.md`: stage timings, `Logger.warn` por repetición fallida).
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/` (`008-experimental-comparison.md`).
