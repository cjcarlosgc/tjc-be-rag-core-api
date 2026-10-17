# WI-CORE-025 — Verificación de suficiencia SDD

Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-08. Solo lectura sobre `app/`, `state.json` y `work-items.json`; se añadió "Detalle técnico verificado (WI-CORE-025)" a `spec/features/008-experimental-comparison/plan.md` y una referencia en su `tasks.md`.

## Resultado: SPEC_VERIFIED (sin bloqueos; un ajuste de contrato por ratificar)

HU17 está en HU01–HU18; `ST-CORE-032` existe en `008/tasks.md`; componente CORE; sin `caseIds`; dependencias `WI-CORE-023` y `WI-CORE-024` cerradas; `contractSyncReview` revisa CS-20260920-001 y CS-20260921-003 como NOT_RELEVANT. `modelConfig` ya está persistido por WI-023 (migración `20261008160000`): work-items.json (criterio 2), `008/plan.md` (Persistencia) y `008/tasks.md` (ST-CORE-032) lo reflejan y WI-025 no lo repite.

## decisionGate: PASS

| ID | Estado | Alcance / Blocks | ¿Bloquea? |
|---|---|---|---|
| DEC-EXP-FK-001 | APROBADO | RAG con FK ACTIVE, agente sin FK | No |
| DEC-EXP-003 | APROBADO | pruebas visibles al agente (ya hecho en WI-024) | No |
| DEC-EXP-004 | APROBADO | modelo/esfuerzo; base del 422 | No |
| DEC-EXP-002 | APROBADO | límites del agente y paridad | No |
| DEC-IDEMP-001 | APROBADO (Blocks NONE) | identidad Sandbox estable y sufijo `:2` | No |
| DEC-INF-001, DEC-VAL-001 | PENDING | remoto del Sandbox / código empresarial | No |
| DEC-RAG-001 | PENDING | solo recuperación test-aware futura | No |

Registrar en `state.json`: bloqueantes `[]`; no bloqueantes `DEC-EXP-FK-001`, `DEC-EXP-003`, `DEC-EXP-004`, `DEC-EXP-002`, `DEC-IDEMP-001`. Sin pregunta de decisión.

## contractImpact = true y publishesContract = true (confirmados)

- `INTEROP-2.7` §6.5.1 ya declara los campos nuevos, el `422 REASONING_EFFORT_UNSUPPORTED` y las enums; el WI los implementa, así que el `contract-reviewer` debe verificar conformidad (DTO, `ErrorCode`, identidad `:2`) **antes de implementar**. Los consumidores ignoran campos desconocidos, por lo que la adición es retrocompatible para Console.
- `publishesContract=true` es correcto: `harness/contract-sync.mjs` exige `contractImpact && publishesContract` para emitir, y el WI emite el Contract Sync de experimentos (OE5 pareado) a Console.
- Cambios canónicos que corresponden al contract-reviewer: (a) `INTEROP` §3 documenta solo la identidad del intento 1; falta la forma `...:experiment:{jobId}:{strategy}:{repetition}:2`; (b) estado de §6.5.1 pasa de "pendiente" a implementado al cierre; (c) **ajuste de tipo a ratificar**: `ExperimentRepetitionResponse.executionDurationMs` es `number` pero el criterio exige `null` nunca cero; hoy el código emite `?? 0`. Propuesta: `number | null`. Sin ratificación, mantener el contrato y ceder el criterio.
- `ErrorEnvelope.code` es `string`; solo hace falta agregar `REASONING_EFFORT_UNSUPPORTED` al enum de Core.

## Código actual vs. brecha

- `attempt` ya existe en `ExperimentRepetition` (unique con experimentId/strategy/repetition) y `beginAttempt` lo incrementa bajo advisory lock; no existen `randomizationSeed`, `budget`, `executionProfile`, `runnerHint`, `pairId`, `pairPosition`, `technicallyEvaluable`.
- `ExperimentsService.createRun` resuelve `modelConfig` en `prepare` pero `LLMConfigurationError` se propaga como 500; el enum no tiene `REASONING_EFFORT_UNSUPPORTED`.
- El handler corre 6 slots en orden strategy-major con concurrencia 3; sin orden por par ni reintentos; `runAgentArm` lee el presupuesto del entorno. `runnerHint` sale de `version.detectedFramework` en el handler; `EXECUTION_PROFILE_BY_RUNNER` es privado en `SandboxExecutionService`.
- `OpenAiLlmProvider.complete` colapsa todo error en `LLM_PROVIDER_UNAVAILABLE` sin conservar el status: hoy no se puede demostrar 5xx/429/timeout. `mapSandboxResult` ya clasifica `TIMED_OUT` como `INFRASTRUCTURE`.
- El DTO de código no tiene `model`, `budget`, etc., y mapea `executionDurationMs ?? 0`, `valid ?? false`.

