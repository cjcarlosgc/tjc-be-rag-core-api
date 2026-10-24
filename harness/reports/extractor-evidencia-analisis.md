# Extractor de evidencia de solo lectura — análisis de viabilidad (WI-CORE-093)
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

Leyenda: PERSISTIDO · CALCULABLE · TRUNCADO · NO EXISTE. ⚠ = depende de datos reales (verificable con un SELECT). Rutas relativas a `app/` salvo indicación. No se leyó ningún `.env` ni se consultó la base real.

## 1. Inventario «qué existe hoy»

### 1.a Test generado
| Contexto | Estado | Dónde |
|---|---|---|
| ExperimentRun, por repetición **y por intento** (la fila de `experiment_repetitions` es por intento: `@@unique([experimentId, strategy, repetition, attempt])`, schema.prisma:900) | PERSISTIDO, **TRUNCADO a 256 KiB UTF-8** (marca `testContentTruncated`) | `experiment_repetition_artifacts.testContent` (1:1 por `repetitionId`, schema.prisma:919-947; `REPETITION_TEST_CONTENT_MAX_BYTES=262144`, `src/experiments/repetition-artifact.ts:16,274`) |
| Hash | PERSISTIDO sobre el contenido **completo** (antes de truncar, tras quitar NUL): `testContentSha256` (repetition-artifact.ts:277); además `experiment_repetitions.artifactHash` = SHA-256 del contenido enviado al Sandbox (`experiment-job.handler.ts:801-804`) | CALCULABLE: re-hash de `testContent` coincide con `testContentSha256` si `testContentTruncated=false` (salvo NUL: ese hash se calcula tras quitarlos); `artifactHash` es `null` si no hubo contenido y coincide con el contenido enviado al Sandbox solo si no había NUL |
| Qué contenido es | El contenido **final fusionado** que se envía al Sandbox (`MergedGeneratedTest.content`, `generation/test-generation-pipeline.ts:110-113`), no la respuesta cruda del LLM | |
| Redacción | **No se redacta** (solo se quitan NUL, repetition-artifact.ts:69-71,273). Puede contener código de terceros | |
| Versión por repetición | Sí: una fila por intento (1 o 2), cada una con su artefacto | |
| AnalysisRun | PERSISTIDO en Storage (no en BD): `generated_test_proposals.storageKey` = `analysis-runs/{runId}/proposals/{uuid}` (`src/validation/analysis-run-validation-job.handler.ts:758-760`), `text/plain`, sin truncar; hash `generated_test_proposals.contentSha256` (:771) | **Una sola propuesta por (run, símbolo)**: `upsertForSymbol` sobrescribe (`generated-test-proposals.repository.ts:46-55`); el contenido de un reintento reemplaza al anterior (el objeto viejo queda huérfano sin referencia) |
| Bucket | Único, de `SUPABASE_STORAGE_BUCKET` (privado; `object-storage/supabase-object-storage.adapter.ts:15,85`) | |

