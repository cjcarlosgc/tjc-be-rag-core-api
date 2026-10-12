# WI-CORE-044 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Autoriza:** el usuario (Human Reviewer), en el chat de Core, relayado por el coordinador. Pregunta: «¿Apruebas el WI de corrección de Core para los tres defectos (constructor, símbolos de test, ruta PHP) con prueba roja-verde, con prioridad sobre WI-CORE-004?» Respuesta: «Sí, hazlo ya». Cross: «ve como lo acomodas para ganar tiempo».

## Alcance aprobado
1. **CONSTRUCTOR:** la búsqueda del chunk de un símbolo `CONSTRUCTOR` no filtra solo por `METHOD` (retrieval y `CodeChunksRepository.findBySymbol`; PHP y TypeScript). Causa verificada en la base real: el parser persiste `symbolKind` `CONSTRUCTOR` y el símbolo del `AnalysisRun` lo colapsa a `METHOD`. Arreglo mínimo y seguro sin cambiar el chunk key persistido.
2. **Símbolos de archivos de test:** excluir de los objetivos de generación los símbolos de archivos de test (clase y métodos de `tests/…Test.php` y equivalentes TypeScript) en la selección de candidatos de `analysis-run-validation-job.handler.ts`, sin cambiar el pool de indexación ni lo persistido en `analysis_symbols` si afecta a otros consumidores (se verifica y documenta quién lo lee).
3. **Ruta PHP duplicada** `tests/Unit/tests/Unit/...` (`phpTestLocation`): sin revertir `DEC-PHP-GEN-001`/`002`; si el arreglo exigiera cambiarlas, `DECISION_REQUIRED`.

## Fuera de alcance
Contratos, DTO, Sandbox, GitHub Integration, migraciones. Sin push ni PR; no se ejecuta `build` en `app/` (protege el Core local E2E en vivo). El usuario emite el veredicto final; no se declara `W-DONE` sin él.

## Ampliación de alcance (2026-10-12, usuario, directa en el chat de Core)
Tras la revisión independiente (ciclo 1, APPROVED con tres riesgos menores), el usuario respondió a la pregunta de cierre: «corrige los 3 riesgos menores y pásale un review más». Se amplía el alcance con: (1) colisión METHOD/CONSTRUCTOR homónimos en `RetrievalService`/`findBySymbol` (elegir un solo `symbolKind` ganador, METHOD preferido, y reunir las partes solo de ese kind); (2) `isTestSourcePath` sensible a `projectRoot` (PHP: `tests/` solo en la raíz del proyecto más sufijo `Test.php`; TS/JS: `__tests__`, sufijos `.spec`/`.test` y `tests/`/`test/` solo en la raíz); (3) la misma exclusión de archivos de test en el evaluador funcional (`ACTION_REQUIRED`), sin cambiar `analysis_symbols`, trace, evidencia 027, experimentos ni OE2 (su contrato §6.16 lo exige). Cada corrección con prueba roja y luego verde, sin build en `app/`, sin contratos ni `php-test-path.ts`. Segunda revisión del agente `reviewer` (ciclo 2 de 2); no se declara `W-DONE` sin el veredicto del usuario.
