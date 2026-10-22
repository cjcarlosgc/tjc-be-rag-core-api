# WI-CORE-076 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: configuración única del LLM según el alcance aprobado por el usuario el 2026-10-21 (cinco puntos y enmienda del contrato). Commits: implementación `03b4da4`, correcciones del ciclo 1 `3d2383e`, publicación `6a89302`.

- **Configuración:** el flujo normal y los experimentos usan solo `LLM_MODEL` (default `gpt-6-luna`; el flujo normal deja `gpt-4o-mini`) y `LLM_REASONING_EFFORT` obligatorio sin default (arranque falla si falta, está vacío o fuera de `none…max`); `LLM_MODEL` vacío también falla el arranque; `EXPERIMENT_LLM_MODEL`, `EXPERIMENT_LLM_REASONING_EFFORT` y `LLM_SUPPORTED_COMBINATIONS` dejan de leerse y generan un único aviso con solo sus nombres; se conservan `EXPERIMENT_LLM_TEMPERATURE`, `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS` y `EXPERIMENT_HEARTBEAT_STALE_MS`; `modelConfig` del ExperimentRun sigue persistiendo modelo y esfuerzo (tesis 3.3/Anexo K).
- **Esfuerzo rechazado por la API:** falla en la llamada como `LLMProviderUnavailableError` con `externalFailure=false` (sin el reintento de trial de la tesis 3.3.8; la repetición queda `UNKNOWN`); el log incluye modelo y esfuerzo.
- **Contrato:** `DEC-EXP-005` (APPROVED, `Blocks: NONE`) enmienda DEC-EXP-004; SYSTEM-2.14 e INTEROP-2.19 documentales, sin cambio de rutas, DTO, enums, ErrorCode ni esquemas.
- **Revisión independiente (`reviewer`):** APPROVED, ciclo 1 (8 de 8 mutaciones detectadas; 9 e2e pasan también sin variables LLM en `.env`) y ciclo 2 de 2 sobre la corrección de `LLM_MODEL` vacío (`wi-core-076-independent-review.md`).
- **Revisión contractual (`contract-reviewer`):** APPROVED, sin bloqueantes; F1 (paréntesis en INTEROP §1) corregido (`wi-core-076-contract-review.md`).
- **Contract Sync publicado:** `CS-CORE-20261021-004` (console, github-integration, sandbox; informativo, `breaking: false`); ver `wi-core-076-contract-sync-publication.md`.
- `retryLimitRespected`: 2 de 2 ciclos de revisión usados; no se supera el máximo.
- Evidencia técnica: `wi-core-076-technical-checks.md` (2618 tests unitarios, 259 e2e).

## Para el despliegue en Render (orden seguro)

1. Añadir `LLM_MODEL=gpt-6-luna` y `LLM_REASONING_EFFORT=low` sin quitar nada.
2. Desplegar el código y verificar el arranque y una prueba corta (un esfuerzo que la API rechace aparece en las repeticiones `UNKNOWN`, con el detalle solo en el log).
3. Quitar `EXPERIMENT_LLM_MODEL`, `EXPERIMENT_LLM_REASONING_EFFORT` y `LLM_SUPPORTED_COMBINATIONS`.
4. Para evidencia oficial, fijar `LLM_REASONING_EFFORT=medium` antes de crear el experimento (congelado por protocolo).
Si se despliega el código antes de fijar `LLM_REASONING_EFFORT`, el arranque falla con un mensaje claro. `gpt-4o-mini` ya no sirve como `LLM_MODEL` (el flujo normal siempre envía razonamiento).

## Observaciones no bloqueantes

- `app/.env` local (ignorado por git; no se editó) tiene un modelo distinto de `gpt-6-luna`, `LLM_REASONING_EFFORT` en `high` y las tres variables retiradas: corregirlo a mano.
- Un esfuerzo rechazado ya no impide crear el experimento (sus seis repeticiones fallan como `UNKNOWN`); conviene una prueba corta tras cambiar `LLM_REASONING_EFFORT`.
- El flujo normal con `gpt-6-luna` y razonamiento no se ha medido en turnos reales.
- Console: el texto base del 422 menciona modelo/esfuerzo aunque ahora solo sale por temperatura (mejora opcional de mensaje).
- `tsc --noEmit` mantiene 52 errores preexistentes en specs y `test/support` ajenos a este WI.

Siguiente en la cola: WI-CORE-075 (solo documentación de low=prueba, medium=evidencia). Sin push, PR ni merge; sin tag.