### 1.b Salida de Composer/PHPUnit y logs
| Dato | Estado | Dónde |
|---|---|---|
| Hechos normalizados del runner (status, runner, compiled/executed/passed, conteos, ≤200 casos con `errorMessage` ≤500 car. saneado, `failure`, `stageDurations` con start/end) | PERSISTIDO, TRUNCADO (200 casos; `testCasesOmitted`) | `experiment_repetition_artifacts.runnerReport` + `runnerReportSha256` (repetition-artifact.ts:208-250, 286-291) |
| stdout/stderr del compilador y de pruebas, `RUNNER_REPORT` | PERSISTIDO **solo en experimentos**, TRUNCADO: ≤8 KiB por entrada, 40 KiB totales, secretos redactados (`redactSecretsInText`), `contentTruncated`, `truncated`+`originalBytes` del Sandbox, `omitted` | `experiment_repetition_artifacts.sandboxEvidence` (JSON `{entries[],omitted}`), `sandboxEvidenceSha256`, `sandboxEvidenceTruncated`, `sandboxStartedAt/CompletedAt` (repetition-artifact.ts:74-77,120-176; schema.prisma:933-943) |
| Límite del Sandbox (64 KiB por captura, dato del pedido) | El Sandbox ya recorta; Core guarda `truncated`+`originalBytes` por entrada, de modo que el recorte es observable. El valor 64 KiB no está en el código de Core ⚠ | |
| Salida completa de `composer install` | **NO EXISTE** como tal: depende de que el Sandbox devuelva `COMPILER_*`/`TEST_*` con `stage`; kinds permitidos (sandbox.types.ts:21-26): `COMPILER_STDOUT/STDERR`, `TEST_STDOUT/STDERR`, `RUNNER_REPORT`. No hay kind de instalación de dependencias ⚠ (¿qué `stage` etiqueta el Sandbox para composer?: solo un SELECT sobre `sandboxEvidence->'entries'` lo dice) | |
| Filas anteriores a la migración `20261013110000_experiment_trial_reconstruction` | `sandboxEvidence` null (sin backfill; spec 008 línea 85). La migración `20261013110000` figura «no aplicada a ninguna base real» (`harness/reports/wi-core-060-independent-review.md:6`, `wi-core-060-closure.md:10`) ⚠; la tabla `experiment_repetition_artifacts` (testContent, runnerReport) la crea la anterior `20261013100000_experiment_repetition_artifacts`, y el cierre pide aplicar ambas en orden. Sin ellas el extractor de experimentos no tiene fuente y sus consultas fallan por tabla/columna inexistente | |
| Duración por etapa, exit codes | Duración: PERSISTIDO en `runnerReport.stageDurations`. Exit codes: **NO EXISTE** como campo (solo `failure.code/category/stage`) | |
| Hecho de fallo | PERSISTIDO: `experiment_repetitions.failure` `{stage,category,code,message saneado}`, `errorSummary`, `failureType`, `sandboxTimedOut` | |
| 14 hechos §6.16 | PERSISTIDO: `experiment_repetitions.sandboxFacts`; ids `sandboxExecutionId/RequestId/CorrelationId` | |
| **AnalysisRun** | Solo `analysis_run_executions.facts` (14 claves, sin testCases, `sandbox-evidence-facts.ts:16-36`), `failure`, `durationMs`, `requestId`, `correlationId`, `outcome`, `executionId`, `attempt`, `executionProfile`. **stdout/stderr y `runnerReport` NO EXISTEN para AnalysisRun** (`sandboxEvidence` solo se escribe en `src/experiments/**`; verificado por grep) | |

### 1.c `modelConfig`
`experiment_runs.modelConfig` JSON PERSISTIDO: `{provider, model, modelVersion, reasoningEffort, temperature, maxOutputTokens, endpoint?}` (`experiments/persistence/experiment-runs.repository.ts:153-160`). Una vez por experimento, `null` en corridas previas a WI-CORE-023. `endpoint` es interno: el extractor debe omitirlo o enmascararlo. Valores reales ⚠ (`SELECT "modelConfig" FROM experiment_runs WHERE id=$1`). Para AnalysisRun: `generated_test_proposals.generation` `{provider, model, modelVersion, reasoningEffort, inputTokens, outputTokens, durationMs}` (null en runs previos o si no hubo resultado). Además `experiment_runs.budget`, `randomizationSeed`, `executionProfile`, `runnerHint`.

### 1.d Trace de 9 enlaces (AnalysisRun)
Enlaces (tesis línea 1076): repo/PR/HEAD; AnalysisRun; changeset/targets; retrieval; context; generation; Sandbox; results; publication/check. Directo, con tablas reales:

