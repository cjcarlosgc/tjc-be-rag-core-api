# Cierre — WI-CORE-045
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-052 · **Casos:** OC02, OC08, OC11, OC15

## Veredicto del usuario
Directo en el chat de Core (2026-10-12): «Sí, cerrar W-DONE». Revisión humana; sin reviewer agente.

## Qué entrega
INTEROP-2.9 (aclaratoria, `breaking: false`): `404 FUNCTIONAL_QUESTION_NOT_FOUND` y orden de errores de `POST …/answers`, `continuationAttemptId` null/opaco, semántica de `functionalBehaviorValidated`, `resultSummary` objetivo de OC11 (pendiente; el límite de 300 pertenece a GitHub Integration). SYSTEM-2.9 registra `DEC-VAL-002` como PROPOSED. Texto fuente `30b9acdfbc063b027ad891799574b4553574559e`; eventos `CS-CORE-20261012-005` (console) y `CS-CORE-20261012-006` (github-integration).

## Decisión del usuario sobre DEC-VAL-002 (mismo mensaje)
Textual: «Si un fallo de plataforma impide validar de forma fiable uno o más símbolos elegibles del Run, el resultado agregado del AnalysisRun debe ser INFRASTRUCTURE_FAILURE, por encima de cualquier clasificación funcional o técnica parcial obtenida en otros símbolos.» No es la recomendada ni A2 ni A3. Se consolida como APROBADA en un WI de contrato aparte (SYSTEM-2.10) porque este WI ya está cerrado.
