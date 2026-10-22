# WI-CORE-075 — modelo de prueba barato vs modelo de evidencia (propuesta, en cola)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: W-PLANNED.** Pedido por la sesión cross (decisión del usuario sobre el modelo barato). No interrumpe WI-CORE-074: la cola manda. **Nada se implementa ni se asume sin la aprobación del usuario en el chat de Core.**

## Hechos (de cross)

El usuario quiere usar `gpt-5.4-nano` con reasoning effort `none` (`EXPERIMENT_LLM_MODEL=gpt-5.4-nano`, `EXPERIMENT_LLM_REASONING_EFFORT=none`) en Render **solo** para pruebas simples o funcionales de bajo costo; **no** para obtener evidencia (piloto, confirmatorio OE5, OE2). La evidencia de tesis (3.3, Anexo K) exige configuración congelada por protocolo y modelo único; no se mezclan. Antecedente: los experimentos del 2026-10-13 `07b20829` y `924e38ab` ya usaron esa combinación en Render.

## Estado actual en el código (lectura)

`EXPERIMENT_LLM_MODEL` (default `gpt-6-luna`, `DEC-EXP-004`) y `EXPERIMENT_LLM_REASONING_EFFORT` en `app/src/config/env.validation.ts` y `app/src/providers/openai-llm.provider.ts`; las combinaciones válidas salen de `LLM_SUPPORTED_COMBINATIONS` (JSON `[{"model","efforts","toolEfforts"}]`); `.env.example` solo declara `gpt-6-luna`. Sin la combinación `gpt-5.4-nano`/`none` en `LLM_SUPPORTED_COMBINATIONS` los experimentos fallan de forma explícita.

## Propuesta para decisión del usuario (dos partes, sin asumir)

**Parte 1 — documentación (cambio solo de texto, sin código):** dejar en `spec/transversal/providers/` y en la spec de experimentos (feature 008) la distinción «modelo de prueba barato» vs «modelo de evidencia», la combinación `gpt-5.4-nano`/`none`, el valor que debe contener `LLM_SUPPORTED_COMBINATIONS` para que funcione (p. ej. `[{"model":"gpt-5.4-nano","efforts":["none"],"toolEfforts":["none"]}]`, a validar contra el proveedor), la regla «las corridas de evidencia usan un único modelo y configuración congelados por protocolo» y los dos experimentos de antecedente. Un ejemplo comentado en `.env.example`.

**Parte 2 — salvaguarda para que un experimento barato no se confunda con evidencia (a elegir):**
- **A. Solo documentación** (Parte 1): sin código; la disciplina queda en el protocolo.
- **B. Aviso en logs y reporte:** el reporte de resultados y el log de arranque advierten cuando el modelo/esfuerzo no coincide con el declarado para evidencia; sin cambio de esquema ni de contrato.
- **C. Marca persistida en el `ExperimentRun`:** un indicador (p. ej. `evidenceEligible` o clase de modelo) derivado de una lista configurable de modelos de evidencia; probablemente migración y cambio aditivo del DTO (contrato, Contract Sync a Console).
- **D. Bloqueo:** rechazar crear un experimento «confirmatorio/piloto» con un modelo fuera de la lista de evidencia (cambio de comportamiento; requiere aprobación y definir qué es «confirmatorio»).

Recomendación inicial del leader (a confirmar con el análisis SDD): Parte 1 + opción B; C solo si el usuario necesita que la marca viaje en los datos. Un solo WI activo: arranca cuando termine la cola (después de WI-CORE-074).
