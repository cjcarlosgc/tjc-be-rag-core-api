# providers — Subtareas vigentes

- [x] **ST-CORE-030 · T-DONE · WI-CORE-023 · HU17:** RAG y `GENERALIST_AGENT` detrás de `LLMProvider` con configuración efectiva única, sin degradar razonamiento en silencio y con M1–M3 verificables (ESC-MOD-01).

- [x] **ST-CORE-038 · T-DONE · WI-CORE-031 · HU17:** migrar las llamadas con herramientas del proveedor LLM a `/v1/responses` para permitir razonamiento activo en los experimentos OE5 (`gpt-6-luna` con herramientas solo admite `reasoning_effort=none` en `/v1/chat/completions`); pedido del usuario (2026-10-09).

Una futura migración de modelo/dimensionalidad permanece como `IDEA-003`.
Los checklists anteriores se conservan en Git, CHANGELOG y `harness/reports/open-task-triage-3.0.md`.
- [x] **ST-CORE-100 · T-DONE · WI-CORE-089 · HU10, HU15:** puerto `LLMProvider` neutral (`provider`/`endpoint` como `string`, `parseEffectiveConfig` sin rechazar otro proveedor, redacción genérica de credenciales) sin cambio del comportamiento de OpenAI; alcance aprobado por el usuario el 2026-10-24 (WI-A de ESC-MOD-01).
- [x] **ST-CORE-101 · T-DONE · WI-CORE-089 · HU10, HU15:** adaptador falso reutilizable de `LLMProvider`, suite de contrato CT-09-A3 (OpenAI y falso) y test de arquitectura CT-09-A4 (sin SDK de proveedor fuera de `app/src/providers`).
- [x] **ST-CORE-102 · T-DONE · WI-CORE-089 · HU10, HU15:** prosa contractual neutral (INTEROP-2.21, SYSTEM-2.16), enmienda de `providers/spec.md`, corrección de `plan.md:35`, versiones, README, CHANGELOG y decisión D-14 en la propuesta CT.
- [x] **ST-CORE-103 · T-DONE · WI-CORE-089 · HU10, HU15:** Contract Sync a Integration, Sandbox y Console (evento `C-PENDING`; Core no edita otros repositorios).
