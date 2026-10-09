# WI-CORE-025 — Revisión contractual previa a la implementación

Modelo: contract-reviewer · Fecha: 2026-10-08 · Solo lectura sobre app/, state.json y work-items.json.

## Veredicto: APPROVED (sin blockers, sin DECISION_REQUIRED)

El diseño (plan.md, 11 puntos) es conforme con INTEROP-2.7 §6.5.1: campos nuevos de `ExperimentStatusResponse` y `ExperimentRepetitionResponse`, 422 `REASONING_EFFORT_UNSUPPORTED`, orden pareado por `randomizationSeed`, un único reintento externo y `technicallyEvaluable`. Las dos decisiones del usuario (executionDurationMs nullable, TIMED_OUT no externo) son consistentes con el plan.

## Findings

1. Retrocompatibilidad: los campos nuevos son aditivos (los consumidores ignoran campos desconocidos). El único cambio de tipo es `ExperimentRepetitionResponse.executionDurationMs: number -> number | null`. Es un ensanchamiento que puede romper a un consumidor que asuma `number` (formateo/aritmética); se declara `breaking: false` en el sync con acción requerida explícita para Console (tratar `null`). `StrategyMetricsResponse.executionDurationMs` sigue `number` (agregado).
2. Versionado: NO hace falta bump. Precedente: WI-CORE-018/019/020 implementaron secciones de INTEROP-2.7 sin cambiar el número (solo se marcaron "implementado"; CS-CORE-20261008-005..007 usan `breaking:false`, sin bump, y 007 declara «sin cambio de versiones»). `INTEROP-2.7` ya cubre esta superficie y el texto dice «nada se infiere implementado por el número de versión». SYSTEM-2.6 no cambia (el contrato de sistema no define DTO de OE5; no hay cambio de reglas).
3. `LLM_PROVIDER_UNAVAILABLE` no está enumerado en INTEROP §4 (solo la regla genérica `503`); se usa el código existente de Core, sin cambio de contrato. `REASONING_EFFORT_UNSUPPORTED` entra al enum `ErrorCode` de Core (`ErrorEnvelope.code` es `string`).
4. Alcance: la adaptación live por `analysisRunId`/símbolo sigue fuera (IDEA-006/007). Sin impacto en Sandbox (la identidad hija es del lado Core; Sandbox solo ve un `requestId` UUID v5 distinto) ni en GitHub Integration.

## Cambios contractuales ya aplicados (no requerían decisión; siguen marcados «pendiente»)

En `spec/contracts/interoperability-contract.md`:
- §3: identidad Core→Sandbox del intento 2: `urn:tjc:sandbox-execution:v1:experiment:{jobId}:{strategy}:{repetition}:2` (sufijo solo si `attempt > 1`, sin intento 3).
- §6.5: `ExperimentRepetitionResponse.executionDurationMs: number | null` (null si el Sandbox no ejecutó y en corridas previas; nunca 0).
- §6.5.1 (Autorización y errores): 422 con `details.supportedEfforts: string[]`; `MODEL_UNAVAILABLE` -> `503 LLM_PROVIDER_UNAVAILABLE` sin crear experimento; `TIMED_OUT` no es fallo externo.

## Texto que el leader debe cambiar AL CIERRE del WI (tras la implementación y verificación)