| # | Enlace | Persistido (tabla.columna) |
|---|---|---|
| 1 | repo/PR/HEAD | `analysis_runs.repositoryId, repositoryName, prNumber, baseRef, headRef, baseSha, headSha, changesetBaseSha, changesetHeadSha`; GitHub (no se consulta) |
| 2 | AnalysisRun | `analysis_runs.id, status, attemptCount, projectVersionId, createdAt, completedAt` |
| 3 | changeset/targets | `analysis_symbols` (`analysisRunId`, `changeKind='DIRECTLY_CHANGED'`, `kind IN (METHOD,FUNCTION)`; regla de `isTraceTarget`, `analysis-run-trace.service.ts:43-45`) |
| 4 | retrieval | `analysis_retrievals` (`analysisRunId`, `analysisSymbolId`, `mode`, `config`, `candidates`; único por run+símbolo) |
| 5 | context | `analysis_contexts` (`analysisRunId`, `analysisSymbolId`, `retrievalId`, `selectedChunkIds`, `discardedChunkIds`, `functionalRuleIds`, tokens) |
| 6 | generation | `generated_test_proposals` (`analysisRunId`, `analysisSymbolId`, `contextId`, `status`, `storageKey`, `contentSha256`, `generation`) |
| 7 | Sandbox | `analysis_run_executions` (`proposalId`, `executionId`, `attempt`, `requestId`, `correlationId`, `facts`, `failure`) |
| 8 | results | `analysis_run_executions.outcome` + `generated_test_proposals.status/failureSummary` + `analysis_runs.resultSummary, generatedTestsCount, functionalBehaviorValidated` |
| 9 | publication/check | `analysis_runs.checkId, checkPublishedAt`; `test_publications` (`analysisRunId`, `proposalIds[]`, `sourceHeadSha`, `status`, `branchName`, `companionPullRequestUrl`) |

Chequeo inverso: CALCULABLE solo con joins de lectura (todas las FK existen salvo `test_publications.proposalIds`, array sin FK, y `experiment_runs.analysisRunId`, referencia lógica). Consultas en pseudocódigo:
```
-- Nota: en PostgreSQL los identificadores camelCase van entre comillas dobles ("analysisRunId", "proposalId"...); abajo se omiten por brevedad
-- generación/Sandbox/contexto/retrieval → Run (inverso)
SELECT p.id, p.analysisRunId FROM generated_test_proposals p WHERE p.id = :proposalId;
SELECT e.id, p.analysisRunId FROM analysis_run_executions e JOIN generated_test_proposals p ON p.id = e.proposalId
  WHERE e."analysisRunId" <> p."analysisRunId";   -- debe dar 0 filas; cualquier fila es una discrepancia (ruptura del enlace)
SELECT c.id, c.analysisRunId, c.retrievalId FROM analysis_contexts c;               -- context → retrieval → run
SELECT r.id FROM analysis_retrievals r JOIN analysis_contexts c ON c.retrievalId = r.id;
-- consistencia símbolo: proposal.analysisSymbolId = context.analysisSymbolId = retrieval.analysisSymbolId
SELECT 1 FROM generated_test_proposals p JOIN analysis_contexts c ON c.id = p.contextId
  WHERE p.analysisSymbolId <> c.analysisSymbolId;                                    -- debe dar 0 filas
-- run → PR/HEAD
SELECT repositoryName, prNumber, headSha, baseSha FROM analysis_runs WHERE id = :runId;
-- publicación → proposals → run (array sin FK)
SELECT t.id FROM test_publications t WHERE t.analysisRunId = :runId
  AND NOT (t.proposalIds <@ ARRAY(SELECT id FROM generated_test_proposals WHERE analysisRunId = :runId));  -- 0 filas
-- sourceHeadSha vs headSha: SELECT t.sourceHeadSha = r.headSha FROM test_publications t JOIN analysis_runs r ON r.id = t.analysisRunId;
-- objeto de Storage → run: prefijo analysis-runs/{runId}/proposals/ de storageKey (parseable, sin leer Storage)
```
N/A: un enlace sin filas en run terminal es `NOT_APPLICABLE` (`analysis-run-trace.service.ts:94-115`). Limitaciones: (i) solo `generated_test_proposals`, `analysis_retrievals` y `analysis_contexts` son únicos por (run, símbolo) y reflejan el último intento; `analysis_run_executions` es único por `(proposalId, attempt)` y conserva una fila por intento: los intentos de Sandbox sí son reconstruibles, el contenido del test por intento no; (ii) la verificación contra GitHub (PR/HEAD real) NO es posible con SELECT. ExperimentRun: `experiment_runs.analysisRunId` (lógico, null en corridas previas ⚠) y `commitSha`; `projectVersionId → project_versions.commitSha/snapshotKey/status`; repetición → `context_traces` (FK compuesta, `experimentRepetitionId`).

