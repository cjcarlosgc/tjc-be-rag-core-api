# WI-CORE-054 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador: «WI-054: APROBADO versionado aditivo INTEROP-2.13 + evento Contract Sync a Console, con `technicallyValidRate` = compiled ∧ executed ∧ failureType ∈ {NONE, TEST_ASSERTION} (null sin evaluables) y `assertionFailureCount`; pasa por contract-reviewer antes de editar».

## Alcance
`StrategyMetricsResponse` agrega, de forma aditiva y retrocompatible, `technicallyValidRate` y `assertionFailureCount` calculados sobre las repeticiones vigentes con `technicallyEvaluable !== false`; `valid`, `passed` y demás métricas sin cambio. `technicallyValidRate` es `null` si `evaluableRepetitions = 0` (DEC-EVID-001); `assertionFailureCount` cuenta las evaluables con `failureType = TEST_ASSERTION`. INTEROP-2.13 documenta la semántica; Contract Sync a Console (y github-integration solo si el reviewer lo exige). Sin tocar ranking/contexto RAG, clasificación, evidencia ni persistencia.
