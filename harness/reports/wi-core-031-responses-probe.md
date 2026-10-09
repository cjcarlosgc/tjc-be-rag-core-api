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