### 1.e Hashes SHA-256
| Hash | Estado |
|---|---|
| `experiment_repetition_artifacts.testContentSha256`, `runnerReportSha256` (JSON canónico con claves ordenadas, `canonicalJson` repetition-artifact.ts:196-206), `sandboxEvidenceSha256` | PERSISTIDO; verificable recomputando sobre el contenido persistido (CALCULABLE; hay que reimplementar `canonicalJson` y, para el reporte, el contenido guardado ya saneado) |
| `experiment_repetitions.artifactHash`, `promptSha256` (solo hash; el texto no se guarda) | PERSISTIDO (`artifactHash` null en repeticiones previas) |
| `generated_test_proposals.contentSha256` | PERSISTIDO sobre el buffer exacto; CALCULABLE leyendo el objeto de Storage |
| `context_traces.detail` contiene `contentSha256` por extracto (snippet ≤2000 car., `experiment-attempt-presenters.ts:150-175`) y `resultSha256` por paso del agente | PERSISTIDO |
| Commit/HEAD: `analysis_runs.headSha`, `project_versions.commitSha`, `experiment_runs.commitSha` | PERSISTIDO (no son hash de contenido) |
| `snapshotRef` | CALCULABLE: UUIDv5 de `projectVersionId`+`headSha` (`evidence-mapping.ts:119-122`) |
| Hash del snapshot ZIP (`project_versions.snapshotKey` = `project-versions/{id}/snapshot.zip`) | NO EXISTE persistido; CALCULABLE descargando el ZIP ⚠ (si sigue en Storage) |
| Hash de `pairOrder`/semilla | CALCULABLE: `pairOrder(seed,i)` y `experimentPairId` (`pair-order.ts`) |
| Hash del paquete del extractor | NUEVO (manifiesto propio) |

### 1.f Campos automáticos de la Tabla 70 (Anexo L, tesis línea 2586)
Columnas: evidence_id · OE/indicador · Fecha · Proyecto/snapshot/Run · Tipo · Ubicación maestra · Estado · Qué demuestra. Automatizables: **Fecha** = `generatedAt` del extractor (y `analysis_runs.createdAt/completedAt`, `experiment_runs.startedAt/completedAt`); **Proyecto/snapshot/Run** = `projects.name/id`, `project_versions.id/commitSha`, `snapshotRef` calculado, `analysis_runs.id/repositoryName/prNumber/headSha`, `experiment_runs.id`; **Tipo** = `dataset/log/hash/configuración` (derivable por archivo). **No automatizables**: `evidence_id` (lo asigna el usuario/D-1), `OE/indicador`, `Estado` (VERIFICADA solo tras comprobación humana), `Qué demuestra`, `Ubicación maestra` (el extractor da ruta relativa del paquete; la maestra es del usuario).

### 1.g Otros datos para CF/CO/VT y tesis
PERSISTIDO en `experiment_repetitions`: `compiled/executed/passed/valid`, `failureType`, `errorSummary`, `generationDurationMs/executionDurationMs/totalDurationMs`, `inputTokens/outputTokens/totalTokens`, `estimatedCost` (tarifa en configuración `LLM_*_COST_PER_1K_TOKENS`; la tarifa usada NO se guarda: no reproducible a posteriori; null si faltan tokens, `cost-calculator.ts`), `retrievedChunks/selectedChunks/contextTokens`, `toolCalls/filesInspected`, `trajectory` (JSON; pasos del agente saneados, `safeAgentStep`), `pairId/pairPosition`, `technicallyEvaluable`, `attempt`, `state`, `startedAt/finishedAt`, `lastHeartbeatAt`. `experiment_runs.budget` (`toolCallCap, contextTokenBudget, maxDurationMs`), `randomizationSeed` (orden reproducible, CALCULABLE), `totalRepetitions`, `status`, `failureCode/Message`. `context_traces.detail` (RAG: candidatos con score/decisión/descarte, `target.excerpt`, `dependencyContext`, `functionalRules` con ids; AGENT: trayectoria y `budget`) + `discovered_files`.

