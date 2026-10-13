# 008-experimental-comparison — Especificación

**Estado:** comparación aprobada como objetivo; entrada live por AnalysisRun implementada en WI-CORE-035; aceptación integrada por evidencia pendiente.
**Historias:** HU17, HU18

La adaptación live de `POST /experiments` queda registrada en `WI-CORE-035`: recibe `analysisRunId`, `symbolFilePath` y `symbolQualifiedName`; Core autoriza sobre el AnalysisRun y resuelve el `TestTarget` interno desde la versión congelada del Run. El contrato canónico ya define esa forma en INTEROP-2.7 §6.5; esta tarea implementa conformidad sin cambiar el contrato ni el DTO público.

El experimento productivo parte de un `AnalysisRun` real y un símbolo elegible del changeset, según INTEROP-2.8 §6.5. El código que aún dependa de selección manual de `TestTarget` es deuda de adaptación, no otra ruta de producto.

## Objetivo

Ejecutar una comparación pareada entre la arquitectura RAG especializada y un agente generalista para producir evidencia objetiva de tesis.

## Reglas y comportamiento

- Único experimento principal V1: `RAG` vs `GENERALIST_AGENT`.
- `GENERALIST_AGENT` = agente de código contemporáneo que recibe el objetivo y puede buscar archivos, abrir contenido y seguir referencias dentro del mismo `ProjectVersion` mediante un conjunto controlado de herramientas; decide por su cuenta qué contexto utilizar antes de generar la prueba.
- `RAG` = arquitectura especializada que adquiere contexto mediante retrieval semántico + estructural y lo construye explícitamente mediante ranking/selección/presupuesto antes de generar la prueba.
- Mantener mismo `ProjectVersion`, target, generation mode, familia y versión del LLM, parámetros comparables, Sandbox, runtime/framework y límites de ejecución. La instrucción de tarea debe ser semánticamente equivalente, pero no se exige un prompt idéntico porque el agente generalista requiere instrucciones/herramientas de exploración diferentes.
- La variable de interés es la política de adquisición y construcción de contexto. Registrar también el costo de esa adquisición: tool calls/archivos consultados para el agente y retrieved/selected chunks para RAG.
- Evaluación principal first-shot; autorreparación desactivada. No existe experimento RAG+autorepair.
- Default de tesis: 3 repeticiones por target y estrategia.
- `completedRepetitions` cuenta slots lógicos distintos `(strategy, repetition)` que alcanzaron estado terminal (`COMPLETED` o `FAILED`) en al menos un intento. Reintentar un slot no suma otra repetición ni permite superar `totalRepetitions`.
- Métricas obligatorias: compiled,executed,passed,valid,failureType,generationDurationMs,executionDurationMs,totalDurationMs,inputTokens,outputTokens,totalTokens,estimatedCost cuando proveedor permita datos suficientes.
- Métricas RAG explicativas: retrievedChunks,selectedChunks,contextTokens.
- Métricas explicativas del agente generalista: toolCalls,filesInspected y contexto/tokens atribuibles a la exploración cuando el proveedor permita observarlos.
- Agregados: tasas, diferencia en puntos porcentuales, media/mediana de tiempos/tokens/costo y distribución de failureType.
- Coverage se evalúa como métrica secundaria en Sprint 4 si resulta homogénea/viable; no bloquea PI1.
- `INTEROP-2.8` conserva el transporte experimental y agrega la raíz efectiva congelada por versión y ejecución; la operación interna del agente generalista queda resuelta en `DEC-EXP-002` (APROBADO, ver más abajo).
- `POST /experiments` exige `Idempotency-Key`; un replay equivalente devuelve el mismo experimento. Cada repetición/estrategia deriva su propia identidad Sandbox estable de `experiment:{jobId}:{strategy}:{repetition}`.

### DEC-EXP-001 — Baseline experimental realista

**Estado:** APROBADO

**Supersedes:** baseline compuesto por target aislado sin retrieval ni exploración

El brazo de referencia es `GENERALIST_AGENT`; el término académico “baseline” puede conservarse para nombrar su función comparativa, pero nunca vuelve a significar LLM sin contexto o sin acceso al repositorio.

