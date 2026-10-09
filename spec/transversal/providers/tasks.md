# providers — Subtareas vigentes

- [x] **ST-CORE-030 · T-DONE · WI-CORE-023 · HU17:** RAG y `GENERALIST_AGENT` detrás de `LLMProvider` con configuración efectiva única, sin degradar razonamiento en silencio y con M1–M3 verificables (ESC-MOD-01).

- [ ] **ST-CORE-038 · T-IN_PROGRESS · WI-CORE-031 · HU17:** migrar las llamadas con herramientas del proveedor LLM a `/v1/responses` para permitir razonamiento activo en los experimentos OE5 (`gpt-6-luna` con herramientas solo admite `reasoning_effort=none` en `/v1/chat/completions`); pedido del usuario (2026-10-09).

Una futura migración de modelo/dimensionalidad permanece como `IDEA-003`.
Los checklists anteriores se conservan en Git, CHANGELOG y `harness/reports/open-task-triage-3.0.md`.
