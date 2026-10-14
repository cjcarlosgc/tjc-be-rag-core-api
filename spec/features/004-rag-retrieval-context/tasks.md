# 004 — Subtareas vigentes

- [x] **ST-CORE-006 · T-DONE · WI-CORE-006 · HU05, HU15, HU17:** registrar y exponer la decisión completa de cada candidato RAG, incluido descarte por score mínimo, top-K y presupuesto de tokens; revisar contrato y probar trazabilidad.
- [x] **ST-CORE-028 · T-DONE · WI-CORE-021 · HU05, HU07, HU10:** `GenerationContext.functionalRules` separado del código y con procedencia; recuperación determinista de reglas `ACTIVE` aplicables; pruebas de que Sandbox nunca recibe reglas funcionales.
- [x] **ST-CORE-029 · T-DONE · WI-CORE-022 · HU05, HU17:** comparación de retrieval OE2 `SE` vs `SEM` según INTEROP-2.7 §6.15 (endpoints asíncronos, candidatos con scores y relaciones, `retrieval_id` por modo, P@k/R@k solo con verdad de terreno externa); sin LLM, FK, Sandbox ni publicación.
- [x] **ST-CORE-035 · T-DONE · WI-CORE-028 · HU05, HU17:** relaciones estructurales PHP R-PHP1–R-PHP5 en `SE`; diferida hasta cerrar `WI-CORE-013` y la coordinación con Sandbox.

La investigación test-aware permanece como `IDEA-002` y `DEC-RAG-001`; no es parte de este WI.
- [x] **ST-CORE-064 · T-DONE · WI-CORE-057 · HU05, HU15, HU17:** sección de dependencias con FQCN (tipos del constructor y de la firma del método, verificados contra el índice) en el contexto de generación RAG de PHP y en la traza, sin cambiar el ranking, `topK`, pesos, relaciones R-PHP1..5 ni métricas; `DEC-RAG-001` sigue `PENDING`.
- [ ] **ST-CORE-065 · T-IN_PROGRESS · WI-CORE-058 · HU05, HU15, HU17:** marcar `final` (clases `final`/`final readonly` y enumeraciones) en las entradas de la sección de dependencias PHP, desde el chunk de declaración del índice, sin cambiar el ranking ni R-PHP; si no se puede determinar no se afirma.
