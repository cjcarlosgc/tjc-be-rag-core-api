# WI-CORE-076 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** mensaje escrito directamente por el usuario en el chat de la sesión Core, el 2026-10-21 (tras responder de forma directa las cuatro decisiones del alcance).

Cita literal del usuario: «Apruebo WI-CORE-076. Acepto el cambio del flujo normal a gpt-6-luna (1), la falla en llamada sin la lista (2), LLM_REASONING_EFFORT obligatorio y explícito (3), conservar TEMPERATURE/MAX_OUTPUT_TOKENS/HEARTBEAT_STALE_MS (4) y aviso en log si queda una variable retirada (5). Continúa.»

## Alcance aprobado

1. **Flujo normal con `gpt-6-luna`:** el modelo del flujo normal pasa de `gpt-4o-mini` a `gpt-6-luna` (cambio de modelo y de costo declarado); default de `LLM_MODEL` = `gpt-6-luna` en `.env.example`; experimentos y flujo normal usan solo `LLM_MODEL` y `LLM_REASONING_EFFORT`.
2. **Sin lista de combinaciones:** se eliminan `EXPERIMENT_LLM_MODEL`, `EXPERIMENT_LLM_REASONING_EFFORT` y `LLM_SUPPORTED_COMBINATIONS`; un esfuerzo que la API rechace falla en la llamada con error explícito.
3. **`LLM_REASONING_EFFORT` obligatorio y explícito:** sin default en el código, fijado por cada entorno (`low` en pruebas, `medium` en evidencia oficial); el arranque falla con mensaje claro si falta o no está en la escala `none…max`.
4. **Se conservan** `EXPERIMENT_LLM_TEMPERATURE`, `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS` y `EXPERIMENT_HEARTBEAT_STALE_MS` sin cambios.
5. **Aviso en el log** al arrancar si siguen definidas `EXPERIMENT_LLM_MODEL`, `EXPERIMENT_LLM_REASONING_EFFORT` o `LLM_SUPPORTED_COMBINATIONS` (se ignoran y se avisa).

Cada `ExperimentRun` sigue guardando en `modelConfig` el modelo y el esfuerzo con que corrió, sin cambio de contrato ni de DTO. `WI-CORE-075` queda solo en documentación tras este WI. Sin push, PR ni merge; sin tag. La implementación espera el informe de la verificación SDD (en curso) y sigue sus detalles de diseño.
