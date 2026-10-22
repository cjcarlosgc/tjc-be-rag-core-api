# WI-CORE-074 (WI-D) — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: tiempo real de `AnalysisRun` y de experimento en Core según el alcance aprobado por el usuario el 2026-10-21 (D1–D4 y DEC-RT-001, todos con la opción recomendada). Commits: corte 1 `4ee7f02`, corte 2 `3c92dfb`, correcciones del ciclo 1 `5c82853`.

- **Seguridad:** el handshake exige sesión válida (la misma que HTTP; `AUTH_REQUIRED`, `INVALID_ACCESS_TOKEN`) y cada suscripción (`project-version`, `analysis-run`, `experiment`) exige Reader sobre el Project con la misma negativa para id inexistente o sin acceso; sin broadcast global; el cliente no puede unirse a salas por su cuenta.
- **Eventos:** `analysis-run:update` y `experiment:update` con el mismo DTO que sus GET (presentadores compartidos), post-commit, best-effort, at-most-once, throttle de progreso 1500 ms; cubiertos todos los cambios de estado (incluidos ACTION_REQUIRED por preguntas funcionales y OBSOLETE por clasificación de PR; la creación del Run y el borrado de Project no emiten).
- **Contrato:** INTEROP-2.18 §6.6, §6.13 y §1; `realtime-events.schema.json` y cinco ejemplos; DEC-RT-001 APPROVED (spec de la feature 013); la prosa de §6.5 y §6.10 se alineó a lo que el servidor emite por elección del usuario («Corregir la prosa a lo real»).
- **Revisión independiente (`reviewer`):** APPROVED_WITH_FINDINGS, ciclo 1; 6 de 7 mutaciones detectadas y el F1 (el throttle de 500 ms sobrevivía) corregido con una prueba que fija 1500 ms (`wi-core-074-independent-review.md`).
- **Revisión contractual (`contract-reviewer`):** CHANGES_REQUESTED en el ciclo 1 (F1 drift de prosa, F2 bullet de §1) y APPROVED en el ciclo 2 de 2 (`wi-core-074-contract-review.md`).
- **Contract Sync publicado:** `CS-CORE-20261021-001` (console, incompatible), `-002` (github-integration), `-003` (sandbox); ver `wi-core-074-contract-sync-publication.md` con los digests.
- `retryLimitRespected`: 2 de 2 ciclos de revisión usados (contract-reviewer); no se supera el máximo.
- Evidencia técnica: `wi-core-074-technical-checks.md` (2621 tests unitarios y 259 e2e).

## Observaciones no bloqueantes

F6 (bajo, drift preexistente): `ExperimentResultsResponse` (`interoperability-contract.md:359-362`) sigue listando `analysisRunId` y `symbol` y el código emite `targetId`; seguimiento. F7: `scopePaths` del evento de Sandbox lista un archivo que no espeja (inocuo). F2 del reviewer (e2e del experimento invoca `markStarted` y `statusChanged` en vez del pipeline del job), F3/F4 menores y heredados. Console debe actualizar el comentario obsoleto de `socket.ts:75` (acción de su WI). `project-version:update` sigue sin productor en producción (reservado en el contrato).

Fuera de alcance: WI-CORE-075 (esfuerzo low/medium) en cola; sin push, PR ni merge; sin tag.
