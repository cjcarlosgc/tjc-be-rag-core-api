# WI-CORE-026 — Revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Fecha: 2026-10-09. Revisión delegada explícitamente por el usuario (Human Reviewer) en chat. El reviewer no implementó, no corrigió ni commiteó nada.

- Rango de código: `git diff f92a746..HEAD -- app` (36 archivos). Commits de código: d91fdac (A), 16978ab (B), 5ff4f9d (C), 468870c (D), 8c8839c (E). HEAD: 457e034.
- HU: HU12, HU15.
- Veredicto: **CHANGES_REQUESTED** (0 blockers, 2 importantes, 3 menores).

## Verificaciones ejecutadas (evidencia)

| Verificación | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm test` x2 | 122 files passed / 3 skipped; 1683 passed / 77 skipped, ambas corridas, sin intermitencia |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` x2 | 7 files, 237 passed, ambas corridas, sin 'socket hang up' |
| `npx tsc --noEmit -p tsconfig.json` | 43 errores en specs/soporte; igual a la línea base de f92a746 (43) |
| `node harness/validate-harness.mjs` | `Harness V3 validation passed.` |
| `contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-026` | `relevantPendingSyncIds: []`, `acknowledgedSyncIds: []`; resueltos: CS-GH-20260925-001..005, CS-GH-20260926-001, CS-GH-20260927-001; no relevantes: CS-20260920-001, CS-20260921-003. No registró nada. |
| Compilación por commit (worktree desechable, `prisma generate` por commit) | `tsc -p tsconfig.build.json`: 0 errores en f92a746, d91fdac, 16978ab, 5ff4f9d, 468870c, 8c8839c. `tsc -p tsconfig.json` (con specs): 43 (base), 44 en d91fdac (un error de spec corregido en B), 43 en B, C, D, E |
| PostgreSQL 14.18 local desechable (127.0.0.1:55477, sin pgvector; `vector(1536)` -> `double precision[]` y sin HNSW solo en el historial previo) | Las 43 migraciones se aplican en orden, incluida 20261009130000 y las tres del WI. RLS activa (`relrowsecurity`) en analysis_retrievals, analysis_contexts y analysis_run_executions |
| Specs pg: analysis-trace, jobs, retrieval-comparisons | 3 files, 77 passed |
| `prisma migrate diff --from-config-datasource --to-schema` | Sin diferencias en analysis_retrievals, analysis_contexts, analysis_run_executions, generated_test_proposals ni analysis_runs.checkId. Solo `embedding` (efecto del shim) y renombres/tipos de context_traces, discovered_files y índices de experiment_repetitions, preexistentes y ajenos al WI |
| Rollback documentado de 140000, 150000 y 160000 | Ejecutado en `BEGIN ... ROLLBACK` sobre la BD con las migraciones aplicadas: válido |
| Higiene | `git status` limpio; sin worktrees ni ramas nuevas; el PostgreSQL y el worktree se bajaron y borraron |

## Conformidad (a)-(i)

