# WI-CORE-046 — preparación (OC11, sin implementar)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Estado: `W-PLANNED`. No se toca `app/`. Preparado a pedido del coordinador mientras `DEC-VAL-002` está en espera.

## Alcance propuesto
Cuando el compare del PR no se puede verificar (`UNVERIFIABLE`), el job de snapshot (`snapshot-intelligence/snapshot-analysis-job.handler.ts:386-401`) completa el Run `INFRASTRUCTURE_FAILURE` con Check `neutral` y un `resultSummary` explícito, y deja de relanzar el error (el reintento entra en `:168-172` y termina sin trabajo). Prueba roja-verde.

## Condición del usuario (ambos canales)
Confinado al análisis de PR (`snapshot-analysis-job.handler.ts` y clasificación del AnalysisRun). No altera experimentos (008), OE2/OE5 ni evidencia o métricas existentes. Si hubiera que tocar `sandbox/map-sandbox-result.ts` (compartido por 005 y 008): prueba de no regresión sobre experimentos o no se toca; si afecta métricas, `DECISION_REQUIRED`. Este corte no necesita tocar `map-sandbox-result.ts`.

## Hallazgo que requiere decisión antes de W-READY
`GithubLookup.UNVERIFIABLE` no distingue el límite de 300 archivos de otras causas (permiso insuficiente, 403 no clasificable, 429, 5xx, red; `github-integration-contract.md` línea 160). `unwrapLookup` (`github-app/github-repository-content.service.ts:157-171`) lo convierte en `GithubAppUnavailableError(503)` sin motivo. Escribir «PR excede 300 archivos» ante cualquier `UNVERIFIABLE` sería falso para un 5xx. Alternativas:
1. Mensaje genérico veraz: «No se pudo verificar el compare de GitHub (por ejemplo, un PR con 300 o más archivos); análisis no realizado» (sin cambio en Integration).
2. Integration agrega un motivo (`reason: 'COMPARE_LIMIT'`) a `UNVERIFIABLE` (contrato GH y repositorio ajenos; Contract Sync).
3. Core compara contra `changed_files` del PR si Integration ya lo expone (verificar).
Recomendación: 1 ahora y 2 como deuda «umbral de repo grande + progreso». Requiere la aprobación del usuario porque cambia el texto aprobado en PQ-OC11.
