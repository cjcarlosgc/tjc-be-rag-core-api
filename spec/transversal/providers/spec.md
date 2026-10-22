# providers — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** capacidad técnica transversal

## Objetivo

Desacoplar LLM y embeddings de un proveedor concreto.

## Reglas y comportamiento

- La lógica de indexación/retrieval depende de `EmbeddingProvider`, no del SDK o los DTO de un proveedor concreto.
- `text-embedding-3-small` queda aprobado como modelo definitivo de V1, con dimensionalidad `1536`. Es una elección pragmática para desbloquear Sprint 2, no una conclusión de superioridad para code retrieval.
- `voyage-code-4` se conserva documentado como candidato para una reevaluación futura con evidencia del experimento; no bloquea nada mientras tanto.
- PostgreSQL + pgvector en Supabase permanece aprobado independientemente del proveedor/modelo elegido.

### DEC-EMB-001 — Modelo definitivo de embeddings

**Estado:** APROBADO

**Resolución:** se mantiene `text-embedding-3-small` como modelo definitivo de V1, dimensionalidad `1536` sin cambios respecto al provisional. `voyage-code-4` sigue documentado como candidato para una reevaluación posterior si el experimento aporta evidencia que lo justifique; no es una decisión pendiente ni bloquea nada.

El implementador no debe reabrir la comparación de embeddings como una nueva pregunta de investigación de la tesis sin una decisión humana explícita que lo pida.


## ESC-MOD-01 — paridad de `LLMProvider` (SDD 2026-10-08; implementación pendiente)

ESC-MOD-01 evalúa solo `LLMProvider`; no incluye embeddings. RAG y `GENERALIST_AGENT` invocan al LLM a través de la abstracción `LLMProvider`; el SDK de OpenAI no se filtra al dominio ni a los servicios de generación o del agente. Cambiar de proveedor no altera retrieval, Sandbox ni contratos HTTP, y no hay selector permanente en la interfaz. Ambos brazos resuelven una única configuración efectiva (proveedor, modelo y versión, esfuerzo de razonamiento y parámetros comunes); el razonamiento no se degrada en silencio. Métricas de cierre: M1 = 0 archivos fuera del adaptador y la configuración permitidos; M2 = 0 cambios de contrato; M3 = 100 % de pruebas aplicables en verde. No se crea `arch-v1.0` ni se inventa un segundo proveedor concreto. Implementación: `WI-CORE-023`.

## WI-CORE-031 — llamadas del proveedor LLM por `/v1/responses` (aprobado 2026-10-09)

Todas las llamadas del adaptador OpenAI (experimentos y producto) usan `/v1/responses`, sin estado (`store=false`, sin `previous_response_id`) y devolviendo los ítems de razonamiento cifrados en cada turno. El parámetro `reasoning` se omite en modelos sin razonamiento y un esfuerzo que la API no admite falla en la llamada con error explícito (WI-CORE-076, véase abajo). El endpoint efectivo es interno (`modelConfig`); no cambia el contrato. Detalle en `plan.md`.

## WI-CORE-076 — configuración única del LLM (DEC-EXP-005, aprobado 2026-10-21)

- El flujo de producto y los experimentos usan una única configuración: `LLM_MODEL` (por defecto `gpt-6-luna`) y `LLM_REASONING_EFFORT`. Los dos brazos de un experimento usan el mismo modelo y el mismo esfuerzo, que se persisten en `modelConfig` de cada corrida.
- `LLM_REASONING_EFFORT` es obligatorio y no tiene valor por defecto en el código. El arranque falla si falta, está vacío o no pertenece a `none`, `minimal`, `low`, `medium`, `high`, `xhigh` o `max`. Cada entorno lo fija: `low` en pruebas y `medium` en evidencia oficial.
- No hay lista de combinaciones modelo/esfuerzo. Un esfuerzo que la API rechace falla en la llamada con error explícito; no se degrada ni se sustituye por otro valor.
- `422 REASONING_EFFORT_UNSUPPORTED` al crear un experimento solo ocurre por temperatura incompatible con razonamiento activo.
- Las variables `EXPERIMENT_LLM_MODEL`, `EXPERIMENT_LLM_REASONING_EFFORT` y `LLM_SUPPORTED_COMBINATIONS` quedan retiradas: si siguen definidas se ignoran y el arranque registra un aviso con sus nombres (nunca sus valores), sin bloquear.
- Se conservan `EXPERIMENT_LLM_TEMPERATURE`, `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS` y `EXPERIMENT_HEARTBEAT_STALE_MS`.
- Sin cambio de rutas, DTO, enums ni códigos de error. Detalle en `plan.md`.

## WI-CORE-075 — esfuerzo de prueba y esfuerzo de evidencia (solo documentación, aprobado 2026-10-21)

- **Un solo modelo, dos usos por esfuerzo.** El modelo es `gpt-6-luna` (`LLM_MODEL`). El esfuerzo lo fija el entorno con `LLM_REASONING_EFFORT`: **`low` para pruebas económicas** (verificar el flujo, depurar, corridas funcionales de bajo costo) y **`medium` para evidencia oficial** (piloto, confirmatorio OE5 y OE2), congelado por protocolo (tesis 3.3 y Anexo K, citados solo por referencia).
- **No se mezclan.** Una corrida de evidencia usa una única configuración (modelo y esfuerzo) congelada durante todo el protocolo. Cambiar `LLM_REASONING_EFFORT` en el entorno entre corridas produce otra configuración: la que identifica una corrida es la que su `ExperimentRun` guardó en `modelConfig` (`model` y `reasoningEffort`), no el valor actual del entorno.
- **Sin salvaguarda automática.** No hay marca de «evidencia» en el `ExperimentRun`, ni aviso, ni bloqueo por esfuerzo: la disciplina es del protocolo y del operador. Antes de crear un experimento de evidencia se verifica que el entorno tenga `LLM_REASONING_EFFORT=medium`, y después se comprueba que el esfuerzo del Run resultante sea `medium`: el campo `model.reasoningEffort` de la respuesta de estado del experimento (`GET /experiments/{id}`), que expone el `modelConfig` persistido. Tras cambiar el esfuerzo conviene una corrida corta, porque un esfuerzo que la API rechace no impide crear el experimento y sus repeticiones fallan como `UNKNOWN`.
- **Descartado.** `gpt-5.4-nano` queda descartado. Los experimentos `07b20829` y `924e38ab` (2026-10-13) se ejecutaron con esa combinación (`gpt-5.4-nano`, esfuerzo `none`) y quedan solo como antecedente histórico: no son comparables con corridas `gpt-6-luna` y no sustituyen la evidencia oficial.
- Sin cambio de código, rutas, DTO, enums ni códigos de error.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