## 2. Lo que NO se persiste o se trunca (funcionalidad nueva, posterior al tag)
| Faltante | Detalle |
|---|---|
| Texto del prompt RAG y del agente | NO EXISTE: solo `promptSha256` (DEC-VAL-001 PENDING; prompt RAG en `experiment-job.handler.ts:1051-1061`). No reconstruible sin volver a recuperar y construir |
| Respuesta cruda del LLM | NO EXISTE: se guarda solo el contenido fusionado final; la diferencia (fences, texto extra, fusión PHP) no es auditable |
| Contexto RAG completo | TRUNCADO: `context_traces.detail` guarda `snippet` ≤2000 caracteres por chunk objetivo/candidato (+ `contentSha256`); el texto exacto entregado al LLM no se guarda. Para AnalysisRun solo ids/conteos (`selectedChunkIds`, `functionalRuleIds`); el texto se reconstruye leyendo `code_chunks.content` ⚠ (CALCULABLE parcial si el `ProjectVersion` sigue indexado) |
| Trazas de herramientas del agente | TRUNCADO: resumen + `snippet` ≤2000 car. + `resultSha256`; resultados completos de `read_file/search_text` NO EXISTEN |
| Oráculo | NO EXISTE en el producto (por diseño, fuera de inputs; vive en `Tesis-Validacion`/runbook) |
| Prueba >256 KiB | TRUNCADA (`testContentTruncated`; hash del completo sí) |
| stdout/stderr en AnalysisRun | NO EXISTE |
| stdout/stderr de experimentos | TRUNCADO (8 KiB/entrada, 40 KiB total, secretos redactados) y además ya recortado por el Sandbox (64 KiB) |
| Log completo de `composer install` | NO EXISTE como kind propio; solo si el Sandbox lo vuelca en una entrada ⚠ |
| Exit codes | NO EXISTE |
| Más de 200 casos por repetición | TRUNCADO (`testCasesOmitted`) |
| Versión previa de una propuesta (reintento) | NO EXISTE (sobrescritura por run+símbolo) |
| Tarifas de costo aplicadas, versiones instaladas por Composer, `composer.lock` | NO EXISTE |
| Logs de jobs | `jobs` es tabla interna (schema.prisma:1039); contenido ⚠ |
| Evidencia pre-migración | Filas anteriores sin `sandboxEvidence`, `promptSha256`, `artifactHash`, `startedAt` (sin backfill) |

## 3. Viabilidad del extractor con solo SELECT (+ lectura de Storage)
| Pieza | Veredicto |
|---|---|
| Test generado por repetición/estrategia (experimentos) | **Viable** (BD); truncado a 256 KiB y sin redactar: el extractor debe aplicar su propia redacción y reportar `testContentTruncated` |
| Test generado AnalysisRun | **Parcial/viable**: requiere leer Storage (clave `storageKey`); solo última versión por símbolo |
| Salida Composer/PHPUnit | **Parcial**: experimentos con evidencia acotada (≤40 KiB); AnalysisRun imposible; salida completa imposible |
| Logs | **Parcial** (igual que arriba); logs de Render/VM imposibles |
| `modelConfig` | **Viable** |
| Trace 9 enlaces directo | **Viable** (todas las tablas persistidas) |
| Chequeo inverso | **Viable** por joins; no verifica PR/HEAD contra GitHub |
| SHA-256 | **Viable**: relee y recomputa los persistidos; añade manifiesto propio |
| Campos automáticos Tabla 70 | **Parcial** (Fecha, Proyecto/snapshot/Run, Tipo); los demás son humanos |
| Tokens, costos, tiempos, intentos, budgets, semilla | **Viable** (costo: tarifa no persistida) |
| Prompt, respuesta cruda LLM, contexto RAG completo, trazas completas del agente, oráculo, exit codes | **Imposible** (requieren funcionalidad nueva) |

