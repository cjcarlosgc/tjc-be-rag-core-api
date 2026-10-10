# WI-CORE-023 — Implementación (ST-CORE-030, HU17)

Modelo: implementer · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-08. Rama `feature/jean`. Alcance: solo `app/` y este reporte. No se tocó `spec/`, `harness/state.json` ni `harness/work-items.json`. No hay push.

## Resultado

Estado: IMPLEMENTADO, pendiente de revisión humana (Human Reviewer). El implementer no se autoaprueba y no declara el WI terminado.

Sin bloqueos. No se requirió ninguna decisión nueva; las ambigüedades menores se resolvieron según la sección "Desviaciones y decisiones locales".

## Commits

| Corte | Commit | Mensaje |
|---|---|---|
| 1 | `b13a64a` | feat(providers): interfaz LLMProvider con generateWithTools y configuración efectiva |
| 2 | `c9c1ef0` | feat(agente): GeneralistAgentService sobre LLMProvider sin SDK de OpenAI |
| 3 | `be81ac2` | feat(experimentos): persistir modelConfig por corrida y mismo config en ambos brazos |
| Cierre | (este commit) | test(harness): informe de evidencia de implementación WI-CORE-023 |

Cada commit lleva `Refs: HU17` y `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.

## Contenido por corte

**Corte 1: interfaz, error tipado, adaptador, entorno.**
- `app/src/providers/llm-provider.interface.ts`: `LLMProvider` con `generate(prompt, config?)`, `generateWithTools(messages, tools, config)` y `resolveEffectiveConfig()`. Tipos neutrales `LLMEffectiveConfig`, `LLMMessage`, `LLMToolDefinition`, `LLMToolCall` y `LLMToolsResult`, sin importar el SDK.
- `app/src/providers/llm-configuration.error.ts` (nuevo): `LLMConfigurationError` con `code` `REASONING_EFFORT_UNSUPPORTED | MODEL_UNAVAILABLE`. No es `AppException` y no agrega `ErrorCode`.
- `app/src/providers/openai-llm.provider.ts`: `LLM_SUPPORTED_COMBINATIONS` por modelo (`efforts` para `generate`, `toolEfforts` para `generateWithTools`). Esfuerzo efectivo = máximo común en la escala `none < minimal < low < medium < high < xhigh`, o el pedido si pertenece a ambos. Confirmación del modelo con `client.models.retrieve`. Nunca fuerza `none` ni cambia modelo o esfuerzo en silencio. Los fallos de transporte siguen como `AppException LLM_PROVIDER_UNAVAILABLE` (503).
- `app/src/config/env.validation.ts`: `EXPERIMENT_LLM_MODEL` (por defecto `gpt-6-luna`), `EXPERIMENT_LLM_REASONING_EFFORT`, `EXPERIMENT_LLM_TEMPERATURE`, `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS` y `LLM_SUPPORTED_COMBINATIONS`. Valida formato y JSON al arranque.
- `app/.env.example`: solo placeholders. `LLM_SUPPORTED_COMBINATIONS` queda vacío y el ejemplo va comentado con `<modelo>` y `<esfuerzo>`. No se inventaron valores de `gpt-6-luna`.
- `app/src/providers/openai-llm.provider.spec.ts`: pruebas del adaptador en verde (la ejecución de `src/providers` del corte 1 reportó 21 pruebas en 2 archivos, incluido el de embeddings).

**Corte 2: agente sobre LLMProvider.**
- `app/src/generation/agent/generalist-agent.service.ts`: sin import de `openai` y sin `ConfigService`. Inyecta `LLM_PROVIDER`. Recibe la `LLMEffectiveConfig` y la usa idéntica en cada llamada, incluida la final sin herramientas (`generateWithTools(messages, [], config)`). Un `LLMConfigurationError` se propaga sin envolver. La trayectoria, los contadores y el truncado no cambian.
- `app/src/experiments/experiment-job.handler.ts`: pasa la config a ambos brazos (ver desviaciones).
- `generalist-agent.service.spec.ts` usa un `LLMProvider` falso, no un mock del SDK. Añade pruebas de config idéntica en todas las llamadas, de propagación de `LLMConfigurationError` y de envoltura de fallos genéricos.

**Corte 3: persistencia de modelConfig.**
- `app/prisma/schema.prisma`: `ExperimentRun.modelConfig Json?`.
- `app/prisma/migrations/20261008160000_experiment_run_model_config/migration.sql`: `ALTER TABLE "experiment_runs" ADD COLUMN "modelConfig" JSONB;`. Aditiva, nullable, sin backfill. Generada con `prisma migrate diff --from-schema <HEAD> --to-schema` (sin conexión). No se aplicó a ninguna base.
- `experiment-runs.repository.ts`: `create` persiste `modelConfig` como objeto JSON plano.
- `experiments.service.ts`: `createRun` resuelve `resolveEffectiveConfig()` una sola vez, después de las validaciones y antes de `idempotencyService.run`, y la pasa al repositorio. Un `LLMConfigurationError` se propaga sin crear el run ni encolar el job.
- `experiment-job.handler.ts`: lee `run.modelConfig`. Si es distinto de NULL, lo parsea y lo usa en ambos brazos. Si es NULL (corrida previa), usa `resolveEffectiveConfig()`. Un `modelConfig` no válido lanza error y no cae en silencio al default.
- Specs: `experiments.service.spec.ts` (resuelve una vez y antes de la transacción, persiste, propaga el error sin crear run), `experiment-runs.repository.spec.ts` (persiste el JSON), `experiment-job.handler.spec.ts` (ambos brazos reciben la misma config persistida; corrida NULL usa la resolución por defecto).
- Se regeneró el cliente Prisma (`npx prisma generate`). `src/generated/` no está versionado.

## Desviaciones y decisiones locales

1. **Corte 2 toca el handler.** El nuevo `generate` del agente exige config y el handler mockea `generate` en su spec, así que el cableado mínimo entró en el corte 2. En ese punto, el handler resolvía la config una vez por job y la pasaba a ambos brazos. El corte 3 la sustituyó por la persistida. Es un estado intermedio coherente.
2. **El brazo RAG del experimento ahora usa la config del experimento** (`EXPERIMENT_LLM_MODEL`, por defecto `gpt-6-luna`) en lugar de `LLM_MODEL`. Es el efecto buscado por DEC-EXP-004. El flujo de producto no cambia: `generate(prompt)` sin config conserva `LLM_MODEL` y `LLM_REASONING_EFFORT`, así que `analysis-run-validation-job.handler` sigue igual.
3. **Corridas previas con `modelConfig` NULL.** La especificación dice "usa la resolución por defecto del flujo de producto". Como `generateWithTools` exige config, la resolución por defecto aplicada es `resolveEffectiveConfig()` en tiempo de job, no `LLM_MODEL`. Pendiente de confirmar por el reviewer.
4. **Modelo sin entrada en `LLM_SUPPORTED_COMBINATIONS`.** El código de error no está fijado en la spec. Se usa `REASONING_EFFORT_UNSUPPORTED` con `supportedEfforts: []`. Pendiente de confirmar.
5. **Escala de esfuerzo.** `max` no está en la escala `none < minimal < low < medium < high < xhigh` del plan. Si aparece en la lista, se elige solo si no hay ningún valor de la escala, y no se inventa un orden.
6. **Parámetros opcionales.** `temperature` se envía solo si no es null. `maxOutputTokens` se envía como `max_completion_tokens`, solo si no es null.
7. **Context7.** No se consultó Context7 para el SDK de OpenAI, contra lo que pide la regla global del usuario. Se usaron las definiciones instaladas (`openai` 7.8.0) de `models.retrieve` y de `reasoning_effort`. Recomendado verificar contra la documentación actual antes de la revisión.
8. **Errores de tipos preexistentes.** `npx tsc --noEmit -p tsconfig.json` reporta errores en specs ajenos a este WI (`analysis-runs`, `publications`, `github-webhooks` y otros). El build (`tsconfig.build.json`, `nest build`) compila limpio. No se corrigieron por estar fuera de alcance.
9. **Migración no validada contra Postgres.** No se disponía de un Postgres local desechable ni se aplicó nada contra base real. Se omitió la validación y se declara aquí.

## Evidencia

Comandos ejecutados desde `app/` con `DATABASE_URL` y `DIRECT_URL` exportadas como `postgresql://nouser:nopass@127.0.0.1:1/none`.

