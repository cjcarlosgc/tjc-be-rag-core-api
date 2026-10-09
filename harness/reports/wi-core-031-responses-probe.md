# WI-CORE-031 — prueba real mínima de `/v1/responses` (2026-10-09)

Modelo: agente principal de la sesión Core · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Autoriza:** el usuario, en chat (validar con la API los esfuerzos de `gpt-6-luna`, y la propuesta de SDD de 031 que incluía esta prueba). Llamadas mínimas con `OPENAI_API_KEY` de `app/.env` (no se imprime ni se guarda); sin escritura en repositorio salvo este reporte.

## Resultados (`client.responses.create`, SDK `openai` 7.8.0, `store: false`, `include: ['reasoning.encrypted_content']`, herramienta `function` con `strict: true`)
1. **Herramienta con razonamiento, un turno:** `gpt-6-luna` acepta `none`, `low`, `medium`, `high` y `xhigh` (ver `deployment-preconditions-20261009.md`).
2. **Turno múltiple con una tarea trivial (esfuerzo `high`):** el modelo llamó a la herramienta sin razonar (0 tokens de razonamiento, salida `[function_call]`): no ejercita el razonamiento cifrado.
3. **Turno múltiple con una tarea que exige razonar (esfuerzo `xhigh`):**
   - Turno 1: `status=completed`, salida `[reasoning(cifrado), message, function_call]`, 120 tokens de entrada, 168 de salida, de los cuales **73 son de razonamiento** (`usage.output_tokens_details.reasoning_tokens`, incluidos en `output_tokens`).
   - Turno 2 devolviendo todos los ítems del turno 1 más `function_call_output`: `completed`, salida `[reasoning(cifrado), message]`.
   - Turno 2 **sin** devolver el ítem de razonamiento: también `completed`. Es decir, con `store=false` devolverlo no es obligatorio para que la llamada funcione; la decisión del usuario es devolverlo para conservar el hilo de razonamiento entre llamadas a herramientas. Esta prueba no mide la diferencia de calidad.
4. **Un mismo turno puede traer un ítem `message` junto con `function_call`** (el modelo puede hablar antes de llamar a la herramienta): el bucle del agente debe tratarlos por separado.
5. **Modelo del flujo de producto:** `gpt-4o-mini` en Responses sin `reasoning`: aceptado (12 tokens de entrada y 2 de salida); con `reasoning.effort`: **400** «`reasoning.effort` is not supported with this model». El proveedor debe omitir `reasoning` para modelos sin razonamiento, igual que hoy.
6. **Tokens:** `usage.input_tokens` y `usage.output_tokens` (en lugar de `prompt_tokens` y `completion_tokens` de Chat); el razonamiento va dentro de la salida.

## Lo que esta prueba no cubre
Calidad del razonamiento con y sin el ítem cifrado devuelto; compatibilidad `strict` de las herramientas reales del agente (`list_files`, `read_file`, `search_text`, `inspect_symbol`); comportamiento con presupuestos largos; flujo de producto completo. Lo verifica el SDD de WI-CORE-031 y las pruebas con el cliente simulado.

## Ampliación (2026-10-09): herramientas reales del agente y llamada final
Mismas condiciones (`gpt-6-luna`, `high`, `store: false`, `include: ['reasoning.encrypted_content']`), con las cuatro herramientas reales de `AGENT_TOOL_SCHEMAS` (`list_files`, `read_file`, `search_text`, `inspect_symbol`) convertidas a `strict: true` añadiendo `additionalProperties: false`, y resultados simulados:
- **Compatibilidad `strict`:** aceptada; los turnos completaron y el modelo llamó a las herramientas correctamente (`list_files` en el turno 1; `read_file` + `inspect_symbol` en el turno 2).
- **Llamadas en paralelo:** el modelo emitió **dos `function_call` en un mismo turno**; el bucle debe responder cada una (ya lo hace).
- **Llamada final con el historial completo (ítems `function_call` y `function_call_output`):** con `tools: []` → `completed`, salida `[message]`; sin el campo `tools` → igual. Es el caso del tope de tool calls de WI-CORE-024.
- En estos turnos el modelo no generó ítems de razonamiento (decidió no razonar); el caso con razonamiento cifrado quedó probado en la sección anterior.
Con esto quedan despejados el riesgo R1 del SDD (compatibilidad `strict` de los cuatro esquemas y llamada final sin herramientas con historial de llamadas a función). Siguen sin probarse en vivo: `temperature` con modelos de razonamiento (R2) y el timeout con `xhigh` (R3).

