# WI-CORE-076 — implementación: configuración única del LLM
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high

Informe del implementer (transcrito por el leader). Alcance aprobado por el usuario: `wi-core-076-scope-approval.md` (con la enmienda del contrato).

## Qué cambia

- **Resolución única:** nuevo `app/src/providers/llm-settings.ts` con `DEFAULT_LLM_MODEL='gpt-6-luna'` y `resolveLlmSettings(configService) → {model, reasoningEffort}`, usada por `generate` sin config y por `resolveEffectiveConfig` (conserva su nombre; `LLMEffectiveConfig` no cambia de forma; `endpoint:'responses'` y `modelVersion` se conservan).
- **Eliminado:** `DEFAULT_EXPERIMENT_MODEL`, `LLMSupportedCombination`, `assertSupported`, `supportedEfforts`, `findCombination`, `supportedCombinations`, `highestEffort`, el fallback `gpt-4o-mini`, el código `REASONING_EFFORT_UNSUPPORTED` de `LLMConfigurationError` y su rama en `experiments.service.ts`. Se mantiene `ErrorCode.REASONING_EFFORT_UNSUPPORTED` para la guarda de temperatura (422 con `supportedEfforts=['none']`).
- **Entorno:** `LLM_MODEL` por defecto `gpt-6-luna`; `LLM_REASONING_EFFORT` sin default, validado por `validateLlmSettings` (valor guardado sin espacios). Eliminadas `EXPERIMENT_LLM_MODEL`, `EXPERIMENT_LLM_REASONING_EFFORT` y `LLM_SUPPORTED_COMBINATIONS`; conservadas `EXPERIMENT_LLM_TEMPERATURE`, `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS` y `EXPERIMENT_HEARTBEAT_STALE_MS`.
- **Mensajes de arranque (exactos):** falta o vacío: `Configuración de entorno inválida: LLM_REASONING_EFFORT es obligatorio y no tiene valor por defecto. Defínalo con uno de: none, minimal, low, medium, high, xhigh, max (low en pruebas, medium en evidencia oficial).` Fuera de escala: `Configuración de entorno inválida: LLM_REASONING_EFFORT="<valor recortado a 40 caracteres>" no es un esfuerzo válido; valores válidos: none, minimal, low, medium, high, xhigh, max.`
- **Aviso de variables retiradas:** `retiredLlmVariablesIn(config)` y un único `Logger('EnvValidation').warn` al final de `validateEnv`, solo nombres (incluso con valor vacío), nunca valores, sin bloquear el arranque: `Variables de LLM retiradas (WI-CORE-076): <nombres> siguen definidas y se IGNORAN. Los experimentos y el flujo normal usan LLM_MODEL y LLM_REASONING_EFFORT. Elimínelas del entorno.`
- **Proveedor:** el log de error incluye modelo y esfuerzo (`Fallo al generar con el modelo "X" y esfuerzo "Y": <mensaje>`); un 400 por esfuerzo rechazado es `LLMProviderUnavailableError` con `externalFailure=false` (el handler no reintenta: tesis 3.3.8).
- **Config y ejemplo:** `app/vitest.config.e2e.ts` con `LLM_REASONING_EFFORT='low'` (los siete e2e arrancan `AppModule`); `.env.example` con `LLM_MODEL="gpt-6-luna"` y `LLM_REASONING_EFFORT="low"` (no vacío), comentarios sobre la escala y sin las tres variables retiradas.

## Contrato y documentación (enmienda aprobada por el usuario)

SYSTEM-2.14 (fecha 2026-10-21) y INTEROP-2.19 (compatible con SYSTEM-2.14): `DEC-EXP-005` APPROVED (`Blocks: NONE`) registrada tras DEC-EXP-004, con nota de enmienda en esta y entrada en «Regla de compatibilidad»; §1 y §6.5.1 de INTEROP actualizadas (esfuerzo único, 422 solo por temperatura, fallo de la API visible en las repeticiones) y la precedencia PHP ajustada. Actualizados `spec/README.md`, `spec/transversal/providers/{spec,plan}.md`, `spec/features/008-experimental-comparison/{plan,tasks}.md` (solo la descripción de ST-CORE-083) y `CHANGELOG.md`. Las menciones históricas a INTEROP-2.18 (§4.1, §6.6, `realtime-events.schema.json`, feature 013, `spec/transversal/errors`) se mantienen. `github-integration-contract.md` no se toca. WI-CORE-075 no se hace aquí.

## Pruebas y evidencia (desde `app/`, Node 22)

| Comando | Resultado |
|---|---|
| `pnpm lint` / `pnpm lint:types` | OK |
| `pnpm build` | OK |
| `pnpm contracts:check` | OK |
| `pnpm test` | 157 archivos pasan, 7 omitidos; 2615 tests pasan, 104 omitidos (antes 2621: −12 en `openai-llm.provider.spec`, +6 en `env.validation.spec`, +1 en `experiments.model-config.spec`, −1 en `experiments.service.spec`) |
| `pnpm test:e2e` | 9 archivos, 259 tests pasan |
| `node scripts/sdd-check.mjs` | OK |

Pruebas nuevas o reescritas: arranque falla sin `LLM_REASONING_EFFORT`, vacío y fuera de escala (mensaje exacto) y acepta los siete valores; recorte a 40 caracteres; aviso de retiradas (nombres, una vez, sin valores, sin bloquear); producto y experimentos usan el mismo modelo y esfuerzo; `modelConfig` persiste modelo y esfuerzo; 400 de la API como fallo no externo con log de modelo y esfuerzo.

## Desvíos y riesgos residuales

- `resolveLlmSettings` lanza `Error` si el esfuerzo no es válido en ejecución (defensa en profundidad; no estaba en el diseño).
- El aviso de retiradas sale al final de `validateEnv`: si el arranque falla por otra causa, no aparece.
- `LLM_MODEL=""` pasa la validación (`@IsString`) y mandaría un modelo vacío; fuera de alcance, riesgo residual.
- `app/.env` local (ignorado por git; no se editó ni se leyó su contenido sensible) tiene `LLM_MODEL` con un nombre de modelo distinto de `gpt-6-luna`, `LLM_REASONING_EFFORT` en `high` y las tres variables retiradas; con el código nuevo el arranque local avisa y usa ese modelo. La persona debe corregirlo.
- El flujo normal con `gpt-6-luna` y razonamiento no se ha medido en turnos reales.
- `tsc --noEmit`: 52 errores preexistentes en specs y `test/support` ajenos a este WI.