Riesgos: (1) la conexión del producto usa el rol propietario, que ignora RLS (`20260921130000_enable_rls_all_tables`, todas las tablas con RLS sin políticas): un rol de solo lectura **sin BYPASSRLS ni políticas vería 0 filas**; crear ese rol es un cambio de infraestructura (aprobación del usuario). Alternativa sin cambio de BD: conexión con el rol existente + `BEGIN; SET TRANSACTION READ ONLY;` (precedente en `src/prisma/functional-knowledge-scenarios-migration.spec.ts:67-68`) y solo SELECT, con una prueba que verifique que el SQL del script no contiene verbos de escritura. (2) Leer Storage requiere `SUPABASE_SECRET_KEY` (`config/env.validation.ts:51`), que **no es de solo lectura**: el script usa únicamente `download` con un cliente propio; NO debe reutilizar el adaptador del producto, que hace `createBucket` si falta el bucket (`supabase-object-storage.adapter.ts:80-86`). (3) Consistencia BD/Storage: escritura best-effort; filas sin artefacto, o `storageKey` huérfano; un reintento sobrescribe. El extractor reporta cada ausencia en el manifiesto, no la rellena. (4) Secretos: `testContent` no está redactado y puede incluir secretos de terceros; `modelConfig.endpoint` es interno. **Conflicto redacción vs. hashes:** `redactSecretsInText` (`src/common/sanitize-failure-message.util.ts:172`) está pensada para stdout/stderr por entrada: `COOKIE_HEADER` (:35) consume hasta el final del texto y `redactUrlToken` recorta query y credenciales de cualquier token con esquema; aplicada a un test PHP/TS lo mutila y el hash dejaría de coincidir con `testContentSha256`. Por tanto el hash se verifica sobre los BYTES tal como están en la BD; la redacción, si se aplica, va en una copia aparte (o no se aplica al test y se avisa), y el manifiesto registra ambos hashes. Cualquier lista de patrones reutilizada debe probarse sobre código PHP/TS. Menor: `artifactHash` hashea `merged.content` sin quitar NUL y `testContentSha256` lo hace tras quitarlos: coinciden salvo que haya NUL. (5) Datos personales: `analysis_runs.actorLogin`, `prTitle`, `headRef/baseRef`, `test_publications.branchName` y `companionPullRequestUrl`; el manifiesto/CSV debe decidir si los incluye (política de PII junto a la de redacción). (5b) Los pilotos son repositorios públicos o controlados, no «validación empresarial» de `DEC-VAL-001` (`spec/contracts/system-contract.md:301`, PENDING, que bloquea código empresarial y no el de demostración autorizado): conviene precisarlo al aprobar el almacenamiento del código de terceros. (5c) La BD de desarrollo es la misma que usa Core en Render: son datos vivos aunque la lectura sea de solo lectura. (5d) Tamaño: ≤256 KiB test + 40 KiB evidencia + trayectoria por repetición; 54 ejecuciones ⇒ decenas de MB como máximo. (6) El extractor lee los mismos datos que ya expone el JSON de evidencia (`GET analysis-runs/:id/evidence`, `experiments/:id/evidence`; `src/evidence/evidence.controller.ts`), pero esa ruta pide un usuario con rol READER y no devuelve contenido: no sirve como fuente.

## 4. Propuesta de WI (viable)
**Alcance mínimo**: script `extract-evidence` que, dado `--analysis-run <id>` y/o `--experiment <id>`, escriba un paquete con: (a) por repetición/intento el `testContent` (+hashes y marca de truncado), `runnerReport`, `sandboxEvidence`, `sandboxFacts`, `failure`, métricas, `trajectory`, `promptSha256`; (b) `modelConfig`, `budget`, `randomizationSeed`, `pairOrder` recomputado y verificado contra `pairPosition`; (c) trace de 9 enlaces (directo) y resultado de cada chequeo inverso (OK/ruptura/N/A); (d) para AnalysisRun, contenido de propuestas desde Storage; (e) verificación de hashes (recomputado vs persistido); (f) manifiesto; (g) lista explícita de elementos «NO EXISTE/TRUNCADO» por caso. Sin endpoints, DTO ni cambios de esquema.

