# WI-CORE-075 — esfuerzo de prueba (low) vs esfuerzo de evidencia (medium) sobre gpt-6-luna (propuesta, en cola)
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


---

## ACTUALIZACIÓN (decisión del usuario relayada por cross, 2026-10-21): `gpt-5.4-nano` DESCARTADO

El texto de arriba (hechos y opciones) se conserva como historial de la propuesta anterior. Lo vigente:

- **Modelo único:** `gpt-6-luna` (el default de `EXPERIMENT_LLM_MODEL`, `DEC-EXP-004`). `gpt-5.4-nano` queda descartado.
- **Pruebas económicas** = `gpt-6-luna` con esfuerzo **low**. **Evidencia oficial** (piloto, confirmatorio OE5, OE2) = `gpt-6-luna` con esfuerzo **medium**, congelado por protocolo (tesis 3.3, Anexo K).
- Ya configurado en Render/.env por el usuario: `EXPERIMENT_LLM_MODEL=gpt-6-luna`, `EXPERIMENT_LLM_REASONING_EFFORT=low`; `LLM_SUPPORTED_COMBINATIONS` ya incluye `gpt-6-luna` con `low` y `medium`. No hace falta cambiar `LLM_SUPPORTED_COMBINATIONS` ni añadir un modelo.
- La distinción pasa a **«low = prueba, medium = evidencia» sobre el mismo modelo**: la documentación y la salvaguarda (B aviso, C marca persistida, D bloqueo) se deciden sobre el **esfuerzo** (`reasoning effort`), no sobre el modelo. Los experimentos `07b20829` y `924e38ab` (13/10, con `gpt-5.4-nano`) quedan solo como antecedente histórico.

### Propuesta revisada para decisión del usuario (sin asumir; nada se implementa sin su aprobación en el chat de Core)

**Parte 1 — documentación (solo texto):** en `spec/transversal/providers/` y en la spec de experimentos (feature 008) dejar la regla «`gpt-6-luna` low = prueba económica; `gpt-6-luna` medium = evidencia oficial congelada por protocolo; no se mezclan en una misma corrida de evidencia», con los valores de `EXPERIMENT_LLM_REASONING_EFFORT` y su relación con `LLM_SUPPORTED_COMBINATIONS`, y un ejemplo comentado en `.env.example` (hoy `EXPERIMENT_LLM_REASONING_EFFORT=""`, que significa «esfuerzo máximo común soportado»: hay que decidir si el default sigue vacío o pasa a `medium`).

**Parte 2 — salvaguarda sobre el esfuerzo (a elegir):**
- **A. Solo documentación** (Parte 1).
- **B. Aviso:** el log de arranque y el reporte del experimento advierten cuando el esfuerzo efectivo no es el de evidencia (`medium`); sin cambio de esquema ni de contrato. El `modelConfig` del `ExperimentRun` ya persiste la configuración efectiva (`LLMEffectiveConfig`), por lo que el reporte puede leerla.
- **C. Marca persistida:** indicador derivado en el `ExperimentRun` (p. ej. `evidenceEligible = esfuerzo == medium`); posible cambio aditivo del DTO y de contrato (Contract Sync a Console).
- **D. Bloqueo:** rechazar crear un experimento piloto/confirmatorio con esfuerzo distinto de `medium` (cambio de comportamiento; requiere definir «confirmatorio»).

Recomendación inicial del leader (a confirmar con el análisis SDD): Parte 1 + opción B; C solo si la marca debe viajar en los datos. Un solo WI activo: arranca cuando termine la cola (después de WI-CORE-074).
