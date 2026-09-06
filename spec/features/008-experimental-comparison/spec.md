# 008-experimental-comparison — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** HU19

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
- `INTEROP-1.1` fija el transporte y DTO experimental con `RAG|GENERALIST_AGENT`; esto no resuelve la operación interna pendiente en `DEC-EXP-002`.

### DEC-EXP-001 — Baseline experimental realista

**Estado:** APROBADO

**Supersedes:** baseline compuesto por target aislado sin retrieval ni exploración

El brazo de referencia es `GENERALIST_AGENT`; el término académico “baseline” puede conservarse para nombrar su función comparativa, pero nunca vuelve a significar LLM sin contexto o sin acceso al repositorio.

### DEC-EXP-002 — Contrato operativo del agente generalista

**Estado:** PENDING

**Blocks:** HU19

**Pregunta:** antes de implementar HU19, definir herramientas read-only permitidas, límites de llamadas/archivos/tokens/tiempo, forma de entregar el snapshot, trazabilidad de la trayectoria, política sobre pruebas existentes y reglas de paridad frente al brazo RAG. El implementador no debe simular el agente con un contexto fijo ni darle shell irrestricto por defecto.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
- No implementar como control un LLM sin exploración del repositorio.
- No hacer obligatoria una ablación semántico vs estructural vs híbrido; esa variante queda descartada del alcance acordado.