## Ampliación 2 (2026-10-09): Responses sin herramientas, `max`, `temperature` y latencia
- **`/v1/responses` sin herramientas:** `none`, `low`, `medium`, `high` y `xhigh` aceptados; `minimal` rechazado. El mensaje de error de la API lista los valores soportados en Responses: `none, low, medium, high, xhigh` y **`max`**.
- **`max`:** aceptado en `/v1/responses` **sin y con herramientas** (`strict`); rechazado en `/v1/chat/completions` (lista de valores soportados allí: `none, low, medium, high, xhigh`). El SDK `openai` 7.8.0 tipa `ReasoningEffort` con `'max'`. Es el esfuerzo máximo real de `gpt-6-luna` (DEC-EXP-004: «el valor máximo que soporten el modelo y el runtime»), y solo existe en Responses. La escala del proveedor (`REASONING_EFFORT_SCALE`) termina en `xhigh`: `max` no está incluido.
- **R2, `temperature`:** con `reasoning.effort=high` → 400 «Unsupported parameter: 'temperature' is not supported with this model»; con `effort=none` se acepta. Con razonamiento activo no puede enviarse `temperature`.
- **R3, latencia (tarea de dificultad media sin herramientas: función TypeScript con pruebas):** `high` 7,5 s (516 tokens de razonamiento), `xhigh` 10,2 s (621), `max` 14,1 s (919). El timeout de 30 s es suficiente para una llamada así; un turno del agente con contexto grande o varias llamadas podría acercarse al límite.

## Humo real del proveedor compilado (2026-10-09, HEAD 65003d9)
**Autoriza:** el usuario, en chat («Sí, una corrida»). Se instanció `OpenAiLLMProvider` desde `app/dist` con la clave de `app/.env` (no se imprime) y `LLM_SUPPORTED_COMBINATIONS` definido solo en el proceso (`gpt-6-luna` con `none`…`max` en `efforts` y `toolEfforts`). Nota de método: el primer intento falló por un `ConfigService` falso que devolvía números como texto; no es un defecto del proveedor (en la aplicación, la validación de configuración los convierte).

Resultados:
1. `resolveEffectiveConfig()` → modelo `gpt-6-luna`, **esfuerzo `max`**, `temperature: null`, `endpoint: 'responses'` (confirmó el modelo contra la API).
2. Bucle con las cuatro herramientas reales y razonamiento: turno 1 `[reasoning, function_call]` (`list_files`); turno 2 `[reasoning, function_call, function_call]` (`read_file` + `inspect_symbol`, en paralelo); turno 3 `[reasoning, message]` (respuesta final). El mensaje del asistente con sus `providerItems` (incluido el razonamiento cifrado) se reenvió tal cual en cada turno; totales de 1076 tokens de entrada y 268 de salida.
3. Llamada final con `tools=[]` y el historial completo: correcta.
4. `temperature` con razonamiento activo: falla de forma explícita (`LLMConfigurationError` / `TEMPERATURE_UNSUPPORTED_WITH_REASONING`) sin llamar a la API.
5. Flujo de producto (`generate` sin configuración, `gpt-4o-mini` por Responses): respuesta correcta, 11 tokens de entrada y 5 de salida.

Cierra la deuda de verificación en vivo del flujo completo de WI-CORE-031. No cubre turnos reales del agente con contextos grandes (latencia/timeout) ni calidad del razonamiento.

### Corrección del paso 5 del humo (2026-10-09)
El paso 5 de la sección anterior estaba descrito de forma incorrecta como «`gpt-4o-mini`». La configuración local del usuario define `LLM_MODEL="gpt-5.6-luna"` y `LLM_REASONING_EFFORT="high"` para el flujo de producto; el humo borró `LLM_REASONING_EFFORT`, por lo que ese paso corrió con `gpt-5.6-luna` **sin** razonamiento. Se repitió con la configuración real del usuario y con el default del repositorio (`generate` sin configuración, por `/v1/responses`):
- **A) Configuración real** (`gpt-5.6-luna`, esfuerzo `high`): respuesta correcta, 14 tokens de entrada y 5 de salida.
- **B) `gpt-4o-mini` sin razonamiento** (default del repositorio): respuesta correcta, 15 tokens de entrada y 2 de salida.
Ambas configuraciones del flujo de producto funcionan con el proveedor nuevo.
