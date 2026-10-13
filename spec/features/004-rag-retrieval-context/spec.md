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

## Sección de dependencias PHP (`WI-CORE-057`, 2026-10-13)

Para targets PHP el contexto de generación incluye, aparte de los chunks seleccionados, una sección con los nombres completos (FQCN) de las dependencias del target: tipos del constructor de la clase declarante y de la firma del método (parámetros y retorno), resueltos por `importsUsed`, por un literal con `\` o por el namespace de la clase declarante (solo si el tipo existe en el índice de la versión); un tipo que no resuelve no se inventa y se cuenta como no resuelto; escalares, pseudo-tipos y clases globales internas de PHP no se listan. Es contexto determinista **no rankeado**: no es candidato, no participa en la selección (los 10 primeros), `minimumScore`, `topK`, `maxContextTokens` ni `contextTokens`, ni en las métricas, y no es una señal test-aware (`DEC-RAG-001` sigue `PENDING`); tampoco cambia las relaciones R-PHP1..5 (`DEC-PHP-RET-001`). Tope propio de 20 entradas y 300 tokens (el presupuesto efectivo del prompt es `maxContextTokens` más la sección), con marca `truncated`. Motivo: en el piloto V1 el LLM inventó `Contracts\RenewalDatePolicy` porque el constructor no trae el FQCN de un tipo del mismo namespace (`harness/reports/fase2-01-recuperacion-colaboradores-diagnostico.md`). Se expone de forma aditiva en la traza RAG (`dependencyContext`, INTEROP-2.14). Las corridas posteriores no son comparables con el piloto V1 congelado sin anotar la versión; la comparación OE2 SE vs SEM no la usa. TypeScript y el agente generalista no la reciben.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
