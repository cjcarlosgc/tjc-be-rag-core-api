# 005-test-generation — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU08, HU09, HU10, HU11, HU12

## Objetivo

Generar pruebas unitarias en cinco modos sobre la versión congelada del proyecto.

## Reglas y comportamiento

- Modes: TARGET, CLASS_ALL, CLASS_MISSING, PROJECT_MISSING, PROJECT_ALL.
  - TARGET: modo puntual, resuelve un `TestTarget` exacto de tipo METHOD o FUNCTION (no CLASS) sin excepciones semánticas entre ambos.
- DTO valida campos requeridos y rechaza target fields incompatibles cuando aplique.
- Backend captura atómicamente `currentVersionId` en `TestGenerationRun`.
- Generation while project indexing is active se bloquea para evitar ambigüedad.
- No missing targets es COMPLETED con totalTargets=0 y reason=NO_MISSING_TARGETS.
- LLMProvider.generate(prompt) desacoplado.
- Prompt recibe código/contexto, no embeddings.
- CREATE si no existe test relevante; MERGE con ts-morph si existe, preservando tests. Múltiples métodos deben fusionarse sobre workspace/artifact evolucionado del run.
- El transporte externo usa `POST /test-runs`, status y resultados definidos en `spec/contracts/interoperability-contract.md`; los DTO HTTP no exponen prompts, embeddings ni keys de Storage.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
