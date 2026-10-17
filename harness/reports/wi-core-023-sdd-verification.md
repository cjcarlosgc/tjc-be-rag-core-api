# WI-CORE-023 — Verificación de suficiencia SDD

Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-08. Solo lectura sobre `app/`, `state.json` y `work-items.json`; se añadió "Detalle técnico verificado (WI-CORE-023)" a `spec/transversal/providers/plan.md`.

## Resultado: SPEC_VERIFIED (sin bloqueos)

HU17 está en HU01–HU18; `ST-CORE-030` existe en `spec/transversal/providers/tasks.md` (`T-READY`); componente CORE; sin `caseIds`; dependencia `WI-CORE-017` previa; `contractSyncReview` revisa CS-20260920-001 y CS-20260921-003 como NOT_RELEVANT.

## decisionGate: PASS

| ID | Estado | Alcance / Blocks | ¿Bloquea? |
|---|---|---|---|
| DEC-EXP-004 | APROBADO | define modelo `gpt-6-luna`, esfuerzo máximo, no degradar, 422 | No (es la regla a implementar); registrar en state |
| DEC-EXP-FK-001 | APROBADO/cerrada | contexto funcional del brazo RAG | No |
| DEC-EXP-003 | APROBADO | visibilidad de pruebas del agente (WI-CORE-024) | No |
| DEC-EXP-002 | APROBADO | contrato operativo del agente (herramientas, límites) | No; se preserva |
| DEC-INF-001, DEC-VAL-001 | PENDING | Blocks: Sandbox remoto / código empresarial | No |

Registrar en `state.json`: `DEC-EXP-004`, `DEC-EXP-002`, `DEC-EXP-003`, `DEC-EXP-FK-001`. Sin pregunta de decisión.

## contractImpact = false (confirmado)

Sin DTO, ruta, enum, `ErrorCode`, header, auth ni payload nuevos. `LLMProvider` y `LLMConfigurationError` son internos; `modelConfig` es columna interna no expuesta en `ExperimentResponse`. El `422 REASONING_EFFORT_UNSUPPORTED` ya está definido en SYSTEM/DEC-EXP-004 y lo implementa WI-CORE-025. Contract-reviewer no requerido; solo Contract Sync en checkpoints.

## Código actual vs. brecha

- `llm-provider.interface.ts`: solo `generate(prompt)`. `openai-llm.provider.ts` lee `LLM_MODEL`/`LLM_REASONING_EFFORT` por llamada.
- `generalist-agent.service.ts`: importa `openai`, crea cliente, fuerza `reasoning_effort:'none'` con herramientas y usa el valor configurado en la llamada final; diverge del brazo RAG.
- `experiment-job.handler.ts` usa `llmProvider.generate(prompt)` (RAG, l.500) y `generalistAgentService.generate` (l.617). `analysis-run-validation-job.handler.ts` usa `generate(prompt)`: no debe cambiar.
- `ExperimentRun` no tiene `modelConfig` ni `schema.prisma` lo menciona; `ExperimentsService.createRun` no resuelve modelo.
- Único import del SDK fuera de `providers/`: `generalist-agent.service.ts` (M1).

## Ambigüedades cerradas (en plan.md)

1. Tipos neutrales `LLMMessage`, `LLMToolDefinition`, `LLMToolCall`, `LLMToolsResult`; `AgentToolSchema` ya no depende del SDK.
2. Firmas: `generate(prompt, config?)`, `generateWithTools(messages, tools, config)`, `resolveEffectiveConfig()`; la llamada final sin herramientas usa `generateWithTools(..., [], config)`.
3. `temperature`/`maxOutputTokens` nullable (hoy no se envían; modelos con razonamiento rechazan temperature).
4. Lista de combinaciones: `LLM_SUPPORTED_COMBINATIONS` (JSON por modelo, `efforts` y `toolEfforts`); máximo = el mayor común en escala `none<minimal<low<medium<high<xhigh`; no se inventan valores de `gpt-6-luna`.
5. Error tipado `LLMConfigurationError` (`REASONING_EFFORT_UNSUPPORTED | MODEL_UNAVAILABLE`), sin `ErrorCode` ni mapeo HTTP en este WI; WI-CORE-025 mapea.
6. Confirmación del modelo: `models.retrieve` en `resolveEffectiveConfig`, al crear el experimento; `modelVersion` = id devuelto.
7. Persistencia: WI-CORE-023 agrega `ExperimentRun.modelConfig Json?` (migración aditiva); WI-CORE-025 agrega el resto y no la repite. Corridas previas con `null` usan el flujo de producto.
8. Resolución una sola vez en `createRun`, antes de la transacción idempotente; el handler la pasa a ambos brazos.

## Hallazgos / riesgos

- (No bloqueante, ajuste de plan) El plan de 008 listaba `modelConfig` entre las columnas de WI-CORE-025; el criterio de WI-CORE-023 exige persistirlo, por lo que se adelanta aquí. Sugerencia al leader: al seleccionar WI-025, quitar `modelConfig` de su alcance.
- (No bloqueante, operativo) Los esfuerzos soportados de `gpt-6-luna` dependen de la configuración y del runtime; la API no los lista. Verificar el valor de `LLM_SUPPORTED_COMBINATIONS` en el entorno antes de correr un experimento real. Las pruebas usan valores ficticios.
- Sin riesgo de datos: columna nullable, sin backfill. Sin secretos.

## Cortes recomendados

1. Interfaz/tipos, `LLMConfigurationError`, adaptador (`generateWithTools`, `resolveEffectiveConfig`, combinaciones), env y `.env.example`, con `openai-llm.provider.spec.ts`. Refs: HU17.
2. `GeneralistAgentService` sobre `LLMProvider` (sin SDK ni `ConfigService`) con `generalist-agent.service.spec.ts`; M1 por grep. Refs: HU17.
3. Migración `modelConfig`, repositorio, `createRun`, `experiment-job.handler` (ambos brazos con el mismo config) con specs, cierre documental y Contract Sync. Refs: HU17.

Perfil: `implementer` (low) basta; escalar a `implementer-high` solo si el reemplazo del bucle del agente por el provider complica las pruebas existentes.
