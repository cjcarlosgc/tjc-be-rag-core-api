# WI-CORE-044 — Verificación SDD breve
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Alcance ya fijado por el usuario (`wi-core-044-scope-approval.md`); sin decisión nueva ni cambio de contrato (`contractImpact=false`).

## Defecto 1 — CONSTRUCTOR sin chunk
- Parser: `php-parser.service.ts:175` y `typescript-parser.service.ts` guardan `symbolKind` `CONSTRUCTOR` en `code_chunks`; `snapshot-analysis-job.handler.ts:60` (`CHUNK_SYMBOL_TO_ANALYSIS_KIND`) colapsa `CONSTRUCTOR` a `METHOD` en `analysis_symbols`.
- Búsqueda: `retrieval.service.ts:95-104` pide `symbolKind = 'METHOD'` para un objetivo de método y `CodeChunksRepository.findBySymbol` filtra por igualdad: el chunk `CONSTRUCTOR` no se encuentra y la recuperación lanza `UNRESOLVABLE_TARGET`.
- Arreglo mínimo: `findBySymbol` acepta una lista de `symbolKind` y un objetivo de método busca `['METHOD', 'CONSTRUCTOR']`; el chunk key persistido no cambia (sin reindexación: la búsqueda alcanza a las versiones ya indexadas).
- Consumidores de `findBySymbol`/`RetrievalService.retrieve`: producto (validador), experimentos, comparación OE2 y evidencia indirecta; todos comparten el `RetrievalTarget` de `symbol-target.util.ts`.

## Defecto 2 — símbolos de archivos de test como objetivos
- Origen: `analysis_symbols` persiste los símbolos de todos los archivos cambiados, incluidos los de tests. El validador (`analysis-run-validation-job.handler.ts`, filtro de `candidates`) los toma como objetivos y genera un test para un test.
- Consumidores de `analysis_symbols` (`findByAnalysisRun`): validador, evaluador funcional y construcciones de comportamiento (`ACTION_REQUIRED`), trace y evidencia 027, experimentos (`experiments.service.ts:139`), comparación OE2 (`retrieval-comparisons.service.ts:232`) y el controlador de `analysis-runs`. Por eso NO se cambia lo persistido; se aplica el predicado de archivo de test solo en la selección de candidatos de generación del validador (alcance aprobado).
- Riesgo registrado para el usuario: el evaluador funcional y el trace siguen viendo esos símbolos (un método de test con ramas podría originar una pregunta `ACTION_REQUIRED`); extenderlo es una decisión aparte.

## Defecto 3 — ruta PHP duplicada
- `phpTestLocation` (`php-test-path.ts`) conserva la ruta completa fuera de `app/` (`DEC-PHP-GEN-001`): un archivo `tests/Unit/FooTest.php` produce `tests/Unit/tests/Unit/...`. La duplicación es consecuencia del defecto 2 (un archivo de test nunca debería ser objetivo). Se corrige en la raíz con el defecto 2; `DEC-PHP-GEN-001/002` no se revierten ni se cambian.
