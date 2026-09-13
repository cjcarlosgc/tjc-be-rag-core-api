# 008-experimental-comparison — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** HU19, HU27, HU28

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
- Métricas obligatorias: compiled,executed,passed,valid,failureType,generationDurationMs,executionDurationMs,totalDurationMs,inputTokens,outputTokens,totalTokens,estimatedCost cuando proveedor permita datos suficientes.
- Métricas RAG explicativas: retrievedChunks,selectedChunks,contextTokens.
- Métricas explicativas del agente generalista: toolCalls,filesInspected y contexto/tokens atribuibles a la exploración cuando el proveedor permita observarlos.
- Agregados: tasas, diferencia en puntos porcentuales, media/mediana de tiempos/tokens/costo y distribución de failureType.
- Coverage se evalúa como métrica secundaria en Sprint 4 si resulta homogénea/viable; no bloquea PI1.
- `INTEROP-2.0` conserva el transporte y DTO experimental con `RAG|GENERALIST_AGENT`; la operación interna del agente generalista queda resuelta en `DEC-EXP-002` (APROBADO, ver más abajo).
- `POST /experiments` exige `Idempotency-Key`; un replay equivalente devuelve el mismo experimento. Cada repetición/estrategia deriva su propia identidad Sandbox estable de `experiment:{jobId}:{strategy}:{repetition}`.

### DEC-EXP-001 — Baseline experimental realista

**Estado:** APROBADO

**Supersedes:** baseline compuesto por target aislado sin retrieval ni exploración

El brazo de referencia es `GENERALIST_AGENT`; el término académico “baseline” puede conservarse para nombrar su función comparativa, pero nunca vuelve a significar LLM sin contexto o sin acceso al repositorio.

### DEC-EXP-002 — Contrato operativo del agente generalista

**Estado:** APROBADO

**Resolución:**

1. **Herramientas** (todas read-only, sin shell/red/escritura, acotadas al snapshot del `ProjectVersion`): listar archivos, leer contenido de un archivo, buscar texto/símbolo (grep), seguir imports/referencias de un archivo, y capacidades de TypeScript language service (ir a definición, buscar referencias, inspeccionar tipos).
2. **Entrega del snapshot:** se reutiliza el mismo mecanismo de materialización de workspace ya usado por indexación/generación (extracción del ZIP a un directorio temporal); no se inventa un mecanismo de acceso nuevo.
3. **Trazabilidad de la trayectoria:** se persiste la trayectoria completa del agente — secuencia ordenada de tool calls con argumentos y resultado resumido — como evidencia auditable/reproducible. Las métricas agregadas `toolCalls`/`filesInspected` se derivan de esa trayectoria, no la reemplazan.
4. **Política sobre pruebas existentes:** los archivos `*.test.ts`/`*.spec.ts` que cubren el target actual quedan excluidos de la vista del snapshot que recibe el agente, para evitar que copie la prueba existente en vez de generarla y mantener comparabilidad con RAG.
5. **Límites y paridad frente a RAG:** mismo presupuesto de tokens de contexto que usa `ContextBuilder` para RAG (`maxContextTokens`), mismo timeout de generación del pipeline, y un tope de ~20 tool calls para evitar loops de exploración descontrolados.

El implementador no debe simular el agente con un contexto fijo ni darle shell irrestricto por defecto; el diseño anterior es la resolución definitiva, pendiente de implementación.

Para HU27/HU28, la trayectoria JSON existente debe migrar a la forma normalizada y consultable de `011-context-traces`: hashes, rangos, snippets, truncamiento, resultados vacíos/errores y archivos descubiertos paginables. Las métricas agregadas se conservan.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
- No implementar como control un LLM sin exploración del repositorio.
- No hacer obligatoria una ablación semántico vs estructural vs híbrido; esa variante queda descartada del alcance acordado.

## Cierre de la brecha de implementación SDD 1.14

Resuelto en SDD 1.15: `POST /experiments` aplica `IdempotencyService` (scope `EXPERIMENT_CREATE`), y cada repetición deriva su propia identidad Sandbox estable `experiment:{jobId}:{strategy}:{repetition}` (`sandboxExperimentRequestId`) conforme a `DEC-IDEMP-001`.