### DEC-EXP-002 — Contrato operativo del agente generalista

**Estado:** APROBADO

**Resolución:**

1. **Herramientas** (todas read-only, sin shell/red/escritura, acotadas al snapshot del `ProjectVersion`): listar archivos, leer contenido de un archivo, buscar texto/símbolo (grep), seguir imports/referencias de un archivo, y capacidades de TypeScript language service (ir a definición, buscar referencias, inspeccionar tipos).
2. **Entrega del snapshot:** se reutiliza la materialización interna del commit fijado; su ZIP privado puede extraerse en un directorio temporal, sin introducir carga manual.
3. **Trazabilidad de la trayectoria:** se persiste la trayectoria completa del agente — secuencia ordenada de tool calls con argumentos y resultado resumido — como evidencia auditable/reproducible. Las métricas agregadas `toolCalls`/`filesInspected` se derivan de esa trayectoria, no la reemplazan.
4. **Política sobre pruebas existentes:** reemplazada por `DEC-EXP-003` (2026-10-08): el agente puede descubrir y leer las pruebas existentes mediante sus herramientas; ya no se excluyen de su vista y tampoco se le entregan directamente.
5. **Límites y paridad frente a RAG:** mismo presupuesto de tokens de contexto que usa `ContextBuilder` para RAG (`maxContextTokens`), mismo timeout de generación del pipeline, y un tope de ~20 tool calls para evitar loops de exploración descontrolados.

El implementador no debe simular el agente con un contexto fijo ni darle shell irrestricto por defecto; el diseño anterior es la resolución definitiva, pendiente de implementación.

Para HU15/HU17, la trayectoria observable se expone en la forma normalizada y consultable de `011-context-traces`: hashes, rangos, snippets, truncamiento, resultados vacíos/errores y archivos descubiertos paginables. Las métricas agregadas se conservan.

## Alineación SMART V3 — OE5 (SDD 2026-10-08; implementación pendiente)

Decisiones: `DEC-EXP-FK-001` y `DEC-EXP-003`, ambas `APROBADO`. Contrato: `INTEROP-2.8` §6.5.1.

- OE5 compara la arquitectura RAG completa con un agente generalista competente de solo lectura, bajo condiciones experimentales externas controladas; no mide solo retrieval y no afirma paridad estricta de información. RAG usa `SE`, `ContextBuilder` y el conocimiento funcional `ACTIVE` aplicable; el agente explora sin retriever RAG, sin `ContextBuilder` y sin conocimiento funcional persistente. Ninguno recibe el oráculo.
- Condiciones comunes: repositorio, PR/HEAD, snapshot, target, proveedor, modelo y versión, esfuerzo de razonamiento, parámetros comunes, perfil de Sandbox y presupuesto comparable (tope de tool calls, presupuesto de contexto, tokens, archivos y duración). El razonamiento no se degrada en silencio. **Hallazgo:** el agente lee hoy `reasoning_effort` por su cuenta y usa el SDK de OpenAI directamente, así que puede divergir del brazo RAG; `WI-CORE-023` lo unifica detrás de `LLMProvider`.
- Herramientas del agente: `list_files`, `read_file`, `search_text` e `inspect_symbol`/referencias. Prohibidos: shell, Composer/PHPUnit/Jest/Vitest, escritura, Internet y GitHub API (`WI-CORE-024`).
- Diseño pareado: 3 repeticiones por estrategia forman 3 pares, cada repetición en sesión fresca; el orden dentro del par es aleatorio y reproducible desde `randomizationSeed`; se persisten `pairId`, `pairPosition`, `attempt` y configuración. Un fallo de la estrategia no admite reintento de calidad; un fallo externo demostrado admite como máximo uno; un segundo fallo de infraestructura deja la repetición `technicallyEvaluable: false`. **Hallazgo:** no existe pairing, orden ni seed formales (`WI-CORE-025`).
- Jerarquía: CF primaria, CO secundaria y VT guardrail; CF/CO son externas y no se derivan de `valid`/`passed`; no hay ganador automático ni significancia estadística en el backend (`spec/transversal/experimental-metrics`).
- Core soporta experimentos PHP/PHPUnit por `WI-CORE-013` y `WI-CORE-029`; el piloto cross-repo sigue condicionado a que Core y Sandbox sincronicen e implementen `projectRoot` (WIs locales pendientes; Core `WI-CORE-036`/`037`) y a congelar/verificar los snapshots externos.

