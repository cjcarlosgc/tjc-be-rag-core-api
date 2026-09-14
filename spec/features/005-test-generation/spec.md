# 005-test-generation — Especificación

**Estado:** RETIRED — ver `CHANGELOG.md`.
**Historias:** HU08, HU09, HU10, HU11, HU12

> Los cinco modos manuales quedan retirados como producto, no solo como camino legacy: ya no existe `POST /test-runs` ni contrato HTTP para generación manual. En SDD 2.1 la generación nace de un `AnalysisRun`, sus símbolos cambiados/impactados y el contexto recuperado (HU39-40, pendiente de implementación); la publicación requiere revisión humana y freshness check.

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
- `POST /test-runs` exige `Idempotency-Key`: Core persiste la key y una huella canónica de `CreateTestRunRequest`; el replay equivalente devuelve el mismo `runId` y nunca crea otro run/job. Una key reutilizada con otro request devuelve `409 IDEMPOTENCY_CONFLICT`.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.

## Cierre de la brecha de implementación SDD 1.14

Resuelto en SDD 1.15: `POST /test-runs` valida el header (`400 IDEMPOTENCY_KEY_REQUIRED`/`INVALID_IDEMPOTENCY_KEY`), reserva `IdempotencyRecord` (scope `TEST_RUN_CREATE`) y crea `TestGenerationRun` + job en una misma transacción (`IdempotencyService`, `spec/transversal/persistence/spec.md`).
