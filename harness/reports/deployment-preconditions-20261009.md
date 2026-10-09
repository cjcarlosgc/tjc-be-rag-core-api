# Precondiciones de despliegue verificadas (2026-10-09)

Modelo: agente principal de la sesión Core · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Autoriza:** el usuario, en chat: aplicar las migraciones en la base que mantiene («soy el único que está desarrollando») y validar con la API los esfuerzos de `gpt-6-luna` si era posible.

## 1. Migraciones en la base real (PostgreSQL 17.6, pgvector 0.8.2, Supabase)
- Estado previo: 30 migraciones aplicadas; datos: 9 proyectos, 4 versiones, 512 chunks, 0 experimentos, `functional_knowledge` vacía.
- Respaldo previo: `pg_dump -Fc -n public` (3,3 MB, 24 tablas con datos) en el scratchpad de la sesión (no está en el repositorio).
- Pendientes eran **ocho**, no cuatro (Prisma las aplica en orden): `20261008120000`, `20261008130000`, `20261008140000`, `20261008150000`, `20261008160000`, `20261009100000`, `20261009110000`, `20261009120000`.
- `prisma migrate deploy` (Prisma 7.10.0, conexión directa 5432): aplicadas las ocho sin errores. `migrate status`: «Database schema is up to date».
- Verificado después: datos intactos (9/4/512); enum `ProjectRole` = ADMIN, MAINTAINER, WRITER, READER; columnas nuevas en `experiment_runs`, `experiment_repetitions` y `functional_knowledge` con la nulabilidad prevista; índice único `functional_knowledge_active_scenario_key`; `functional_knowledge` sigue en 0 filas, por lo que el aborto por duplicados de DEC-FK-005 no se disparó.
- Cierra las precondiciones B (`prisma migrate deploy` en 7.10.0 sin errores ni P3009) y C (validación en PostgreSQL con pgvector real) de WI-CORE-020 y WI-CORE-023/025. Sin prueba de HTTP de 422/503 y demás deudas, estas no cambian.

## 2. Esfuerzos de `gpt-6-luna` contra la API real (`/v1/chat/completions`, el endpoint que usa `OpenAiLLMProvider`)
Una llamada mínima por nivel, sin y con una herramienta trivial.

| `reasoning_effort` | sin herramientas | con herramientas |
|---|---|---|
| `none` | aceptado | aceptado |
| `minimal` | rechazado (400) | rechazado (400) |
| `low` | aceptado | **rechazado** |
| `medium` | aceptado | **rechazado** |
| `high` | aceptado | **rechazado** |
| `xhigh` | aceptado | **rechazado** |

Mensajes de la API: `minimal` no está soportado («Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'»); con herramientas, «Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'».

Valor que reflejaría la evidencia en `LLM_SUPPORTED_COMBINATIONS`:
`[{"model":"gpt-6-luna","efforts":["none","low","medium","high","xhigh"],"toolEfforts":["none"]}]`

**Consecuencia:** el brazo del agente generalista usa herramientas, así que con `/v1/chat/completions` solo puede correr a `none`; como los dos brazos deben compartir configuración, el esfuerzo común máximo del experimento es `none`. Para esfuerzos mayores con herramientas haría falta el endpoint `/v1/responses` (cambio de diseño del proveedor, no de configuración). No se modificó `app/.env`.

## 3. Verificación ampliada del endpoint (2026-10-09, mismas llamadas mínimas)

**`/v1/responses` con herramienta y `gpt-6-luna`:** `none`, `low`, `medium`, `high` y `xhigh` aceptados (status `completed`). Es decir, el modelo sí admite razonamiento con herramientas, pero solo por Responses.

**`/v1/chat/completions` con herramienta y `reasoning_effort=low`:** `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`, `gpt-6-sol` y `gpt-6-luna` → 400 con el mismo mensaje («use /v1/responses or set reasoning_effort to 'none'»); `o4-mini` → aceptado. Sin herramientas, todos aceptan `low`. `gpt-5`, `gpt-5-mini` y variantes: 404 (organización sin verificar o modelo obsoleto), no concluyente.

**Conclusión:** no es una diferencia entre versiones 5.x y 6.x, sino una restricción del endpoint para los modelos recientes; solo la serie `o` antigua acepta herramientas con esfuerzo en `chat/completions`. El proyecto ya la había encontrado el 2026-09-07 (commit `0bb9278`, que fuerza `reasoning_effort: 'none'` en la llamada con herramientas del agente generalista). `OpenAiLLMProvider` usa `chat.completions` desde su primer commit (`38011c5`, 2026-09-06), con `gpt-4o-mini` como modelo por defecto, donde la restricción no aplica; `/v1/responses` nunca se evaluó.
