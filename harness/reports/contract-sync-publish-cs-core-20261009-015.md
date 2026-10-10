# Publicación de Contract Sync — CS-CORE-20261009-015 (CS-3 de WI-CORE-027)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09 (America/Lima). Origen: WI-CORE-027 (`DEC-EVID-001`, aprobada por el usuario). Destino: Console (`WI-CONSOLE-017`/`020`). `breaking=true` (compilación TypeScript estricta). Estado inicial `C-PENDING`; el outbox queda en Core hasta que el usuario decida que Console lo importe.

`CS-CORE-20261009-015`: siete campos de `StrategyMetricsResponse` a `number | null` y contadores `evaluableRepetitions`/`nonEvaluableRepetitions`; `executionDurationMs` también `null` si ninguna repetición evaluable invocó el Sandbox. `sourceRevision` `55e3ec9` (código del corte D; el texto de INTEROP está en `c96e1e8`). Texto ratificado en `harness/reports/wi-core-027-contract-review-6-5.md`. Relacionado: `CS-CORE-20261009-014` (evidencia).

**Nota (revisión independiente de `WI-CORE-027`, 2026-10-10):** el `sourceRevision` `55e3ec9` antecede a las correcciones finales de texto de §6.5 (`3f06f44`: medias de `generationDurationMs`/`totalDurationMs` = media de no nulos, `null` si ninguna evaluable la registró, y la excepción de `IDEA-017` que conserva `0` por repetición). El evento no se reescribe; Console debe tomar §6.5/§6.5.1 de la revisión final de documentos de Core (`3f06f44` o posterior). Sus tipos y contadores coinciden con el código.