- (a) DTO y endpoint: `AnalysisRunTraceResponse` coincide campo a campo con §6.16 (`analysis-run-trace.response.ts`); `@RequireProjectRole('READER', ProjectTargets.param('analysisRun','id'))` verificado con la prueba de metadato; 409 `EVIDENCE_NOT_FINISHED` solo en QUEUED/PROCESSING (ACTION_REQUIRED responde 200 con NOT_APPLICABLE); 404 por `getById`; targets DIRECTLY_CHANGED METHOD/FUNCTION ordenados por filePath, qualifiedName, id; executions por attempt ascendente; target sin ejecución con `NOT_APPLICABLE` e `items: []`; `outcome` en el vocabulario del Run; `attempt = attemptCount + 1`; `publication` y `freshness` según DEC-TRACE-002 (con la salvedad del hallazgo 1). El mapeo es explícito: no emite conteos, omitidas ni `knowledgeId` fuera de `functionalRuleIds`.
- (b) Persistencia: ids generados solo en `generateAndValidate`; `GenerationContext` no se muta (prueba que compara con `structuredClone`; mutación M12 la rompe); UNIQUE y upsert por (analysisRunId, analysisSymbolId) en retrievals, contexts y propuestas, UNIQUE (proposalId, attempt) en ejecuciones; idempotencia ante reintento verificada con SQL real (pg spec). El `executionId` solo se registra con `SandboxAcceptedExecutionError` (mutación M11 la rompe); no se inventa antes de la aceptación. La continuación desde ACTION_REQUIRED incrementa `attemptCount` solo en `requestContinuation`, de modo que los intentos suman filas sin duplicar propuestas ni contextos.
- (c) Migraciones aditivas (columnas nullable o tablas nuevas), con RLS y REVOKE, FK, UNIQUE, CHECK de no negatividad, sin backfill; coinciden con `schema.prisma`; guardia `rls-guard.spec.ts` pasa en `pnpm test`.
- (d) Obligación de 021 persistida en `analysis_contexts` (ids en orden, tres conteos, omitidas con motivo `TOKEN_BUDGET`, sin procedencia ni texto; probado con el `ContextBuilder` real y SQL real). Aserción de `experiment-job.handler.spec.ts` invertida (exige ids y conteos y prohíbe texto y procedencia). `ContextTracesService` no emite `functionalRules` (prueba nueva; mutación `...stored` la rompería).
- (e) Acceso: matriz e2e incluye `GET /analysis-runs/{}/trace` (404 `ANALYSIS_RUN_NOT_FOUND` para no miembros y colaborador externo, sin filtrar existencia; Reader/Writer/Admin no reciben 403 ni el 404 de visibilidad) y la matriz INTEROP §6.13 se actualizó.
- (f) Contract Sync: CS-CORE-20261009-012 (github-integration, `sourceRevision` 0a9d5ba existe y es el último commit que toca `github-integration-contract.md`) y CS-CORE-20261009-013 (console, `sourceRevision` 8c8839c existe; `interoperability-contract.md` no cambió después) son fieles al texto; `breaking: false`. GH-INTEROP-1.3 consistente entre `spec/README.md`, `system-contract.md`, `interoperability-contract.md` (líneas 9, 14, 609, 979, 1139, 1379) y `github-integration-contract.md` (líneas 3, 53, 124); las menciones a 1.2 que quedan son historia.
- (h) Seguridad y limpieza: `retrieval.config` y `candidates` sin contenido de código (mutación M15 rompe la prueba); el warn del registro de ejecución solo loguea `executionId`, run y `error.name` (la prueba usa una cadena con credenciales y verifica que no aparezca); el warn del cliente de GitHub Integration solo lleva status y ruta; sin secretos, `console.log` ni TODO en el diff.
- (i) Los cinco commits de código y los de spec/harness del WI llevan `Refs: HU12, HU15` y `Co-Authored-By: Claude Haiku 5.5` (código) / el modelo real (docs). Cada commit de código compila (build tsconfig, 0 errores).

## Calidad de pruebas: mutaciones (en worktree desechable, ya eliminado)

| # | Mutación | Resultado |
|---|---|---|
| M1 | Quitar el 409 de QUEUED/PROCESSING | Detectada |
| M2 | Invertir orden de targets por filePath | Detectada |
| M2b | Invertir desempate por qualifiedName | **No detectada** |
| M3, M3b | Freshness STALE->CURRENT, o cualquier otro estado->STALE | Detectadas |
| M7 | Quitar el orden por attempt | Detectada |
| M10 | Elegir la publicación más antigua | Detectada |
| M4 | Registro de ejecución sin best-effort en camino VALID | Detectada |
| M5 | Un 204 (undefined) lanza | Detectada (3 pruebas) |
| M9 | Quitar `tolerateUnreadableSuccessBody` | Detectada |
| M11 | Registrar ejecución ante cualquier SandboxUnavailableError | Detectada |
| M12 | Mutar `GenerationContext` tras persistir | Detectada |
| M13 | `attempt` sin +1 | Detectada |
| M14 | `outcome` sin traducir AVAILABLE a SUCCESS | Detectada |
| M15 | Contenido de código en `candidates` | Detectada |
| M6 | Exponer conteo recuperado en el trace (servicio) | **No detectada** |
| M6b | Exponer conteo y `omittedFunctionalRules` (servicio + `select` del repositorio), con spec pg real | **No detectada** |

Las pruebas nuevas no dependen de tiempos reales relevantes (los sondeos del Sandbox usan `pollAfterMs: 1` con tope de intentos).

## Hallazgos