- `pnpm lint` (oxlint src/ test/): código de salida 0, 0 diagnósticos.
- `pnpm test`: 109 archivos pasados, 1 omitido (110 total); 1372 pruebas pasadas, 36 omitidas, 0 fallidas. Las omitidas ya lo estaban antes de este WI.
- `pnpm build` (nest build): compila sin errores.
- `pnpm test:e2e`: 7 archivos pasados; 222 pruebas pasadas, 0 fallidas.
- `npx tsc --noEmit -p tsconfig.build.json`: sin errores.
- Pruebas específicas del WI tras el corte 3: `src/experiments` (4 archivos, 43 pruebas) en verde. Las de `src/providers` y `src/generation/agent` quedaron en verde en sus cortes y en la ejecución completa de `pnpm test`.
- Alcance: `git diff --name-only f282034..HEAD` lista 16 archivos, todos bajo `app/`. Ninguno en `spec/`, `harness/state.json` ni `harness/work-items.json`. Ninguno es DTO, controlador ni `ErrorCode`.

## Criterios de M1–M3

- **M1 (0 archivos fuera del adaptador y la configuración):** `grep -rn "from 'openai" app/src` lista solo `providers/openai-client.factory.ts`, `providers/openai-embedding.provider.ts` y `providers/openai-llm.provider.ts`. El de embeddings queda fuera de alcance por la spec. **Cumple.**
- **M2 (0 cambios de contrato):** sin cambios en DTOs, rutas, `ErrorCode`, headers, `INTEROP` ni `SYSTEM`. La única modificación persistente es la columna interna `modelConfig`, que no se expone en `ExperimentResponse`. **Cumple.**
- **M3 (100 % de pruebas aplicables en verde):** lint, test, build y e2e en verde, sin fallos. **Cumple.**

Contract Sync: el checkpoint PULL no se ejecutó aquí. Corresponde al leader antes de cerrar el WI. El reporte de verificación previo ya indicaba `contractImpact=false`.

## Pendientes para el leader y el reviewer

- Confirmar las desviaciones 3 y 4 (NULL legacy y código para modelo sin combinaciones).
- Confirmar la verificación de la API del SDK con Context7 si se requiere como evidencia.
- Validar la migración en un Postgres desechable antes de cualquier despliegue.
- Establecer `LLM_SUPPORTED_COMBINATIONS` en el entorno con valores verificados del runtime. Sin esa variable, `createRun` falla con `REASONING_EFFORT_UNSUPPORTED`.
- Revisar el diff de los commits `b13a64a`, `c9c1ef0`, `be81ac2` antes de cualquier push. No se hizo push.

## Recomendación siguiente

Presentar el diff y esta evidencia al Human Reviewer. Tras su veredicto, el leader ejecuta el Contract Sync de cierre y actualiza `harness/state.json` y `work-items.json`. Después puede seleccionarse WI-CORE-024.