**Ubicación (comparación)**
| Opción | M1/ESC-MOD-01 | Lint/CI/build/test | Veredicto |
|---|---|---|---|
| `app/src/**` | Lo cuenta como código de producto (M1 se mide sobre `app/src`) y entra a `nest build` | `oxlint src/`, vitest, tsc | Descartada |
| `app/scripts/` (junto a `generate-contract-types.mjs`) | Fuera de `app/src` (`tsconfig.build.json`: `rootDir ./src`, `include ["src"]`): no entra al build ni a `dist`; M1 no se altera si el diff se acota a `app/src` (ver aprobación) | `app/vitest.config.ts` tiene `root './'` e `include '**/*.spec.ts'`: un `app/scripts/*.spec.ts` corre con `pnpm test` y en CI sin ampliar nada (el script y sus pruebas se ejecutarían en CI). `oxlint src/ test/` y `lint:types` NO cubren `app/scripts/`: hay que decidir si se amplía `lint` o se deja sin lint. Las dependencias `@prisma/adapter-pg`/`@supabase/supabase-js` son directas de `app/package.json` | **Recomendada** |
| `scripts/` (raíz, junto a `sdd-check.mjs`) | Fuera de `app/` | Sin acceso a `node_modules` de `app/` (pnpm estricto): obligaría a dependencia propia | Descartada |

Consecuencia: el script quedaría sin build ni lint pero con pruebas en CI; es un cambio del repositorio (commit en `feature/jean`, CI corre `pnpm lint/test/build` y los validadores). Si se agrega antes del tag `arch-v1.0`, entra en la línea base y no es parte del diff del ESC-MOD-01; si se agrega después y el diff de M1 se calcula sobre todo el repo, cuenta como archivo fuera de adapter/config (M1>0). Recomendación: antes del tag, o bien declarar en el protocolo que M1 se mide sobre `app/src` (decisión del usuario).

**Lenguaje y dependencias**: Node ESM `.mjs`, **sin dependencias nuevas**. `pg@8.23` solo es transitivo (no importable de forma estricta en pnpm); usar `@prisma/adapter-pg` (directo) o el cliente generado (`app/src/generated/prisma`, gitignored, TS: se importa desde `dist/` tras `pnpm build`, o se usa `PrismaPg` + `$queryRaw` en transacción). Ejecución dentro de `$transaction(async tx => { await tx.$executeRaw\`SET TRANSACTION READ ONLY\`; ... })`. Storage con `@supabase/supabase-js` (directo) y solo `.download()`. Prueba de que `node:crypto` sustituye al `canonicalJson`.

