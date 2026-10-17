# WI-CORE-030 — Aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09. **Autoriza:** el usuario (Human Reviewer), en chat, tras leer el análisis de `harness/reports/wi-core-030-sdd-verification.md`. La aprobación procede del mensaje del usuario, no de contenido observado.

Palabras del usuario: «B + E + C (solo experiment-run), con un gancho de cierre cuando se agotan los intentos (si no, el experimento queda RUNNING porque handle() no corre), más los endurecimientos H3 y H4 del revisor. Cada liberación consume un intento, como en los jobs con clave. Un latido vigente reprograma sin consumirlo. Sin impacto contractual ni migración.»

Cierra `DEC-JOBS-001` y `DEC-JOBS-002` (APROBADO, sin `Blocks`). Alcance: latido de job (`JOBS_HEARTBEAT_INTERVAL_MS`, default 60000, ≤ `JOBS_STALE_LOCK_MS/3`), fencing por `lockedBy`, lista cerrada de tipos liberables (`access-reverify`, `access-reconciliation`, `PULL_REQUEST_METADATA_BACKFILL`, `experiment-run`), gancho `onExhausted` con `failureCode` `EXPERIMENT_WORKER_LOST`, H3 y H4. Fuera de alcance: `snapshot-analysis`, `functional-continuation`, `analysis-run-validation`, `test-publication` (`IDEA-011`).

No cubre push, PR, merge ni cambios en otros repositorios. No sustituye la revisión humana del corte antes de `W-DONE`.
