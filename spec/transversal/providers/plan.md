# providers — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Interfaces `LLMProvider.generate` y `EmbeddingProvider.embedMany`. Model IDs/config desde env. Registrar provider/model version y dimensionalidad efectiva en runs experimentales.

La implementación existente de OpenAI, `text-embedding-3-small` y la columna `vector(1536)` son ahora la materialización del modelo definitivo (`DEC-EMB-001`, APROBADO); no requieren migración de modelo/dimensión. Si en el futuro una reevaluación con evidencia del experimento cambiara el modelo (ej. `voyage-code-4`), esa nueva decisión debería incluir adaptador, migración de esquema, reindexación y pruebas de compatibilidad.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.

## Corte SMART V3

`WI-CORE-023` mueve la configuración de razonamiento y el cliente OpenAI del servicio del agente al adaptador del proveedor y precede a `WI-CORE-024` y `WI-CORE-025`.

## Diseño técnico SMART V3 (WI-CORE-023)

`LLMProvider` agrega `generateWithTools(messages, tools, config)` además de `generate`; ambos aceptan una `LLMEffectiveConfig` única `{provider, model, modelVersion, reasoningEffort, temperature, maxOutputTokens}` que se resuelve una vez por experimento y se persiste en `ExperimentRun.modelConfig`. Por `DEC-EXP-004` el experimento usa `gpt-6-luna` vía OpenAI con el esfuerzo máximo soportado por el modelo y el runtime, igual en ambos brazos; la configuración del flujo de producto no cambia. El adaptador conserva una lista configurable de combinaciones modelo/esfuerzo soportadas (también con herramientas); si no soporta la pedida lanza un error tipado de configuración y nunca fuerza `none` ni cambia el esfuerzo en silencio. Hoy `generalist-agent.service.ts` importa el SDK de OpenAI, lee `reasoning_effort` por su cuenta y fuerza `none` al usar herramientas: ese código se mueve al adaptador. Pruebas a tocar: `openai-llm.provider.spec.ts` y `generalist-agent.service.spec.ts`. El mapeo del error a `422` lo implementa `WI-CORE-025`.