**Conexión sin secretos**: el operador exporta en su shell `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (`config/env.validation.ts:51`; `supabase-object-storage.adapter.ts:18`) y `SUPABASE_STORAGE_BUCKET`; el script **no carga `.env` ni dotenv**, no imprime ni escribe esas variables (ni en el manifiesto ni en errores; los errores de conexión se reemplazan por mensaje genérico), y falla si faltan. La BD de desarrollo está autorizada por AGENTS de cross.

**Formato**: carpeta `evidence-package-{runId|experimentId}-{UTC}/` con `manifest.json` (`packageSchemaVersion`, `generatedAt`, `extractorVersion`, ids, rama/HEAD del repo del extractor, SHA-256 y tamaño de cada archivo, lista de ausencias/truncados), `analysis-run.json`, `trace.json` (9 enlaces + inverso), `experiment.json` (modelConfig, budget, seed, pares), `repetitions.csv` (métricas) y `repetitions/{strategy}-r{n}-a{k}/{test.php|test.ts, runner-report.json, sandbox-evidence.json, trajectory.json}`; CSV con cabecera fija, UTF-8, sin secretos. `hashes.txt` con `sha256sum`-compatible.

**Pruebas y aceptación**: vitest con fixtures (rows sintéticas inyectadas por interfaz; no BD real); casos: recomputación de hashes correctos/rotos, truncado reportado, redacción de secretos (token sembrado no aparece), rechazo de SQL no `SELECT` (aserción sobre las consultas), transacción READ ONLY (mock/Postgres local de CI `*.pg` existente), chequeo inverso con ruptura sembrada, N/A, ausencia de Storage, manifiesto consistente, no lee `.env`. Aceptación: lint+test+build verdes, paquete determinista salvo `generatedAt`, ninguna variable de entorno ni URL en la salida (grep en prueba), documentación del runbook actualizada (WI-CORE-092 §3.d).

**Aprobación del usuario**: (1) ubicación `app/scripts/` y el criterio de M1; (2) uso de la BD de desarrollo con el rol propietario en transacción READ ONLY vs. crear un rol de lectura (cambio de infraestructura); (3) uso de la clave `SUPABASE_SECRET_KEY` de Storage por el operador (solo `download`); (4) si el extractor puede guardar código de terceros en disco del operador (DEC-VAL-001 PENDING); (5) la política de redacción (copia aparte; hash sobre bytes de BD) y de PII. No cambia contratos ni exige Contract Sync.

**Tamaño y orden**: ~1 WI M (≈400–600 líneas JS + ≈300 de pruebas): (1) consultas y paquete de experimentos; (2) trace + inverso; (3) Storage de AnalysisRun; (4) manifiesto/hashes/redacción; (5) pruebas y documentación. No depende del tag para ejecutarse, pero conviene mergearlo antes de él.

## 5. Riesgos, desconocidos y recomendación
**Desconocidos (consultas de solo lectura, NO ejecutadas)**
1. ¿Migraciones `20261013100000` y `20261013110000` aplicadas (verificar AMBAS)? `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;`
2. ¿Qué `stage`/`kind` etiqueta el Sandbox (hay composer)? `SELECT e->>'kind', e->>'stage', count(*) FROM experiment_repetition_artifacts a, jsonb_array_elements(a."sandboxEvidence"->'entries') e GROUP BY 1,2;`
3. ¿Cuántas repeticiones traen evidencia/artefacto? `SELECT count(*) FILTER (WHERE a.id IS NULL) sin_artefacto, count(*) FILTER (WHERE a."sandboxEvidence" IS NULL) sin_evidencia, count(*) FILTER (WHERE a."testContentTruncated") truncadas FROM experiment_repetitions r LEFT JOIN experiment_repetition_artifacts a ON a."repetitionId"=r.id WHERE r."experimentId"=:id;`
4. ¿Experimentos con `analysisRunId`/`commitSha` nulos? `SELECT id, "analysisRunId", "commitSha" FROM experiment_runs ORDER BY "createdAt" DESC LIMIT 20;`
5. ¿Los `storageKey` existen en Storage? No resoluble por SELECT (requiere `download`/`list`).
6. Uso de `$queryRaw` con el adaptador de Prisma: confirmar en código antes de implementar.

**Riesgos residuales**: el paquete cubre «lo persistido», no «todo lo del trial»; la salida completa de Composer/PHPUnit, prompts y trazas completas seguirán pendientes (funcionalidad nueva posterior al tag); el paper/tesis deben declarar la acotación (8 KiB/40 KiB/64 KiB) como límite de evidencia.

**Recomendación**: **hacerlo ahora**, en `app/scripts/`, solo con lo persistido y con el manifiesto de ausencias, antes de `arch-v1.0` (no altera M1 ni contratos; evita un botón); y registrar como funcionalidad posterior (tras el tag) el texto del prompt, la respuesta cruda y la salida de Composer, si el piloto muestra que el evaluador los necesita. Antes de implementar, el usuario resuelve los cinco puntos de aprobación de §4.
