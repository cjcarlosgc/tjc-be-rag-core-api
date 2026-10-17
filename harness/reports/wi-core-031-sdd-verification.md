# WI-CORE-031 — verificación SDD (2026-10-09)

Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

**Veredicto: SPEC_VERIFIED.** Todo lo necesario está cubierto por las decisiones aprobadas en `harness/reports/wi-core-031-scope-approval.md` y por la evidencia real de `deployment-preconditions-20261009.md` y `wi-core-031-responses-probe.md`. No se registra ninguna decisión nueva; `decisionGate`: sin decisión PENDING/PROPOSED cuyo `Blocks` alcance el WI (DEC-EXP-004 APROBADO). `contractImpact=false` confirmado. No se hicieron llamadas reales a OpenAI.

El detalle técnico vigente está en `spec/transversal/providers/plan.md`, sección «Detalle técnico verificado (WI-CORE-031)».

## Hallazgos (con evidencia)
1. Solo `app/src/providers/openai-llm.provider.ts` usa `chat.completions` (líneas 205, 51-57, 75-86); es el único archivo de producto a migrar. `app/test/*` (e2e) no importa `openai`. El spec `openai-llm.provider.spec.ts:13-18` mockea `chat.completions.create`.
2. `max_completion_tokens` (líneas 56 y 85) pasa a `max_output_tokens`, que en Responses incluye razonamiento: con valores bajos el turno puede terminar `incomplete`.
3. Los 4 esquemas de herramientas (`workspace-agent-tools.ts:127-185`) ya tienen todas las propiedades en `required` y ningún opcional, pero **no declaran `additionalProperties:false`**, que `strict:true` exige. `list_files` es `{properties:{},required:[]}`.
4. `LLMMessage` (`llm-provider.interface.ts:33-36`) no tiene dónde llevar los ítems de Responses (reasoning cifrado, id del ítem); hace falta un campo opaco opcional.
5. El bucle (`generalist-agent.service.ts:197-316`) ya responde cada `toolCall` (incluidas las sobrantes por el tope, 216-223) con un mensaje `tool`; Responses exige un `function_call_output` por cada `function_call`: se conserva. La llamada final sin herramientas (318-322) pasa `[]`: comportamiento de Responses con historial de `function_call` y sin `tools` NO está verificado.
6. Clasificación externa (`openai-llm.provider.ts:225-231`) usa `APIConnectionError`/`APIError.status`; las clases son las mismas con `responses.create`, pero un `Response` puede devolver HTTP 200 con `status:'failed'|'incomplete'`, caso que Chat no tenía.
7. `toModelConfigResponse` (`experiments.service.ts:53-68`) es una lista blanca de 6 campos y `ExperimentModelConfigResponse` (`experiment.response.ts:22-29`) no cambia: un campo extra en `modelConfig` (JSON, sin migración) no llega al contrato. La BD real tiene 0 experimentos (preconditions §1), no hay corridas legadas que reinterpretar.
8. `OPENAI_TIMEOUT_MS` default 30 s (`env.validation.ts:136`, `openai-client.factory.ts:4`) puede ser corto con `xhigh`.

## Riesgos
- R1 (medio): compatibilidad `strict` de los 4 esquemas reales y llamada final sin `tools` con historial de herramientas no probadas en vivo (el usuario prohibió llamadas reales en esta pasada). Mitigación: validador puro de strict en pruebas; humo real de 1 llamada autorizado por el usuario en la revisión, fuera de la suite.
- R2 (medio): `temperature` con modelos de razonamiento no verificado; default `null` (no se envía). Si se define y la API responde 400, es fallo no externo (503), no degradación.
- R3 (bajo): timeouts con `xhigh`; documentar en `.env.example`, sin cambiar defaults sin medición.
- R4 (bajo): los ítems cifrados aumentan `input_tokens` por turno; es el mismo significado (historial reenviado) y se refleja en métricas/costo.
- R5: `LLM_SUPPORTED_COMBINATIONS` vive en entorno (Render y `app/.env`): el implementer solo actualiza `.env.example`; la persona dueña debe fijar el valor real.

## Cortes propuestos
- **Corte 1:** `LLMMessage` + `providerItems` opaco; adaptador Responses (generate y generateWithTools), mapeo, strict, usage, errores/`status`; `additionalProperties:false` en `AGENT_TOOL_SCHEMAS`; spec del proveedor con `responses.create` simulado.
- **Corte 2:** bucle del agente (pasar `providerItems`, sin persistirlos) y regresión del flujo de producto (`generate` sin config, sin `reasoning` ni `include`); ajustes de `generalist-agent.service.spec.ts`, handlers.
- **Corte 3:** `endpoint` en `LLMEffectiveConfig`/`modelConfig`, `.env.example` (`LLM_SUPPORTED_COMBINATIONS` verificado, nota de timeout), `parseEffectiveConfig` tolerante, evidencia; `lint`/`test`/`build`/validate-harness; revisión humana con humo real opcional.

## Actualización del leader (2026-10-09)
R1 quedó despejado después del análisis por una prueba real del agente principal (sección «Ampliación» de `wi-core-031-responses-probe.md`): las 4 herramientas reales con `strict:true` y `additionalProperties:false` funcionan; el modelo puede emitir DOS `function_call` en un mismo turno (el bucle debe responder cada una); la llamada final con `tools:[]` y también sin el campo `tools` funciona con historial de `function_call`/`function_call_output`. Siguen sin probarse en vivo R2 (temperature con razonamiento, default null) y R3 (timeout con xhigh).