## Ambigüedades cerradas (plan.md, 11 puntos)

Migración aditiva única y valores `null` para corridas previas; semilla generada dentro de `create` de la idempotencia (replay conserva la semilla); `runnerHint`/`executionProfile` desde el framework detectado, 422 `UNSUPPORTED_PROJECT` si PHP o sin framework; `budget` con `maxDurationMs = GENERATION_TIMEOUT_MS`, leído por el handler desde el run; `pairOrder` exacto (SHA-256 de `seed:i`, `readUInt32BE(0) % 2`), `pairId` UUIDv5 estable, pares en orden y posiciones secuenciales; definición de fallo «externo» y marcador persistido (`FAILED` + `INFRASTRUCTURE`) con subclase de `AppException` que expone el indicador; máquina de reintento (máximo intento 2, `:2`, sin backoff, `technicallyEvaluable=false` solo en el segundo externo); skip de slots terminales en redelivery; `LLMConfigurationError` a 422 (`MODEL_UNAVAILABLE` a 503 `LLM_PROVIDER_UNAVAILABLE`); forma exacta de DTO; lista de pruebas.

## Hallazgos / riesgos (no bloqueantes)

1. `TIMED_OUT` del Sandbox cuenta como externo por la regla literal del WI; un test generado que cuelga se reintenta una vez (posible sesgo contra el brazo que lo produce). Se aceptó el criterio literal; el Human Reviewer puede pedir excluirlo.
2. `executionDurationMs` nullable es un ajuste de tipo contractual por ratificar (ver arriba).
3. Las tasas de `StrategyMetricsResponse` siguen incluyendo slots no evaluables; su exclusión/jerarquía es de WI-CORE-027.
4. Preexistente fuera de alcance: no hay WI/subtarea para la adaptación live por `AnalysisRun`/símbolo (`analysisRunId`, `symbol` en DTO y request); el DTO de código sigue con `targetId`. El leader debería registrarlo en backlog.
5. Intentos huérfanos `RUNNING` tras un crash no se tratan (comportamiento actual).
6. Serializar posiciones dentro de un par aumenta la latencia del experimento (los pares sí pueden ir concurrentes).

## Cortes recomendados

1. Base: migración + `schema.prisma`, `pairOrder`/semilla/`pairId` (módulo puro con spec), `sandboxExperimentRequestId` con intento, exportar mapa de perfiles, `ErrorCode.REASONING_EFFORT_UNSUPPORTED`. Refs: HU17. (`implementer`)
2. `ExperimentsService`/repositorio/DTO: semilla, budget, perfil y runner en la creación, 422/503, 422 PHP, campos del DTO y `null`; specs de servicio y repositorio. Refs: HU17. (`implementer`)
3. Proveedor y handler: clasificación externa en `OpenAiLlmProvider`, ejecución por pares, `beginAttempt` con par, budget desde el run, máquina de reintento, `technicallyEvaluable`, skip en redelivery; specs de handler, context-traces y proveedor. Refs: HU17. (**`implementer-high` recomendado**: reescribe la orquestación y toca un spec de ~1300 líneas)
4. Cierre documental, ratificación del `contract-reviewer` y Contract Sync a Console. Refs: HU17.

Orden de gates sugerido: contract-reviewer antes del corte 1; Contract Sync en los cuatro checkpoints.

## Decisiones del usuario aplicadas (chat)
- `executionDurationMs: number | null` ratificado (filas previas `null`).
- `TIMED_OUT` del Sandbox no es fallo externo: desviación aprobada de la regla literal del WI; solo son externos fallos del proveedor LLM (5xx, 429, conexión/timeout), `SandboxUnavailableError` e `INFRASTRUCTURE` salvo `TIMED_OUT`.
- IDEA-006 e IDEA-007 registradas en `spec/ideas.md` sin implementar.
