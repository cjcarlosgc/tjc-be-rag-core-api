# WI-CORE-051 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 (según el coordinador) · **Autoriza:** Jean (Human Reviewer), directamente en el chat de Core: «WI de código y UPDATE puntual» ante el defecto de `snapshotKey`. El UPDATE puntual sobre la base real (`project_versions` 7c419f87, `snapshotKey = analysis-runs/e70d663a-7cd5-4d91-83a1-47657d2c444f/snapshot.zip`, 1 fila, con respaldo previo) lo hizo el coordinador; este WI no toca la base real.

## Defecto
`experiment-job.handler.ts` (:418-421) falla con «ProjectVersion … no tiene snapshot disponible» si `version.snapshotKey` es null y lo lee de Storage (:435-436); `context-traces.service.ts` (`throwSnapshotUnavailable`) también usa `snapshotKey`. En la base real era NULL en 15/15 versiones: ningún código de producto lo escribe desde `18b6152` (retire-legacy); el job de validación escribe `analysis-runs/${run.id}/snapshot.zip` sin enlazarlo a la versión.

## Alcance
En el análisis de PR (`snapshot-analysis-job.handler.ts`), con el workspace ya materializado: `zipDirectory` + `objectStorageService.put('project-versions/${version.id}/snapshot.zip', buffer, 'application/zip')` y guardar `snapshotKey` en la `ProjectVersion` mediante un método nuevo del repositorio (columna existente; sin migración), tras `completeAndPromote`. Un fallo del put o del update NO bloquea el análisis de PR: se registra la causa (log con el nombre del error y la versión) y `snapshotKey` queda null para que el experimento falle con su mensaje claro. Idempotente: misma clave por versión. Sin tocar experimentos, OE2/OE5, evidencia, métricas, `sandbox/map-sandbox-result.ts` ni lo que el experimento hace con el ZIP. Backfill de las otras versiones: NO se hace; opción para el usuario (UPDATE sobre la base real con autorización explícita).
