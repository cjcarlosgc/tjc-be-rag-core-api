# experimental-metrics — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Guardar métricas por repetición, configuración del modelo y estrategia. No calcular conclusiones académicas dentro del backend; exponer datos/agregados reproducibles.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.

## Corte SMART V3

`WI-CORE-027` depende de `WI-CORE-007`, `WI-CORE-025` y `WI-CORE-026`.

## Diseño técnico SMART V3 (WI-CORE-027)

El bundle de evidencia se compone por `kind`: `ANALYSIS_RUN` puebla `analysisRun`, `retrieval`, `context`, `generation`, `sandbox` y `publication`; `EXPERIMENT` puebla `experimental`, `generation`, `agentExploration`, `sandbox` y `retrieval`/`context` del brazo RAG, con `analysisRun` nulo; `RETRIEVAL_COMPARISON` puebla `retrieval`, con `analysisRun` nulo. `sandbox.facts` se limita a la lista cerrada `executionProfile`, `runner`, `compiled`, `executed`, `passed`, `totalTests`, `passedTests`, `failedTests`, `skippedTests`, `testCasesTruncated`, `failureStage`, `failureCategory`, `failureCode` y `failureMessage` (saneado), derivada de `RunnerFacts` y `SandboxFailureFact`; nunca logs, evidencias ni URLs. Estados: la evidencia de un `AnalysisRun` está disponible en cualquier estado salvo `QUEUED` y `PROCESSING`; experimento y comparación, en `COMPLETED` y `FAILED`; en otro caso `409 EVIDENCE_NOT_FINISHED`. `snapshotRef` es una referencia interna opaca y `artifactHash` el SHA-256 del artefacto. Se añade una prueba de esquema estable (snapshot) del bundle. La jerarquía CF/CO/VT se documenta en `spec.md` de esta transversal.
