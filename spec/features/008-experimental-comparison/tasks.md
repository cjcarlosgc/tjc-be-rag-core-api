# 008-experimental-comparison — Tareas

- [ ] `DEC-EXP-002` ya resuelta (`APROBADO`); implementar el agente generalista conforme al diseño en `spec.md`.
- [ ] GenerationStrategy `RAG|GENERALIST_AGENT`.
- [ ] GeneralistAgentGenerationStrategy con el set de herramientas read-only aprobado (listar/leer/grep/imports/TS language service), acotado al snapshot materializado y con tope de ~20 tool calls.
- [ ] Excluir `*.test.ts`/`*.spec.ts` del target actual de la vista de archivos del agente.
- [ ] Persistir trayectoria completa de tool calls (orden, argumentos, resultado resumido) como evidencia auditable.
- [ ] ExperimentRun/Result.
- [ ] Ejecución de 3x2 runs por target.
- [ ] Captura de tokens/costos/tiempos.
- [ ] Agregación y endpoint de resultados.
- [ ] Garantizar auto-repair OFF en experimento.
- [ ] Captura de tool calls/archivos inspeccionados/contexto del agente generalista (derivada de la trayectoria completa).
- [ ] Tests de aislamiento del snapshot, límites de exploración (tope de tool calls, paridad de presupuesto de tokens/timeout con RAG) y paridad experimental.

## Calidad

- [ ] Agregar/actualizar pruebas.
- [ ] Verificar manejo de errores.
- [ ] Verificar observabilidad mínima.
- [ ] Ejecutar lint/test/build.
- [ ] Registrar evidencia de revisión en `harness/reports/`.
