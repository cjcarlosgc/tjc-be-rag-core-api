# 004-rag-retrieval-context — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** HU05, HU10, HU15, HU17

## Objetivo

Recuperar contexto relevante y construir GenerationContext controlado y trazable.

## Reglas y comportamiento

- TestTarget: projectId,filePath,symbolName,methodName?,targetType CLASS|METHOD|FUNCTION.
  - CLASS: `symbolName` = nombre de la clase, sin `methodName`.
  - METHOD: `symbolName` = nombre de la clase, `methodName` = nombre del método.
  - FUNCTION: `symbolName` = nombre de la función top-level, sin `methodName`.
- Target exacto obligatorio.
- Dirección aprobada RAG V1: recuperación híbrida consciente de la estructura del código, combinando relaciones estructurales y similitud vectorial.
- Import metadata conserva module/symbols/resolvedFilePath cuando resuelva.
- Deduplicar por chunkId.
- Score ponderado configurable; ningún peso se presenta como verdad científica.
- Selección por minimumScore/topK/maxContextTokens; target entra primero.
- `GenerationContext` conserva target, relatedChunks y metadata de lenguaje/framework.
- Para HU15/HU17, la ejecución conserva también todos los candidatos deduplicados, configuración efectiva, ranking, señales, decisión y motivo observable de descarte según `011-context-traces`; esa evidencia no altera el contexto entregado al LLM.

`RetrievalService` entrega candidatos y señales; `ContextBuilder` es una responsabilidad distinta que selecciona, deduplica, ordena, etiqueta y ajusta el contenido al presupuesto. No se considera que un candidato semánticamente próximo sea equivalente por sí mismo a una dependencia estructural.

### DEC-RAG-001 — Incorporación de una señal test-aware

**Estado:** PENDING

**Blocks:** únicamente un work item futuro que pretenda implementar recuperación o ranking test-aware; no bloquea el retrieval híbrido semántico + estructural base

**Pregunta:** después de completar el núcleo de Sprint 2, investigar si mocks, fixtures, factories, test utilities y convenciones existentes deben formar un retriever independiente, señales de ranking o quedar fuera; definir fuentes, metadata, ponderación y evaluación antes de implementar.

La regla general de excluir pruebas existentes del retrieval por supuesto leakage queda descartada. Esto no aprueba todavía un tratamiento test-aware ni obliga a recuperar pruebas: ese comportamiento depende de `DEC-RAG-001`.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