1. Cabecera §6.5.1: reemplazar «**Definido, pendiente de implementar y verificar** (`WI-CORE-023`, `WI-CORE-024`, `WI-CORE-025`)» por «**Implementado** en `WI-CORE-023`, `WI-CORE-024` y `WI-CORE-025`» (con la fecha, como las demás secciones).
2. Línea 14 (nota de versión): añadir «las extensiones de OE5 (§6.5.1)» a la lista de lo implementado en Core (junto a `WI-CORE-018/019/020`) y agregar `WI-CORE-023/024/025`; quitar §6.5.1 de «sigue definido y pendiente».
3. Comentarios de los bloques `ExperimentStatusV27Additions` / `ExperimentRepetitionV27Additions`: si el DTO final emite `null` para corridas previas, ajustar los tipos a `string | null`, `ExperimentBudgetResponse | null`, `Id | null`, `1 | 2 | null` (pairPosition), etc., según lo que implemente el DTO (plan.md punto 10: filas previas -> `null`). Hoy el contrato las declara no nulas; si se mantienen no nulas, la implementación debe justificar que nunca hay filas previas visibles. RECOMENDACIÓN: declarar `| null` en `model`, `budget`, `executionProfile`, `runnerHint`, `randomizationSeed`, `pairId`, `pairPosition`; `attempt` y `technicallyEvaluable` siguen no nulos (default 1/true). Esto es una decisión de tipo que NO se aplicó ahora porque depende del DTO final; no requiere decisión del usuario (consecuencia de «nunca cero, filas previas null» ya ratificada).
4. §6.5.1 nota «PHP/PHPUnit bloqueado»: añadir que el rechazo es `422 UNSUPPORTED_PROJECT` (PHP o sin framework detectado) antes de crear el run (plan.md punto 3), si se implementa así.
5. `spec/features/008-experimental-comparison` y `harness/` (estado WI, `contractSyncReview`) los cierra el leader; INTEROP §8 no cambia.
6. Sin bump de INTEROP ni de SYSTEM.

## Contract Sync a Console (outbox; id siguiente a CS-CORE-20261008-007)

```
type: CONTRACT_SYNC
source: core
sourceWorkItem: WI-CORE-025
targets: [console]            # no Sandbox, no GitHub Integration
scopePaths: [spec/contracts/interoperability-contract.md]
breaking: false
sourceRevision: <commit del cierre>
status: C-PENDING
```

`changed` debe incluir:
- INTEROP-2.7 §6.5.1 implementado (WI-CORE-025): `ExperimentStatusResponse` agrega `model`, `budget`, `executionProfile`, `runnerHint`, `randomizationSeed`; `ExperimentRepetitionResponse` agrega `pairId`, `pairPosition` (1|2), `attempt` (1|2), `technicallyEvaluable`. Corridas/filas previas devuelven `null` en los campos nuevos (nunca 0 ni valores inventados), salvo `attempt` (1) y `technicallyEvaluable` (true).
- `ExperimentRepetitionResponse.executionDurationMs` pasa a `number | null` (null cuando el Sandbox no ejecutó o corrida previa; antes se emitía 0). Cambio de tipo observable.
- `POST /experiments` puede responder `422 REASONING_EFFORT_UNSUPPORTED` con `details.supportedEfforts: string[]` y no crea experimento; `503 LLM_PROVIDER_UNAVAILABLE` si el modelo de experimentos no está disponible; `422 UNSUPPORTED_PROJECT` para PHP/sin framework.
- Semántica: orden por par reproducible desde `randomizationSeed`; reintento externo único (attempt 2) y `technicallyEvaluable=false` en el segundo fallo de infraestructura; `TIMED_OUT` no se reintenta. Identidad Core→Sandbox del intento 2 con sufijo `:2` (informativo: interno de Core, sin acción en Console ni Sandbox).
- Ningún DTO declara ganador; las tasas de `StrategyMetricsResponse` pueden incluir slots no evaluables hasta WI-CORE-027.

`requiredAction` (Console): importar y acusar; tratar `executionDurationMs` nulo (mostrar «—», no 0 ni formatear/sumar sin guardas); tolerar `null` en los campos nuevos; mostrar el 422 `REASONING_EFFORT_UNSUPPORTED` con `supportedEfforts` y el 503 como error reintentable; mostrar `technicallyEvaluable=false`/`attempt=2` sin declarar ganador. Sin cambios en Sandbox ni GitHub Integration. Emitir recién cuando el WI esté W-DONE (`contractImpact && publishesContract` ya son true).

## Pruebas contractuales a exigir en la implementación
- DTO emite `null` (no 0) para `executionDurationMs` sin ejecución y para campos previos; `sandbox-request-id.util.spec` cubre `:2` y la ausencia de sufijo en intento 1; `ErrorCode.REASONING_EFFORT_UNSUPPORTED` con 422 y `details.supportedEfforts`; `MODEL_UNAVAILABLE` -> 503.

## recommendedNextStep
Proceder con el corte 1 del implementer. Al cierre, aplicar los puntos 1-4 de «Texto al cierre» y emitir el Contract Sync anterior.

filesAffected: spec/contracts/interoperability-contract.md (§3, §6.5, §6.5.1), harness/reports/wi-core-025-contract-review.md.
