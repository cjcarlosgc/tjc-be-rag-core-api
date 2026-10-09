# 004 — Subtareas vigentes

- [x] **ST-CORE-006 · T-DONE · WI-CORE-006 · HU05, HU15, HU17:** registrar y exponer la decisión completa de cada candidato RAG, incluido descarte por score mínimo, top-K y presupuesto de tokens; revisar contrato y probar trazabilidad.
- [x] **ST-CORE-028 · T-DONE · WI-CORE-021 · HU05, HU07, HU10:** `GenerationContext.functionalRules` separado del código y con procedencia; recuperación determinista de reglas `ACTIVE` aplicables; pruebas de que Sandbox nunca recibe reglas funcionales.
- [ ] **ST-CORE-029 · T-IN_PROGRESS · WI-CORE-022 · HU05, HU17:** comparación de retrieval OE2 `SE` vs `SEM` según INTEROP-2.7 §6.15 (endpoints asíncronos, candidatos con scores y relaciones, `retrieval_id` por modo, P@k/R@k solo con verdad de terreno externa); sin LLM, FK, Sandbox ni publicación.
- [ ] **ST-CORE-035 · T-BACKLOGGED · WI-CORE-028 · HU05, HU17:** relaciones estructurales PHP R-PHP1–R-PHP5 en `SE`; diferida hasta cerrar `WI-CORE-013` y la coordinación con Sandbox.

La investigación test-aware permanece como `IDEA-002` y `DEC-RAG-001`; no es parte de este WI.