### 1. importante — `publication.status` es NOT_APPLICABLE para un Check ya publicado mientras GitHub Integration responda 204
- `app/src/analysis-runs/analysis-run-trace.service.ts:147`: `status: checkId !== null || latest !== null ? 'PRESENT' : 'NOT_APPLICABLE'`.
- DEC-TRACE-002 y §6.16 dicen `PRESENT` si existe un Check. Core no persiste que publicó un Check cuando recibe `204` o un cuerpo sin id (`analysis-run-checks.service.ts`: `setCheckId` solo si `checkId !== null`), así que en la transición (hoy, hasta que GitHub Integration implemente CS-012) todo Run con Check publicado y sin companion PR reporta `publication.status = NOT_APPLICABLE`, justo el caso que §6.16 reserva para flujos que terminan antes. La prueba "Check alone" solo cubre `checkId` no nulo.
- Escenario: Run `SUCCESS` con Check publicado vía 204; la Console recibe `publication.status = NOT_APPLICABLE` y muestra el enlace 9 como no aplicable.
- Corrección posible: persistir un indicador independiente del id (p. ej. `checkPublishedAt`) cuando `createCheckRun` resuelve, y derivar `PRESENT` de él; o que el usuario acepte y se documente en §6.16/DEC-TRACE-002 que durante la transición un Check sin id consta NOT_APPLICABLE.

### 2. importante — La decisión "no exponer conteos, omitidas ni knowledgeId" no tiene una prueba que falle ante su regresión
- `analysis-run-trace.service.spec.ts:66` (`not.toContain('omitted'|'knowledgeId'...)`) es vacía: las filas simuladas de `findContextsByRun` no contienen esos campos, así que cualquier mapeo que los copie produce `undefined` y se omite al serializar (mutación M6). `analysis-trace.repository.pg.spec.ts:352` usa `toMatchObject` sobre `context`, por lo que campos extra pasan (M6b: con SQL real, exponer `functionalRulesRetrieved` y `omittedFunctionalRules` no rompe ninguna prueba).
- Escenario: un cambio futuro (p. ej. en WI-CORE-027, que ya advierte no exponer conteos) agrega los conteos al `select` y al mapeo sin que falle ninguna prueba.
- Corrección posible: en la prueba pg (o en la unitaria con filas completas de `analysis_contexts`) afirmar `expect(trace.targets[0].context).toEqual({ status, contextId, functionalRuleIds })` y que el JSON serializado no contenga `omittedFunctionalRules` ni `functionalRulesRetrieved`.

### 3. menor — Desempate por `qualifiedName` del orden de targets sin prueba (M2b)
- `analysis-run-trace.service.ts:34`; la prueba ordena solo por `filePath`. Añadir dos símbolos en el mismo archivo.

### 4. menor — Camino HELD: registrar la ejecución no es best-effort y degrada el resultado
- `analysis-run-validation-job.handler.ts` (rama `kind !== VALID`, `await this.recordExecution(...)`) y el `catch` (`recordExecution` para `SandboxAcceptedExecutionError`). Si el upsert de la ejecución falla tras un BEHAVIORAL_MISMATCH, el `catch` reescribe la propuesta con contenido `''`, `failureSummary` = mensaje del error de base de datos y clasifica el símbolo como TECHNICAL_GENERATION_FAILURE; si falla dentro del `catch`, la excepción sale del handler y el Run termina INFRASTRUCTURE_FAILURE. La decisión 7 solo cubre el camino VALID, por lo que no incumple la decisión aprobada; es una asimetría no documentada. Sin prueba.

### 5. menor — Título de prueba que no coincide con su cuerpo
- `analysis-run-validation-job.handler.spec.ts` ("records no retrieval or context for a symbol that already has a test, and a null context_id when retrieval fails"): el cuerpo solo cubre el fallo de retrieval; no afirma que un símbolo con test existente no genere retrieval ni contexto.

## Limitaciones conocidas (no son hallazgo)
Migraciones 130000, 140000, 150000 y 160000 sin aplicar a Supabase y verificación con pgvector real pendiente (aquí se verificó con PostgreSQL 14 sin pgvector y shim del historial previo); propuesta HELD con contenido `''` cuando una ejecución aceptada falla (IDEA-013); Runs y propuestas previos sin enlazar; corte E sin mutation test formal (aquí M4, M5 y M9 lo cubren y fueron detectadas); `checkId` no nulo solo tras CS-012; WI-CORE-027 no debe exponer conteos ni omitidas sin enmendar el contrato.

## Veredicto
CHANGES_REQUESTED por los hallazgos 1 y 2 (importantes). No hay blockers ni incumplimiento de las decisiones aprobadas por el usuario salvo la lectura literal de DEC-TRACE-002 en el hallazgo 1, que el usuario puede aceptar explícitamente. Este veredicto no sustituye la aprobación humana de alcance y arquitectura ya dada en DEC-TRACE-001, DEC-TRACE-002 y `smart-v3-scope-approval.md`.
