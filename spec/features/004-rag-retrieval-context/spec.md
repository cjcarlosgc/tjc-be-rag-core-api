# 004-rag-retrieval-context — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU08, HU09, HU10, HU11, HU12, HU19

## Objetivo

Recuperar contexto relevante y construir GenerationContext controlado y trazable.

## Reglas y comportamiento

- TestTarget: projectId,filePath,symbolName,methodName?,targetType CLASS|METHOD.
- Target exacto obligatorio.
- Fuentes RAG V1: relaciones estructurales + similitud vectorial.
- Import metadata conserva module/symbols/resolvedFilePath cuando resuelva.
- Deduplicar por chunkId.
- Score ponderado configurable; ningún peso se presenta como verdad científica.
- Selección por minimumScore/topK/maxContextTokens; target entra primero.
- `GenerationContext` conserva target, relatedChunks y metadata de lenguaje/framework.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
