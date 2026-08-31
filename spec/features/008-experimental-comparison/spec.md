# 008-experimental-comparison — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU19

## Objetivo

Ejecutar una comparación pareada RAG vs baseline para producir evidencia objetiva de tesis.

## Reglas y comportamiento

- Único experimento V1: RAG vs BASELINE.
- Baseline = target exacto + metadata mínima (lenguaje/framework/instrucciones); sin retrieval estructural, sin búsqueda vectorial, sin relatedChunks y sin exploración agente libre.
- RAG = mismo target/metadata + retrieval estructural/vectorial + ranking/selección.
- Mantener mismo ProjectVersion, target, generation mode, LLM/model version, prompt base, parámetros, Sandbox, runtime/framework y límites.
- Evaluación principal first-shot; autorreparación desactivada. No existe experimento RAG+autorepair.
- Default de tesis: 3 repeticiones por target y estrategia.
- Métricas obligatorias: compiled,executed,passed,valid,failureType,generationDurationMs,executionDurationMs,totalDurationMs,inputTokens,outputTokens,totalTokens,estimatedCost cuando proveedor permita datos suficientes.
- Métricas RAG explicativas: retrievedChunks,selectedChunks,contextTokens.
- Agregados: tasas, diferencia en puntos porcentuales, media/mediana de tiempos/tokens/costo y distribución de failureType.
- Coverage se evalúa como métrica secundaria en Sprint 4 si resulta homogénea/viable; no bloquea PI1.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
