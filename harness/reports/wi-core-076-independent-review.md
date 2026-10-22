# WI-CORE-076 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Commit revisado: `03b4da4` (rama `feature/jean`). Revisor distinto del implementer (`implementer-high`). La prosa de SYSTEM-2.14/INTEROP-2.19 la revisa el contract-reviewer en paralelo y queda fuera de este informe.

## Veredicto: APPROVED (con 1 hallazgo menor opcional)

## Verificaciones

1. **Resolución única.** `resolveLlmSettings` (`app/src/providers/llm-settings.ts`) la usan `generate` sin config y `resolveEffectiveConfig`. `generateWithTools` usa exactamente el `config` recibido (el agente lo obtiene de `resolveEffectiveConfig`/`modelConfig`). Producto y experimentos comparten modelo y esfuerzo (test "sends the same model and effort on the product path and on the experiment path"). Grep en `app/src`, `app/test`, `scripts`, `.github`, `app/package.json` y `.env.example`: `EXPERIMENT_LLM_MODEL`, `EXPERIMENT_LLM_REASONING_EFFORT` y `LLM_SUPPORTED_COMBINATIONS` solo aparecen en la lista de variables retiradas (`env.validation.ts:352-354`), en tests del aviso y en el comentario de `.env.example`. Ningún camino de código las lee. `modelConfig` sigue persistiendo el `LLMEffectiveConfig` completo, con modelo y esfuerzo efectivos. El DTO `ExperimentModelConfigResponse` no está en el diff.
2. **Arranque.** `validateLlmSettings` falla sin `LLM_REASONING_EFFORT`, vacío o solo espacios, y fuera de escala (incluye `HIGH`, sensible a mayúsculas). Acepta los 7 valores y recorta espacios. Los mensajes son claros, no imprimen secretos y el valor inválido se recorta a 40 caracteres. El aviso de variables retiradas sale una vez por invocación de `validateEnv`, solo con nombres, sin valores (test lo comprueba) y no bloquea. Nest llama a `validate` una sola vez en `ConfigModule.forRoot`, por lo que no se duplica en la app; en tests el aviso se emite por cada llamada directa, lo cual es inocuo.
3. **Proveedor.** Un 400 es `LLMProviderUnavailableError` con `externalFailure=false` (`isExternalProviderFailure` solo marca conexión, 429 y 5xx). `experiment-job.handler.ts:426` reintenta solo con `externalFailure`, así que no hay reintento en RAG ni en el agente (ambos pasan por `createResponse`). El log incluye modelo y esfuerzo y no incluye la API key ni el prompt (solo `error.message` del SDK, comportamiento previo). La guarda de temperatura se conserva: 422 con `supportedEfforts=['none']`.
4. **Compatibilidad.** Los 9 e2e (259 tests) pasan. También pasan con `app/.env` sin variables `LLM_*` ni `EXPERIMENT_LLM_*` (restaurado y verificado con `diff`), porque `vitest.config.e2e.ts` fija `LLM_REASONING_EFFORT=low`. `local-php-env.mjs` y `ci.yml` no referencian las variables retiradas. CI corre `pnpm test` (unit), que no arranca `AppModule`, y pasa. `app/.env` está ignorado por git y no aparece en `git status`.
5. **Pruebas.** Hice 8 mutaciones, todas detectadas, y restauré con `git checkout -- src`:
   - M1: aceptar esfuerzo vacío → falla 1 test.
   - M2: el aviso imprime valores → fallan 2 tests.
   - M3: fallback a `EXPERIMENT_LLM_MODEL` en el proveedor → falla 1 test.
   - M4: no persistir el esfuerzo en `resolveEffectiveConfig` → fallan 5 tests.
   - M5: 400 como `externalFailure=true` → fallan 2 tests.
   - M6: quitar la guarda de temperatura → fallan 3 tests.
   - M7: log sin esfuerzo → falla 1 test.
   - M8: quitar la comprobación de esfuerzo en runtime → fallan 2 tests.
6. **Alcance.** Sin cambios en DTO, rutas, enums ni códigos. `ErrorCode.REASONING_EFFORT_UNSUPPORTED` se mantiene para la guarda de temperatura. Solo se retira el código interno `REASONING_EFFORT_UNSUPPORTED` de `LLMConfigurationErrorCode` y su rama en `experiments.service.ts`; el error es interno y no hay consumidor externo (grep sin otros usos). El efecto observable es que un esfuerzo no admitido ya no da 422 al crear, y eso está declarado en la enmienda aprobada y en INTEROP. Sin secretos en el commit.

## Findings

- **F1 (menor, opcional)**: `app/src/config/env.validation.ts` (campo `LLM_MODEL`, `@IsString()`) y `app/src/providers/llm-settings.ts:17`. `LLM_MODEL=""` pasa la validación (`@IsString` acepta vacío) y `ConfigService.get(key, default)` solo aplica el default si es `undefined`, de modo que se enviaría `model: ""` a la API. Efecto: 400 no externo en cada llamada, y en experimentos `confirmModel("")` falla con `MODEL_UNAVAILABLE` (503 al crear). El fallo es explícito y acotado, sin riesgo de seguridad. Propuesta: añadir `@IsNotEmpty()` (o comprobar `trim() !== ''` con mensaje propio) a `LLM_MODEL` y una prueba. Es barato y cierra el riesgo residual declarado. No es bloqueante; puede aceptarse como riesgo conocido o corregirse ahora.

## Blockers
Ninguno.

## filesAffected
Solo este informe: `/Users/cjcarlosgc/Development/Tesis/tjc-be-rag-core-api/harness/reports/wi-core-076-independent-review.md`. `git status` muestra además el informe ajeno del contract-reviewer (`wi-core-076-contract-review.md`, sin trackear). No toqué código ni `state.json`.

## Evidence
Desde `app/`: `pnpm lint`, `lint:types`, `build` y `contracts:check` pasan. `pnpm test`: 157 archivos pasan, 7 omitidos; 2615 tests pasan, 104 omitidos. `pnpm test:e2e`: 9 archivos, 259 tests pasan (también sin variables `LLM_*` en `.env`). Desde la raíz: `scripts/sdd-check.mjs` OK; `validate-work-items` OK (76 WI); `validate-harness` OK; `validate-completions` OK (72 WI completados).

## recommendedNextStep
Aprobar el gate del reviewer. Decidir con el usuario si F1 (validar `LLM_MODEL` no vacío) se incorpora ahora o se acepta como riesgo residual. Tras el informe del contract-reviewer, cerrar el WI.
