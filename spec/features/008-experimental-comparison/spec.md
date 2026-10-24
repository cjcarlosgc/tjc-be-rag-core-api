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

## Repositorios piloto del experimento (protocolo; sin identidades en el SDD)

Los pilotos de OE5 y la evaluación confirmatoria son repositorios externos PHP/PHPUnit elegidos y documentados por el equipo investigador. Sus identidades, la modalidad del cambio (controlado o basado en un issue público), los targets y los oráculos son **decisiones de investigación** y viven fuera de este SDD (en el registro de evidencia de la tesis y en el `AGENTS.md` de la sesión coordinadora); no se replican aquí para que no queden desactualizadas. Este SDD fija solo lo que Core debe cumplir:

- Antes de la primera corrida de un piloto se congela y registra, por repositorio, el `repositoryId`, el commit SHA/HEAD y el `effectiveProjectRoot`; cada ejecución posterior de un par usa el mismo snapshot.
- Se aplican el diseño pareado y las condiciones comunes de «Alineación SMART V3 — OE5» (repeticiones por target y estrategia en sesiones frescas, orden aleatorio reproducible, misma configuración de LLM y presupuesto comparable).
- Se registran CF primaria, CO secundaria y VT guardrail, más las métricas técnicas y de costo ya definidas; ninguna se interpreta como oráculo ni produce un ganador automático.
- Los oráculos permanecen externos: no se copian ni almacenan en repositorios de producto ni piloto (su exclusión de los inputs de RAG y GENERALIST_AGENT está en «Alineación SMART V3 — OE5»).
- No se modifica ningún repositorio piloto ni se hace E2E hasta verificar acceso y congelar sus revisiones.

Los pilotos complementan, sin sustituir ni renumerar, los casos operativos `OC01`–`OC15`.

## Evidencia privada por repetición (`WI-CORE-053`, 2026-10-13)

Cada repetición que invoca al Sandbox persiste, en la tabla privada `experiment_repetition_artifacts` (1:1, `ON DELETE CASCADE`, RLS sin acceso para `anon`/`authenticated`), el contenido exacto de la prueba enviada (hasta 256 KiB UTF-8, con `testContentSha256` del contenido completo y marca de recorte) y un reporte con los hechos normalizados del runner (hasta 200 casos con `errorMessage` saneado de hasta 500 caracteres, hecho de fallo y duraciones por etapa) con su sha256. El Sandbox no devuelve stdout/stderr: la salida en bruto es un pedido aparte que requeriría extender el contrato del Sandbox. La escritura es best-effort y no altera el resultado, el estado ni el reintento de la repetición; no se expone en `ExperimentRepetitionResponse`, trace ni §6.16 (solo `artifactHash` ya definido). No hay purga: `DEC-VAL-001` sigue `PENDING`, por lo que solo aplica a repositorios de piloto; el contenido del código de terceros se guarda tal como se envió al Sandbox. La migración `20261013100000_experiment_repetition_artifacts` es aditiva y se aplica con autorización explícita.

## Reconstrucción interna de un trial (`WI-CORE-060`, 2026-10-13)

De forma aditiva e interna (sin DTO público ni §6.16, sin cambiar el Sandbox), Core persiste lo necesario para reconstruir un trial sin cruzar tablas: `ExperimentRun.analysisRunId` y `commitSha`; por intento, `startedAt`/`finishedAt` y `promptSha256` (solo el hash del prompt enviado: del prompt RAG o de las instrucciones iniciales del agente; el texto no se guarda mientras `DEC-VAL-001` esté `PENDING`); y, en `experiment_repetition_artifacts`, la evidencia acotada que el Sandbox ya devuelve (`evidence[]`: salida del compilador, de las pruebas y reporte del runner, con `truncated`/`originalBytes`), saneada (secretos redactados, sin NUL) con tope de 8 KiB por entrada y 40 KiB en total, y `startedAt`/`completedAt` del Sandbox. Core ya no descarta esos campos en `fetchResult`. La escritura es best-effort y no altera el resultado, el estado ni el reintento de la repetición. Migración `20261013110000_experiment_trial_reconstruction` aditiva y nullable (no aplicada hasta orden); las filas anteriores quedan sin dato (sin backfill: los trials del piloto V1 no tienen salida del Sandbox). Sin purga; stdout/stderr puede contener código de terceros (solo repositorios de piloto).

## Tiempos por etapa del Sandbox (`WI-CORE-061`, 2026-10-14)

El Sandbox (`WI-SANDBOX-007`, `CS-SANDBOX-20261014-001`) agrega a cada etapa de `stageDurations[]` las marcas ISO-8601 UTC opcionales `startedAt` y `completedAt` junto a `durationMs`. Core las conserva por etapa cuando son válidas (se omiten sin error si faltan o son inválidas) y las persiste de forma interna dentro de `runnerReport.stageDurations` del artefacto de la repetición (sin migración, sin DTO público ni §6.16); un Sandbox anterior sigue funcionando y sus reportes no cambian. Con ellas se puede medir la espera antes de `PREPARING` (frente al inicio del intento de Core) y entre etapas. La incorporación documental de los campos a INTEROP §7.3 queda pendiente de una decisión aparte.

## Corridas de prueba y corridas de evidencia (`WI-CORE-075`, 2026-10-21)

Los experimentos usan la configuración única del LLM (`spec/transversal/providers/spec.md`, `DEC-EXP-005`): modelo `gpt-6-luna` y el esfuerzo que fije el entorno. **`low` es una corrida de prueba** (verificación económica del flujo, sin valor de evidencia) y **`medium` es evidencia oficial** (piloto, confirmatorio OE5 y OE2), congelado por protocolo (tesis 3.3 y Anexo K, por referencia). Las dos clases no se mezclan en un mismo protocolo: la evidencia de un protocolo usa un único modelo y esfuerzo, que se identifican por el `modelConfig` persistido en cada `ExperimentRun` (`model`, `reasoningEffort`) y no por el entorno vigente. No hay una marca ni un bloqueo automáticos: antes de crear un experimento de evidencia se verifica el entorno (`medium`) y después el `modelConfig` del Run. Los experimentos `07b20829` y `924e38ab` (2026-10-13) corrieron con `gpt-5.4-nano` y esfuerzo `none` (modelo descartado) y son solo antecedente histórico.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
- No implementar como control un LLM sin exploración del repositorio.
- No hacer obligatoria una ablación semántico vs estructural vs híbrido; esa variante queda descartada del alcance acordado.

## Cierre de la brecha de implementación SDD 1.14

Resuelto en SDD 1.15: `POST /experiments` aplica `IdempotencyService` (scope `EXPERIMENT_CREATE`), y cada repetición deriva su propia identidad Sandbox estable `experiment:{jobId}:{strategy}:{repetition}` (`sandboxExperimentRequestId`) conforme a `DEC-IDEMP-001`.
