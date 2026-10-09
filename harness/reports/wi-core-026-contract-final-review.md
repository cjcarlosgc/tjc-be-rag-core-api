# WI-CORE-026 — Revisión contractual final (ratificación del texto de §6.16)
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Fuentes: `git show HEAD` (018c35c), `interoperability-contract.md` §6.13/§6.16/§8/línea 14, `github-integration-contract.md` (GH-INTEROP-1.3), DEC-TRACE-001/002, mis informes `wi-core-026-contract-review.md` y `wi-core-026-gh-interop-review.md`, y el código de d91fdac, 16978ab, 5ff4f9d y 468870c.

## Veredicto: APPROVED (con una corrección de texto menor aplicada, sin commitear)

Corrección aplicada en `spec/contracts/interoperability-contract.md` (aclaraciones del trace): la frase "`outcome` usa la clasificación técnica que el Run ya expone por símbolo" era imprecisa (el Run no expone outcome por símbolo; expone estados `SUCCESS`/`BEHAVIORAL_MISMATCH`/`TECHNICAL_GENERATION_FAILURE`). Ahora dice que usa ese vocabulario, asignado a cada ejecución, y que `attempt` es el intento del Run. Es la única edición; no hay problema de fondo.

## Verificaciones explícitas

1. Forma del DTO: `analysis-run-trace.response.ts` es idéntica a §6.16 (`TraceExecutionResponse`, `TraceTargetResponse`, `TracePublicationResponse`, `AnalysisRunTraceResponse`; mismos campos, nulabilidad y `TraceLinkStatus`). El servicio rellena todos los campos; `context` NOT_APPLICABLE da `contextId: null`, `functionalRuleIds: []`.
2. No exposición: el trace no emite conteos, omitidas ni `knowledgeId` salvo `context.functionalRuleIds`. El detail experimental §6.7 no cambia: aunque `experiment-job.handler.ts` persiste `functionalRules` en el JSON interno del trace, `ContextTracesService` mapea explícitamente y una prueba nueva (`context-traces.service.spec.ts`) afirma que `functionalRules`, `rule-1` y `rule-2` no aparecen en el detail. Texto de la spec correcto.
3. Errores: `ErrorCode.EVIDENCE_NOT_FINISHED` (409) se lanza solo en `QUEUED` y `PROCESSING`; `ACTION_REQUIRED` y demás estados terminales responden 200 con enlaces `NOT_APPLICABLE`. El 404 viene de `analysisRunsService.getById` (`ANALYSIS_RUN_NOT_FOUND`) y el guard `@RequireProjectRole('READER')`; con Reader como mínimo no hay 403 alcanzable, como dice el texto. Coincide con §6.16 y con la rutas hermanas de `/evidence` (siguen pendientes, WI-CORE-027).
4. Orden: targets = `DIRECTLY_CHANGED` de kind `METHOD`/`FUNCTION`, por `filePath`, `qualifiedName`, `id`; executions por `attempt` ascendente. Coincide con el texto.
5. publication/freshness (DEC-TRACE-002): `PRESENT` si hay `checkId` o TestPublication; la más reciente por `createdAt` (empate id desc); `CURRENT` solo con PUBLISHED, `STALE` con STALE, `null` en el resto; branch/PR url/sourceHeadSha de la publicación y `null` si solo hay Check. Coincide.
6. checkId (DEC-TRACE-001, GH-INTEROP-1.3): columna nullable en `analysis_runs`; `createCheckRun` tolera 200 `{checkId}`, 204 y cualquier otra forma (null, sin lanzar). Texto y `github-integration-contract.md` (líneas 53, 124, 254) consistentes; Core puede desplegarse en cualquier orden.
7. No-backfill: correcto. Las propuestas antiguas tienen `analysisSymbolId` null (se excluyen por `groupBy`), no hay filas de retrieval/context/execution y `checkId` es null: los enlaces constan `NOT_APPLICABLE`. Migraciones aditivas.
8. Estado: línea 14, §6.13, §6.16 y §8 consistentes (`/trace` implementado, `/evidence` pendiente de WI-CORE-027).

Observaciones no bloqueantes: (a) `executions.status` sale `PRESENT` solo si hay filas; un fallo previo a la aceptación del Sandbox no crea ejecución, coherente con "no inventar id". (b) El 403 para `/trace` queda cubierto por metadato de guard, no por caso HTTP.

## Checkpoints de contenido del Contract Sync a Console (WI-CONSOLE-020)

1. Ruta y rol: `GET /analysis-runs/{analysisRunId}/trace`, Reader o superior; `/evidence` (las tres rutas) sigue pendiente de WI-CORE-027 y no debe consumirse en vivo.
2. DTOs/enums: `AnalysisRunTraceResponse`, `TraceTargetResponse`, `TraceExecutionResponse`, `TracePublicationResponse`, `TraceLinkStatus = PRESENT | NOT_APPLICABLE`; `freshness: CURRENT | STALE | null`; `changeset.targetCount`. `NOT_APPLICABLE` es legítimo (Run sin targets, `ACTION_REQUIRED`, Runs previos) y no es error; `executions.items` vacío con `NOT_APPLICABLE`.
3. Errores: `409 EVIDENCE_NOT_FINISHED` en `QUEUED`/`PROCESSING` (reintentar al terminar); `404 ANALYSIS_RUN_NOT_FOUND` para Run inexistente o no visible; sin 403 alcanzable.
4. publication: reglas de `PRESENT`, `freshness` (solo PUBLISHED/STALE) y `checkId` nullable (null mientras GitHub Integration responda 204 o no lo informe).
5. No exposición: la UI no debe esperar conteos, reglas omitidas ni `knowledgeId` fuera de `functionalRuleIds`; el detail §6.7 no cambia.
6. Sin backfill: Runs y propuestas anteriores a la implementación muestran enlaces `NOT_APPLICABLE`; la UI debe tolerarlo.
7. Espejo byte por byte del `interoperability-contract.md` (INTEROP-2.7, sin bump) y mapeo de `outcome`: `SUCCESS`, `BEHAVIORAL_MISMATCH`, `TECHNICAL_GENERATION_FAILURE` (tipo `string` en el contrato).

## Texto propuesto para el evento Contract Sync (NO publicado)

- sourceWorkItem: WI-CORE-026 · destino: `tjc-fe-developer-console` (WI-CONSOLE-020) · breaking=false.
- changed: INTEROP-2.7 §6.16 pasa a Implementado en Core para `GET /analysis-runs/{id}/trace` (Reader): cadena de nueve enlaces con `retrieval_id`, `context_id` y `executionId` del Sandbox; `409 EVIDENCE_NOT_FINISHED` en `QUEUED`/`PROCESSING`; `404 ANALYSIS_RUN_NOT_FOUND`; `publication` (`PRESENT` con Check o TestPublication; `freshness` CURRENT/STALE/null) y `checkId` según GH-INTEROP-1.3 (null durante `204`); orden determinista de targets y executions; sin conteos, omitidas ni `knowledgeId` fuera de `functionalRuleIds`; sin backfill. `/evidence` sigue pendiente (WI-CORE-027). Sin cambio de versión ni de DTOs ya publicados; §6.13, línea 14 y §8 actualizadas.
- requiredAction: importar y acusar el evento; actualizar el espejo byte por byte de `interoperability-contract.md`; validar contra los DTOs reales (mapeo de `NOT_APPLICABLE`, `freshness` y `checkId` nullable, y el 409 antes de estado terminal); mantener `/evidence` en mock hasta WI-CORE-027; avisar con `CS-CONSOLE-...` al completar WI-CONSOLE-020. Nada más debe cambiar.
