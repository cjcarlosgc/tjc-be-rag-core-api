# WI-CORE-053 a 056 — plan y decisiones (solicitud de Jean, 2026-10-13)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Autoriza:** Jean, en el chat de Core vía el coordinador (AskUserQuestion «Confirmo los 3 puntos + análisis B»). Secuencia: un solo `activeWorkItem`; cada WI cierra por revisión independiente delegada (Modo fuera de casa) antes del siguiente. Ningún WI se marca `W-DONE` sin revisión independiente. Sin push; migraciones solo creadas y probadas en pruebas, no aplicadas a la base real ni a Render.

| WI | Alcance | Tipo | Estimación | Contrato |
|---|---|---|---|---|
| WI-CORE-053 | Evidencia privada por repetición: código exacto del test enviado al Sandbox y reporte del runner (casos con mensaje saneado, hecho de fallo, duraciones) con sha256, truncamiento explícito y migración nueva | PRODUCT | 2 cortes (migración+repositorio; cableado en `experiment-job.handler` + pruebas), ~1 jornada | No toca DTO público; evidencia privada |
| WI-CORE-054 | `technicallyValidRate` (+ `assertionFailureCount`) en `StrategyMetricsResponse`, aditivo | PRODUCT | 1 corte pequeño + revisión contractual, ~medio día | Sí: INTEROP (§6.5.1/§6.16 y semántica de métricas) y posible SYSTEM; contract-reviewer y Contract Sync a Console |
| WI-CORE-055 | `inspect_symbol` del GENERALIST_AGENT con nombres PHP calificados con `\` | PRODUCT | 1 corte, ~medio día | No |
| WI-CORE-056 | Análisis B: reducir el ruido del contexto RAG (70% tests ajenos en exp.1; 9/10 vecinos en exp.2), con simulación offline sobre los experimentos `89a16229…` y `800689b9…` (solo `SELECT`, sin LLM) | HARNESS (solo reportes) | ~1 jornada | No aplica |

## Hallazgo que condiciona WI-CORE-053
El contrato Core↔Sandbox (`SandboxExecutionResult`, `sandbox.types.ts`) **no devuelve stdout/stderr ni un runner report en bruto**: solo hechos normalizados (`RunnerFacts` con `testCases[].errorMessage`, `SandboxFailureFact.message`, `stageDurations`). Core puede persistir como «reporte del runner» esos hechos completos, pero la salida en bruto exigiría extender el contrato del Sandbox (repositorio ajeno; Contract Sync y handoff con confirmación del usuario). Propuesta: WI-CORE-053 persiste código + hechos completos del runner; la salida en bruto queda como pedido separado a Sandbox.

## Diseño propuesto de WI-CORE-053
Tabla nueva `experiment_repetition_artifacts` (1:1 con `experiment_repetitions`, `onDelete` en cascada con el experimento): `testContent` (texto), `testContentSha256` (hash del contenido completo), `testContentTruncated`, `runnerReport` (JSONB: `testCases` con `errorMessage` ya saneado y recortado, `failure`, `stageDurations`, `testCasesTruncated`), `runnerReportSha256`. Límites explícitos: contenido del test 256 KiB; mensajes por caso 2 KiB; casos 200; recorte con marca. Saneado con `sanitizeFailureMessage`; sin secretos ni URLs firmadas. No se expone en `ExperimentRepetitionResponse` ni en §6.16 salvo el hash que el contrato ya define (`artifactHash`). Idempotente por repetición+intento (unique).

## Decisiones que necesitan al usuario
1. **Almacenamiento y gobierno de datos** (WI-053): código de terceros y mensajes de pruebas en Postgres; `DEC-VAL-001` (validación empresarial) sigue `PENDING`, así que solo código de repositorios de piloto. ¿Aprobar la tabla en la base (recomendado) frente a Storage con clave y hash en la base? ¿Retención/purga?
2. **Salida en bruto stdout/stderr**: ¿se pide la extensión al Sandbox (handoff tras confirmación) o se acepta el reporte de hechos normalizados?
3. **Límites de truncamiento** propuestos (256 KiB / 2 KiB / 200 casos): ¿aprobar?
4. **Versionado de contrato** (WI-054): `technicallyValidRate` es aditivo; propuesta INTEROP-2.13 con evento a Console. Definición: `compiled ∧ executed ∧ failureType ∈ {NONE, TEST_ASSERTION}` sobre repeticiones evaluables; `null` si no hay evaluables (DEC-EVID-001); `assertionFailureCount` = repeticiones evaluables con `TEST_ASSERTION`. Confirmar que `valid`/`passed` no cambian.
5. **WI-056**: autorización de lectura `SELECT` sobre la base real para `code_chunks`/`context_traces`/`experiment_repetitions` de los dos experimentos (sin escritura, sin LLM) y qué credencial usar (no se versiona).
6. Fuera de alcance confirmado: ranking/contexto RAG, clasificación «violación de regla» vs «error del modelo», borrado de datos, env/infra/producción.
