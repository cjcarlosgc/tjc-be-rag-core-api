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

## Alineación SMART V3 (SDD 2026-10-08; implementación pendiente)

- **`GenerationContext` objetivo:** `{ target, relatedChunks, functionalRules, metadata }`. `functionalRules` es la lista de reglas `ACTIVE` aplicables al Project y al target, separada del contexto de código, cada una con `knowledgeId`, `scenarioKey`, `normalizedRule`, `scope`, `targetRef` y procedencia (`confirmedByUserId`, `confirmedRole`, `originHeadSha`, `source`, `sourceRef`). La recuperación es determinista (Project + target + `ACTIVE` + aplicabilidad), sin embeddings, chunks ni pgvector. Comentarios, nombres y retornos del código no son verdad funcional por sí mismos. Hoy el contexto no incluye `functionalRules`. Implementación: `WI-CORE-021`.
- **OE2 SE vs SEM (HU05, HU17):** capacidad experimental de solo retrieval, separada de OE5 y del producto. Parámetro `RETRIEVAL_MODE=SE|SEM`; el producto usa siempre `SE`. Iguales en ambos modos: Project/ProjectVersion, snapshot, target, chunks, embeddings, query anchor, los 20 candidatos semánticos y las exclusiones generales. `SEM`: solo semántico, coseno, `semanticScore`, sin refuerzo estructural, 10 primeros. `SE`: 20 semánticos + estructurales, unión y deduplicación, `0.7·semántico + 0.3·estructural` configurable, 10 primeros. No invoca LLM, Functional Knowledge, `ACTION_REQUIRED`, generación, Sandbox ni publicación. P@10/R@10 principales y P@5/R@5 secundarias; la verdad de terreno es externa y sin ella `metrics` es `null`. Contrato: `INTEROP-2.7` §6.15. Implementación para TypeScript: `WI-CORE-022`. No se asigna una HU nueva: encaja en HU05 y HU17.
- **PHP estructural:** R-PHP1 `IMPORTS`, R-PHP2 `IMPORTED_BY`, R-PHP3 mismo namespace, R-PHP4 referencia fully qualified, R-PHP5 clase declarante. Diferido con `WI-CORE-028` hasta cerrar `WI-CORE-013` y la coordinación con Sandbox.
- **Identificadores de trace:** cada ejecución de retrieval por target recibe un `retrieval_id` y cada contexto construido un `context_id` (`WI-CORE-026`, feature `011-context-traces`).

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
