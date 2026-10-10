# WI-CORE-031 — Implementación (llamadas del proveedor LLM por /v1/responses)
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high

Cortes 1-4 los hizo `implementer-high` (Haiku 5.5 / high; motivo de la escalada: adaptador del proveedor y mapeo de mensajes). El corte 5 lo hizo `implementer` (Haiku 5.5 / low). Reporte redactado por el leader a partir de los informes de los implementers; los checks los volvió a correr el leader.

## Commits (rango `12c8025..e09387b`, trailer con el modelo real Haiku 5.5; cada uno compila con `tsc -p tsconfig.build.json`)
- `12c8025` corte 1: adaptador OpenAI sobre `client.responses.create` sin estado, `providerItems` opaco en `LLMMessage`, strict (`strict-tool-schema.ts`, `additionalProperties:false` en `AGENT_TOOL_SCHEMAS`), tokens de `usage`, errores y `status` failed/incomplete.
- `308ef81` corte 2: 6 pruebas del bucle del agente (el bucle ya cumplía; sin cambio de código de producción).
- `6b6a33e` corte 3: `endpoint:'responses'` interno en `modelConfig` (repositorio y handler), `.env.example` con `LLM_SUPPORTED_COMBINATIONS`.
- `94e81cd` corte 4: `reasoning-effort.scale.ts` con `max` como nivel más alto; guarda `assertTemperatureCompatible` y `temperatureParam`; validación de arranque de niveles; notas en `.env.example`; `plan.md` y CHANGELOG.
- `e09387b` corte 5: `TEMPERATURE_UNSUPPORTED_WITH_REASONING` se traduce al 422 `REASONING_EFFORT_UNSUPPORTED` (sin ErrorCode nuevo) con prueba de servicio.
- Docs del agente principal con evidencia real: `d3bb35a` (`wi-core-031-responses-probe.md`, ampliaciones 1-2).

## Verificación (leader, 2026-10-09)
- `pnpm lint` 0; `pnpm build` 0; `tsc --noEmit` 43 errores (línea base).
- `pnpm test` x3: 1545 pasan, 54 omitidos (pg), 1599 total (antes 1510 tras 030: 1548 con omitidos), sin intermitencias.
- e2e con `DATABASE_URL`/`DIRECT_URL` inalcanzables: 222 pasan; ninguna llamada real a OpenAI en la suite.
- Diff: `git diff 59ae0bc..HEAD -- app` (19 archivos, +1803/-205); sin DTO, controlador, prisma ni migración. `contractImpact=false` se mantiene.

## Notas para el usuario
1. `LLM_SUPPORTED_COMBINATIONS` en tu `app/.env` y en Render sigue con su valor actual hasta que lo actualices (el valor verificado, con `max`, está en `.env.example`); si queda vacío los experimentos con gpt-6-luna fallan de forma explícita, y con el valor actual el esfuerzo común máximo es el de ese valor.
2. Nuevo fallo de arranque si `LLM_SUPPORTED_COMBINATIONS` trae un nivel fuera de la escala (`none, minimal, low, medium, high, xhigh, max`).
3. R3 medido solo sin herramientas (high 7,5 s, xhigh 10,2 s, max 14,1 s); `OPENAI_TIMEOUT_MS` 30 s sin cambiar hasta medir turnos reales del agente.
4. El 422 `REASONING_EFFORT_UNSUPPORTED` ahora cubre también «temperature incompatible con razonamiento activo» (interpretación; sin ErrorCode nuevo ni cambio de forma de `details`). Reversible.
5. Deudas e interpretaciones: `endpoint?: 'responses'` es opcional (tolerante con corridas previas; hacerlo requerido es un cambio pequeño); un esquema de herramienta inválido lanza error de programación que `GeneralistAgentService` envuelve en `LLM_PROVIDER_UNAVAILABLE` (mitigado: esquemas constantes y probados); un `status` distinto de completed/failed/incomplete es fallo no externo; `reasoning.context` (`all_turns`) no se envía, decisión tuya; el repositorio de experimentos se tocó para persistir `endpoint` (copia `modelConfig` campo a campo).
6. Cambio de comportamiento del flujo de producto: ahora usa `/v1/responses` con gpt-4o-mini, sin `reasoning`/`include`/`temperature`/`max_output_tokens` salvo configuración.
7. Un humo real único (2 turnos con razonamiento y llamada final, gpt-6-luna con `max`) queda a tu decisión; no se hizo.
