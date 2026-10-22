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

## Adenda: enmienda del contrato (2026-10-21)

La verificación SDD (`wi-core-076-sdd-verification.md`) halló que DEC-EXP-004 (APPROVED; SYSTEM-2.13 §461 e INTEROP §379/§386) dice «esfuerzo máximo soportado», «el flujo de producto conserva su configuración actual» y «422 `REASONING_EFFORT_UNSUPPORTED`», lo que contradice las decisiones del usuario. El usuario eligió directamente: **«Enmendar contrato + aviso informativo»**. Se registra `DEC-EXP-005` (enmienda de DEC-EXP-004, APPROVED con las respuestas del 2026-10-21, `Blocks: NONE`), se actualiza la prosa de INTEROP §379/§386 y de SYSTEM, se sube la versión documental de los contratos afectados (SYSTEM e INTEROP; el número lo fija el implementer según el esquema de versiones y se informa) y se publica un Contract Sync informativo no incompatible. Sin cambio de rutas, DTO, enums ni códigos de error; `ExperimentModelConfigResponse.reasoningEffort` sigue siendo `string|null`; el 422 al crear solo sale ya por temperatura con razonamiento activo (`supportedEfforts=['none']`); un esfuerzo que la API rechace aparece en las repeticiones (`UNKNOWN`, 503 `LLM_PROVIDER_UNAVAILABLE` con detalle en log). El WI pasa a `contractImpact=true` y `publishesContract=true`; requiere `contract-reviewer`.

**Ajustes adicionales de la verificación SDD que entran en el alcance (sin decisión nueva):** F2 `LLM_REASONING_EFFORT='low'` en `app/vitest.config.e2e.ts` (los siete e2e arrancan `AppModule`); F3 `LLM_REASONING_EFFORT="low"` (no vacío) y `LLM_MODEL="gpt-6-luna"` en `.env.example` porque `local-php-env.mjs` lo copia a `.env`; el log de error del proveedor incluye modelo y esfuerzo; `gpt-4o-mini` deja de servir como `LLM_MODEL` (el flujo normal siempre envía `reasoning`); `minimal` está en la escala pero `gpt-6-luna` lo rechaza con 400 (se documenta).

**Orden de despliegue seguro (para Cross y el usuario):** primero añadir `LLM_MODEL=gpt-6-luna` y `LLM_REASONING_EFFORT=low` en Render sin quitar nada; después desplegar el código y verificar el arranque y una prueba corta; al final quitar `EXPERIMENT_LLM_MODEL`, `EXPERIMENT_LLM_REASONING_EFFORT` y `LLM_SUPPORTED_COMBINATIONS`; para evidencia oficial fijar `medium` antes de crear el experimento.