## Piloto controlado de compatibilidad PHP

Este piloto complementa, pero no sustituye ni renumera, los casos operativos `OC01`–`OC15`. El handoff propone tres repositorios externos reportados como **Validación Ventas**, **Reservas** y **Suscripciones**, con tres targets cada uno. Sus permisos, HEADs, `projectRoot`, dependencias y existencia de símbolos deben confirmarse antes de ejecutar; esta tabla es un protocolo de selección, no evidencia verificada ni fuente de verdad funcional. No copiar ni almacenar oráculos en repositorios de producto.

| Repo piloto | Target | Categoría reportada | Símbolo reportado |
| --- | --- | --- | --- |
| Validación Ventas | SAL-1 | Local | `DiscountCalculator::applyPercentage()` |
| Validación Ventas | SAL-2 | Functional | `DiscountPolicy::discountFor()` |
| Validación Ventas | SAL-3 | Structural | `OrderPricingService::calculateTotal()` |
| Reservas | RES-1 | Local | `ReservationPeriod::durationMinutes()` |
| Reservas | RES-2 | Structural | `AvailabilityService::canReserve()` |
| Reservas | RES-3 | Functional | `CancellationPolicy::refundAmount()` |
| Suscripciones | SUB-1 | Local | `PlanPriceCalculator::monthlyAmount()` |
| Suscripciones | SUB-2 | Structural | `RenewalService::renew()` |
| Suscripciones | SUB-3 | Functional | `Subscription::handleFailedPayment()` |

Plan de medición: 3 repeticiones por target y estrategia (`RAG` y `GENERALIST_AGENT`), en sesiones frescas y con las condiciones pareadas de esta especificación: **9 targets, 27 pares y 54 ejecuciones**. Antes de la primera corrida se congela y registra el `repositoryId`, commit SHA y `effectiveProjectRoot` de cada repo; cada ejecución posterior usa el mismo snapshot del par. Se registran CF primaria, CO secundaria y VT guardrail, más métricas técnicas/costo ya definidas; ninguna se interpreta como oráculo ni produce un ganador automático. No se modifica ningún repo piloto ni se hace E2E hasta verificar acceso y congelar sus revisiones.

## Evidencia privada por repetición (`WI-CORE-053`, 2026-10-13)

Cada repetición que invoca al Sandbox persiste, en la tabla privada `experiment_repetition_artifacts` (1:1, `ON DELETE CASCADE`, RLS sin acceso para `anon`/`authenticated`), el contenido exacto de la prueba enviada (hasta 256 KiB UTF-8, con `testContentSha256` del contenido completo y marca de recorte) y un reporte con los hechos normalizados del runner (hasta 200 casos con `errorMessage` saneado de hasta 500 caracteres, hecho de fallo y duraciones por etapa) con su sha256. El Sandbox no devuelve stdout/stderr: la salida en bruto es un pedido aparte que requeriría extender el contrato del Sandbox. La escritura es best-effort y no altera el resultado, el estado ni el reintento de la repetición; no se expone en `ExperimentRepetitionResponse`, trace ni §6.16 (solo `artifactHash` ya definido). No hay purga: `DEC-VAL-001` sigue `PENDING`, por lo que solo aplica a repositorios de piloto; el contenido del código de terceros se guarda tal como se envió al Sandbox. La migración `20261013100000_experiment_repetition_artifacts` es aditiva y se aplica con autorización explícita.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
- No implementar como control un LLM sin exploración del repositorio.
- No hacer obligatoria una ablación semántico vs estructural vs híbrido; esa variante queda descartada del alcance acordado.

## Cierre de la brecha de implementación SDD 1.14

Resuelto en SDD 1.15: `POST /experiments` aplica `IdempotencyService` (scope `EXPERIMENT_CREATE`), y cada repetición deriva su propia identidad Sandbox estable `experiment:{jobId}:{strategy}:{repetition}` (`sandboxExperimentRequestId`) conforme a `DEC-IDEMP-001`.
