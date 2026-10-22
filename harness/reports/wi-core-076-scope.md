# WI-CORE-076 — unificar la configuración del LLM (propuesta de alcance, en cola)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: W-PLANNED.** Pedido por la sesión cross por decisión del usuario. Cola: arranca cuando termine lo activo (hoy no hay WI activo; arranca cuando el usuario apruebe el alcance en el chat de Core). **Nada se implementa ni se asume sin esa aprobación.**

## Lo pedido

- Eliminar `EXPERIMENT_LLM_MODEL`, `EXPERIMENT_LLM_REASONING_EFFORT` y `LLM_SUPPORTED_COMBINATIONS`. Los experimentos y el flujo normal usan solo `LLM_MODEL` y `LLM_REASONING_EFFORT` (mismo modelo, mismo esfuerzo).
- `LLM_REASONING_EFFORT` explícito: si falta o no está en la escala (`none`…`max`), fallo de arranque con mensaje claro (hoy vacío = «máximo común soportado», ambiguo). Sin la lista de combinaciones, un esfuerzo que la API rechace falla en la llamada con error explícito.
- Cada `ExperimentRun` sigue guardando en `modelConfig` el modelo y esfuerzo con que corrió (configuración congelada por corrida, tesis 3.3/Anexo K). Sin cambio de contrato ni de DTO.
- Mantener el resto de `EXPERIMENT_*` que no sea modelo/esfuerzo (temperatura, tokens máx, heartbeat) salvo que el análisis diga otra cosa (preguntar, no asumir).
- Actualizar `.env.example`, spec y pruebas. Valores objetivo: `gpt-6-luna`; esfuerzo `low` en pruebas y `medium` en evidencia (el usuario decide si fija `medium` siempre).
- **WI-CORE-075 se reduce a documentación** (ya no hay dos configuraciones).

## Estado actual en el código (lectura previa, a verificar con el análisis SDD)

`app/src/config/env.validation.ts` declara `LLM_MODEL` (default `gpt-4o-mini`), `LLM_REASONING_EFFORT?`, `EXPERIMENT_LLM_MODEL` (default `gpt-6-luna`, `DEC-EXP-004`), `EXPERIMENT_LLM_REASONING_EFFORT?`, `EXPERIMENT_LLM_TEMPERATURE?`, `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS?` y `LLM_SUPPORTED_COMBINATIONS?` (JSON validado). `app/src/providers/openai-llm.provider.ts` usa `LLM_MODEL`/`LLM_REASONING_EFFORT` para el flujo de producto (l.72-74) y `EXPERIMENT_LLM_*` más `LLM_SUPPORTED_COMBINATIONS` (l.150-267) para experimentos; `reasoning-effort.scale.ts` define la escala. Ocho archivos de `app/src`/`app/test` mencionan estas variables.

## Puntos que el usuario debe decidir (no se asumen)

1. **Cambio de modelo del flujo normal.** Hoy el flujo de producto (generación de pruebas de un AnalysisRun) usa `LLM_MODEL` con default `gpt-4o-mini`; con la unificación pasa a usar el mismo modelo que los experimentos (`gpt-6-luna`). Es un cambio de comportamiento y de costo del flujo normal. ¿Se acepta? ¿Cuál es el default de `LLM_MODEL` en `.env.example`: `gpt-6-luna`?
2. **`toolEfforts`.** `LLM_SUPPORTED_COMBINATIONS` también lista, por modelo, los esfuerzos válidos para el brazo con herramientas (`toolEfforts`) y de ahí sale el «esfuerzo efectivo común a ambos brazos». Sin la lista, ¿el esfuerzo efectivo es simplemente `LLM_REASONING_EFFORT` para ambos brazos, y si la API rechaza esa combinación con herramientas falla en la llamada con error explícito (lo pedido)? El análisis SDD debe confirmar qué se pierde.
3. **Valor de `LLM_REASONING_EFFORT`.** ¿Sin default (obligatorio, arranque falla si falta) y el usuario fija `low` o `medium` por entorno (low en pruebas, medium en evidencia)? ¿O se fija `medium` siempre?
4. **Resto de `EXPERIMENT_*`:** ¿se conservan `EXPERIMENT_LLM_TEMPERATURE`, `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS` y `EXPERIMENT_HEARTBEAT_STALE_MS`? (propuesta: sí, sin cambio).
5. **Despliegue:** al cerrar el WI el usuario quitará las tres variables de Render; con las tres presentes y sin `LLM_REASONING_EFFORT` el arranque debe fallar de forma clara. ¿Se avisa (warning) si todavía están definidas las variables retiradas, o se ignoran en silencio?

## Cambio de comportamiento a declarar

Arranque más estricto (falla sin `LLM_REASONING_EFFORT` válido) y flujo normal con el modelo unificado. Sin cambio de contrato ni de DTO (`modelConfig` ya persiste modelo y esfuerzo por corrida).
