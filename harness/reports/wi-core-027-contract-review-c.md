# WI-CORE-027 · Ratificación contractual del corte C (`/evidence`, INTEROP-2.7 §6.16)
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Solo lectura; no se editó INTEROP, spec ni código. Revisado: commits `32b4ebb`, `7b5f087`, `d17cd59` y `1cd66e8` (módulo `app/src/evidence`, `experiment-job.handler.ts`, `analysis-trace.repository.ts`, esquema Prisma), contra INTEROP-2.7 §6.15/§6.16 vigente, mis informes `wi-core-027-contract-review.md` y `-6-5.md` y `plan.md` (DEC-EVID-001…007). El cambio de persistencia interna de `ContextTracesRepository.beginAttempt` (`$queryRaw` a `$executeRaw`, corte E) no afecta contrato.

## Veredicto global

**CHANGES, dos correcciones pequeñas de código (decisiones 2 y 8), ninguna requiere decisión del usuario ni cambia el texto de §6.16 salvo lo indicado.** El resto está APPROVED. Tras aplicar 2 y 8 el contrato puede congelarse con el texto de la sección 3 y lanzarse CS-1.

## 1. Veredicto por decisión

| # | Decisión del implementer | Veredicto | Razón / acción |
|---|---|---|---|
| 1 | `retrieval[].candidates` con campos nullables | **APPROVED** | Cubierto por DEC-EVID-007 y la regla «no observado = `null`». Cada campo de candidato (`rank`, `chunkId`, `filePath`, `symbolQualifiedName`, `semanticScore`, `structuralRelation`, `combinedScore`, `selected`) es `| null` en el DTO (`EvidenceRetrievalCandidateResponse`), no `candidates` como arreglo. §6.15 no cambia (tipo propio). Nota: un `chunkId` `null` es un candidato sin identidad; es aceptable porque solo ocurre con JSONB corrupto y la alternativa (omitir) oculta el dato. |
| 2 | `sandbox[].durationMs = null` en EXPERIMENT | **CHANGES** | La duración **sí es observable**: `experiment_repetitions.executionDurationMs` (`Int?`, ya persistido y ya devuelto por `findRepetitions`, `experiment-runs.repository.ts:67`) mide la llamada al Sandbox (`Date.now() - executionStart`, handler L808/L842) y es `null` si no se invocó. Emitir siempre `null` contradice «nunca no-observado cuando existe el dato» y deja a Console sin duración para el experimento mientras el Run sí la tiene. Acción: añadir `executionDurationMs` a `ExperimentRepetitionRow` y emitir `toCount(repetition.executionDurationMs)` en `sandbox[]` (un valor negativo ya cae a `null` por `toCount`). Actualizar el test «lists a sandbox entry only for a repetition that invoked the Sandbox, with durationMs not observed». Sin cambio de tipo (`number | null`). |
| 3 | `runnerHint` por kind | **APPROVED con cambio de tipo en §6.16** | Qué emite hoy: ANALYSIS_RUN = `facts.runner` (el runner que reportó el Sandbox; `null` si la ejecución fue aceptada sin resultado, porque `analysis_run_executions` no tiene columna de runner); EXPERIMENT = `run.runnerHint` del experimento (siempre conocido). Deducirlo de `executionProfile` sería inventar (`NODE_TYPESCRIPT` admite JEST y VITEST). El DTO lo tipa `'JEST' | 'VITEST' | null`, y `toRunnerHint` descarta `PHPUNIT`: con `WI-CORE-028` (PHP, prioritario) un runner válido de §7 saldría `null`. En §6.16 se declara `string | null` (valores de `TestRunner` de §7.1) y se pide al implementer ampliar `toRunnerHint`/`RunnerFacts.runner` cuando aterrice PHP; hoy el subtipo es compatible. |
| 4 | `generation[].attempt` | **APPROVED con redacción exacta** | Run: `attempt` máximo de las ejecuciones registradas de la propuesta (`analysis_run_executions.attempt`; la propuesta es única por `(run, symbol)`), `null` si no hay ejecución. No es el número de intentos de generación del LLM; el texto de §6.16 lo dice así para que Console no lo interprete como tal. EXPERIMENT: `attempt` de la repetición vigente. |
| 5 | EXPERIMENT: `retrieval` con `mode: 'SE'` y `config` parcial | **APPROVED** | El brazo RAG usa pesos semántico/estructural (`configuration.semanticWeight/structuralWeight`), es decir SE de §6.15; `SEM` nunca ocurre en un experimento. `config` parcial: solo `finalTopK` (de `topK`) y los pesos están persistidos; `semanticTopK` y `embeddingModel` quedan `null` (DEC-EVID-007). Declarar en la nota que `finalTopK` es el `topK` configurado del brazo RAG. |
| 6 | `analysisRun.projectVersionId` y `snapshotRef` nullable | **APPROVED** | Un Run visible puede no tener `projectVersionId` (ya documentado en §6.15, `409 ANALYSIS_NOT_FINISHED`; aquí un Run terminal por fallo temprano). `snapshotRef` es derivado de él, por lo que es `null` junto con él. Nunca una URL. |
| 7 | `snapshotRef` = UUIDv5 «namespace DNS» | **APPROVED con corrección de etiqueta** | Nombre exacto verificado: `urn:tjc:snapshot-ref:v1:${projectVersionId}:${headSha}` (= DEC-EVID-005, no hay `0`-padding ni mayúsculas). El namespace usado, `6ba7b811-9dad-11d1-80b4-00c04fd430c8`, **es el namespace URL de RFC 4122, no DNS** (DNS es `6ba7b810-…`). Es el correcto semánticamente para una cadena `urn:`; no debe cambiarse (el valor ancla de la prueba de esquema, `dbcf983b-0215-5de2-a881-77d3a9c4c6c1` para `pv-1`/`head-1`, lo reproduce `uuid5(NAMESPACE_URL, …)`; verificado). Acción: corregir el comentario «mismo DNS de RFC 4122» de `SNAPSHOT_REF_NAMESPACE` (y los de `pair-order.ts` y `sandbox-request-id.util.ts` si dicen DNS) a «namespace URL». No requiere decisión del usuario: DEC-EVID-005 no fija namespace. §6.16 lo fija para reproducibilidad (texto de la sección 3). |
| 8 | `durationMs` negativo persistido como `0` (`clampDuration`) | **CHANGES: persistir `null`** | `0` en un campo que significa «duración medida» es un cero inventado: un reloj retrocedido no mide cero milisegundos, mide nada. La regla del proyecto (§6.5 «nunca con cero», DB `durationMs` «nunca 0 inventado», `analysis_run_executions.durationMs` comentado así) y la coherencia con `toCount` (que ya emite `null` ante negativos) piden `null`. El `CHECK durationMs >= 0` de `20261009190000` acepta `NULL` (los CHECK no se evalúan ante `NULL`), así que no hay riesgo de rechazo. Acción: en `clampDuration` devolver `null` si `durationMs < 0` (mantener `Math.round` para `>= 0`) y actualizar `analysis-trace.repository.spec.ts` (hoy espera `0`). Sin cambio de contrato. Mismo criterio aplica a `executionDurationMs` del experimento si se persiste negativo (hoy no hay CHECK; `toCount` ya lo emite `null`). |
| 9 | `agentExploration.steps = []` y `filesInspected = null` si no se persisten | **APPROVED** | Con `trace.detail = null` (adquisición del workspace falló antes de cualquier llamada) la trayectoria vacía es la observación fiel (mismo criterio que `context-traces.service.ts` L371-376). `filesInspected` `null` cuando `detail.filesInspected` no es entero (el detalle lo persiste en cada paso; en fallo previo no existe). Solo se leen `step`, `toolName`, `status`; sin `arguments`, `resultSummary`, `resultSha256`, `observations`. |
| 10 | `schemaVersion '1'` y prueba de esquema estable | **APPROVED** | Constante `'1'`; prueba `esquema estable` ancla las claves de cada objeto por kind (`EXPECTED_KEY_SHAPE`), reloj y `snapshotRef` fijos; una clave nueva sin bump rompe la prueba. Mantiene mi recomendación §4 del informe anterior. |
| 11 | `artifactHash` de repetición = SHA-256 de `mergedContent` | **APPROVED** | Run: `contentSha256` de la propuesta es el hash del buffer de `mergedContent` (`analysis-run-validation-job.handler.ts` L304-336, L527) y ese mismo `mergedContent` es el artefacto enviado al Sandbox. EXPERIMENT: hash de `mergedContent` (el mismo contenido enviado, L780-801), `null` si `generation.content` es vacío o no hubo invocación. Misma definición en ambos: «SHA-256 del contenido de prueba que se envía al Sandbox». Los hashes `contentSha256` de excerpts no se exportan. |

## 2. Verificaciones transversales

- **No exposición.** El bundle se ensambla campo a campo. `excerpt` de los candidatos RAG se lee solo para `filePath`/`symbolName`/`parentSymbolName` (metadatos), nunca `snippet`/`content`. No hay `content`, `groundTruth`, `testCases`, `knowledgeId`, `omitted`, `functionalRulesRetrieved/Selected/Omitted`, `retrievedChunks`, `selectedChunks`, `trajectory`, `arguments`, `resultSummary`, URLs ni claves de storage; la prueba `claves y valores prohibidos` cubre los tres kinds con fuentes sembradas con esos valores (30 claves y 12 fragmentos de valor). Conforme con §6.16 y con mi lista de «No se exporta nunca».
- **Estados.** `FAILED` de experimento y de comparación responden `200` (la comparación `FAILED` sin lectura de resultados, `retrieval: []`); `PENDING`/`RUNNING` y `QUEUED`/`PROCESSING` responden `409 EVIDENCE_NOT_FINISHED`; `404` es el de la ruta de estado. Pruebas en `evidence.service.spec.ts` y `evidence.controller.spec.ts`. Conforme.
- **Sin cambio en C de respuestas de experimentos.** `git diff 1cd66e8^..d17cd59` no toca `experiments/dto/` ni `experiments.service.ts`: `ExperimentRepetitionResponse` y `StrategyMetricsResponse` no cambian en C (DEC-EVID-001 y su cambio de §6.5 quedan para D). `experiment-job.handler.ts` y `experiment-runs.repository.ts` solo añaden persistencia interna (captura).
- **Desviaciones no listadas por el implementer** (todas cubiertas por la regla `null`, deben estar en el texto): `sandbox[].executionProfile` y `runnerHint` nullables; `context[].tokenCounts.selected` nullable; `agentExploration[].toolCallCap`, `contextTokenBudget` y los campos de `steps[]` nullables; `retrieval[].metrics` y la clave `technicallyEvaluable` ya estaban en la enmienda B.
- **Corte E no contractual.** La corrección `$queryRaw` a `$executeRaw` en `beginAttempt` es persistencia interna; no genera Contract Sync.

## 3. Texto exacto propuesto para §6.16 (listo para pegar; NO aplicado, NO marca «Implementado»)

### 3.1 Primer párrafo de §6.16

Sustituir la segunda oración en negrita («**La exportación de evidencia (`/evidence`) sigue definida y pendiente de implementar y verificar** (`WI-CORE-027`; la Console la consume en `WI-CONSOLE-017`).») por:

> **La exportación de evidencia (`/evidence`) está implementada en Core hasta el corte C de `WI-CORE-027`, con la forma de `EvidenceBundleResponse` congelada en `schemaVersion '1'`; sigue pendiente de verificación final y de la declaración de «Implementado» y de la entrega del consumidor** (`WI-CORE-027`; la Console la consume en `WI-CONSOLE-017`).

### 3.2 Nota nueva, tras el párrafo «Aclaraciones del trace implementado» y antes del bloque `ts`

> Aclaraciones de la exportación de evidencia (`WI-CORE-027`): un dato no observado es `null`, nunca `0` ni cadena vacía; los runs, propuestas y repeticiones anteriores a la implementación no se rellenan (sin backfill) y emiten `null` en `executionId`, `requestId`, `correlationId`, `durationMs`, `artifactHash` y en los campos de generación. Una duración que no pudo medirse (por ejemplo, reloj retrocedido) es `null`. `sandbox[]` y `generation[]` llevan `repetition` y `strategy` para unirse con `experimental[]` (`repetition` es `null` y `strategy` es `PRODUCT` en un `AnalysisRun`). `generation[].attempt` es, en un `AnalysisRun`, el mayor `attempt` de las ejecuciones registradas de la propuesta (`null` si no hay ejecución), no un contador de intentos del LLM, y en un `EXPERIMENT`, el `attempt` de la repetición vigente. `experimental[].technicallyEvaluable` refleja la exclusión de repeticiones no evaluables del agregado (§6.5.1) y no debe usarse para inferir CF ni CO; `pairId`, `pairPosition` y `randomizationSeed` son `null` en experimentos anteriores a OE5. `retrievalId` y `contextId` de un `EXPERIMENT` son el `id` de la `ContextTrace` del brazo RAG, cuyo `mode` es siempre `SE`; `retrieval[].config` es un tipo propio de la evidencia (no alias de §6.15) con `null` en cada valor no persistido: en un `AnalysisRun` solo `semanticTopK` se persiste, en un `EXPERIMENT` solo `finalTopK` (el `topK` configurado del brazo RAG) y los pesos, y `embeddingModel` es `null` en ambos. En un candidato de retrieval cada campo es `null` si el dato no se persistió; `selected` es `null` si no hay contexto o decisión. `retrieval[].metrics` solo se informa en `RETRIEVAL_COMPARISON`; `groundTruth` no se exporta. `analysisRun.projectVersionId` y `analysisRun.snapshotRef` son `null` mientras el Run no tenga `projectVersionId`; `snapshotRef` es un UUID versión 5 (namespace URL de RFC 4122, `6ba7b811-9dad-11d1-80b4-00c04fd430c8`) del nombre `urn:tjc:snapshot-ref:v1:{projectVersionId}:{headSha}`, una referencia opaca que no es clave de almacenamiento ni URL. `artifactHash` es el SHA-256 del contenido de prueba enviado al Sandbox (`null` si no hubo contenido). `sandbox[].durationMs` es la duración de la llamada al Sandbox. `sandbox[].runnerHint` es el runner reportado por el Sandbox en un `AnalysisRun` (`null` si la ejecución no devolvió resultado) y el `runnerHint` del experimento en un `EXPERIMENT`; los valores son los de `TestRunner` (§7.1). En una repetición `COMPLETED` con pruebas fallidas, `sandbox.facts.failureCategory` es el tipo de fallo observado y `failureStage`, `failureCode` y `failureMessage` son `null`; `failureMessage` y `failureCode` se emiten saneados. `agentExploration[].steps` es `[]` y `filesInspected` es `null` cuando la exploración no llegó a persistirse. Una comparación `FAILED` y un experimento `FAILED` responden `200`; la comparación `FAILED` trae `retrieval: []`. La evidencia no incluye `excerpt` ni contenido de código, `testCases`, logs, URLs ni claves de almacenamiento, `knowledgeId`, reglas omitidas ni conteos de Functional Knowledge. `schemaVersion` permanece `'1'`: cualquier clave nueva o eliminada posterior exige un nuevo valor.

### 3.3 Bloque de tipos (reemplaza `interface EvidenceBundleResponse { … }`; `EvidenceKind` queda igual)

```ts
type EvidenceKind = 'ANALYSIS_RUN' | 'EXPERIMENT' | 'RETRIEVAL_COMPARISON'
type EvidenceStrategy = ExperimentStrategy | 'PRODUCT'

interface EvidenceRetrievalCandidateResponse {
  rank: number | null
  chunkId: Id | null
  filePath: RelativePath | null
  symbolQualifiedName: string | null
  semanticScore: number | null
  structuralRelation: StructuralRelation | null
  combinedScore: number | null
  selected: boolean | null
}

interface EvidenceRetrievalConfigResponse {
  semanticTopK: number | null
  finalTopK: number | null
  semanticWeight: number | null
  structuralWeight: number | null
  embeddingModel: string | null
}

interface EvidenceBundleResponse {
  schemaVersion: '1'
  kind: EvidenceKind
  subjectId: Id
  generatedAt: IsoDateTime
  correlationId: string
  analysisRun: {
    analysisRunId: Id
    repositoryName: string
    pullRequestNumber: number
    headSha: string
    projectVersionId: Id | null
    snapshotRef: string | null // referencia opaca; nunca una URL firmada
    targets: AnalysisSymbolResponse[]
    createdAt: IsoDateTime
  } | null
  retrieval: {
    retrievalId: Id
    mode: RetrievalMode
    config: EvidenceRetrievalConfigResponse
    candidates: EvidenceRetrievalCandidateResponse[]
    metrics: RetrievalMetricsResponse | null // solo RETRIEVAL_COMPARISON con groundTruth
  }[]
  context: {
    contextId: Id
    selectedChunkIds: Id[]
    discardedChunkIds: Id[]
    tokenCounts: { selected: number | null; budget: number | null }
    functionalRuleIds: Id[]
  }[]
  generation: {
    strategy: EvidenceStrategy
    repetition: number | null
    attempt: number | null
    provider: string | null
    model: string | null
    modelVersion: string | null
    reasoningEffort: string | null
    inputTokens: number | null
    outputTokens: number | null
    durationMs: number | null
    artifactHash: Sha256 | null
  }[]
  agentExploration: {
    toolCallCap: number | null
    steps: { step: number | null; toolName: string | null; status: string | null }[]
    filesInspected: number | null
    contextTokenBudget: number | null
  }[]
  sandbox: {
    executionId: string | null
    strategy: EvidenceStrategy
    repetition: number | null
    executionProfile: string | null
    runnerHint: string | null
    attempt: number
    facts: Record<string, string | number | boolean | null> // claves cerradas: executionProfile, runner, compiled, executed, passed, totalTests, passedTests, failedTests, skippedTests, testCasesTruncated, failureStage, failureCategory, failureCode, failureMessage; sin logs, evidencias ni URLs y con failureMessage saneado
    durationMs: number | null
    requestId: string | null
    correlationId: string | null
  }[]
  experimental: {
    experimentId: Id
    strategy: ExperimentStrategy
    repetition: number
    pairId: Id | null
    pairPosition: 1 | 2 | null
    attempt: number
    randomizationSeed: string | null
    technicallyEvaluable: boolean
  }[]
  publication: TracePublicationResponse | null
}
```

Líneas de estado (14, ~913, ~1132, ~1379, §6.13): **no se tocan en C**; siguen según mi informe `wi-core-027-contract-review.md` §5.2-5.4, corte D.

## 4. Contract Sync CS-1 a Console (texto para el leader)

- **Origen / destino:** Core (`WI-CORE-027`, corte C) → Console (`WI-CONSOLE-017`; `WI-CONSOLE-020` no impactado). Sin impacto en Sandbox ni GitHub Integration.
- **breaking: `true`** (compilación de TypeScript estricto). Ningún emisor previo existía y la ruta no estaba implementada, por lo que no hay ruptura en runtime; pero muchos campos de §6.16 pasan de no nulos a `| null` y aparecen claves nuevas (`technicallyEvaluable`, `repetition`, `strategy`, `attempt`, `metrics`), y eso rompe tipos o mocks que Console haya escrito contra el §6.16 anterior. Coherente con el tratamiento de §6.5 (`-6-5.md`).
- **changed:** INTEROP-2.7 §6.16: forma congelada de `EvidenceBundleResponse` en `schemaVersion '1'` con `| null` en `analysisRun.projectVersionId/snapshotRef`, `retrieval[].config/candidates[]` (tipos propios), `context[].tokenCounts.selected`, `generation[]` (`provider`, `model`, `durationMs`, `artifactHash`, `repetition`, `attempt`), `agentExploration[]` y sus `steps[]`, `sandbox[]` (`executionId`, `executionProfile`, `runnerHint`, `durationMs`, `requestId`, `correlationId`, `repetition`), `experimental[]` (`pairId`, `pairPosition`, `randomizationSeed`); claves nuevas `experimental[].technicallyEvaluable`, `sandbox[]/generation[].repetition`, `generation[].attempt`, `retrieval[].metrics`; rutas `GET /analysis-runs/{id}/evidence`, `GET /experiments/{id}/evidence`, `GET /retrieval-comparisons/{id}/evidence` (Reader; `200`/`404`/`409 EVIDENCE_NOT_FINISHED`; `FAILED` de experimento y de comparación responde `200`; sin `403` alcanzable con Reader).
- **requiredAction (Console):** (a) tipar y mockear `/evidence` contra el bloque de §6.16 del corte C y tratar todo valor `| null` como «sin dato», nunca como `0`; (b) no inferir CF/CO ni validez de `technicallyEvaluable`; (c) no esperar `excerpt`, contenido de código, `testCases`, `groundTruth`, `knowledgeId`, URLs ni claves de storage; (d) tolerar `retrieval: []` en una comparación `FAILED` y secciones vacías según `kind`; (e) tratar `snapshotRef` como cadena opaca; (f) tolerar claves desconocidas futuras solo bajo un `schemaVersion` mayor. Responder con acuse `C-ACK` cuando `WI-CONSOLE-017` consuma esta versión.
- **Checkpoints de contenido (siete):** 1) `schemaVersion '1'` fijo, claves por kind congeladas; 2) `null` = no observado, sin backfill en filas previas; 3) `retrieval[].config` tipo propio con `null` por valor (EXPERIMENT: solo `finalTopK` y pesos; ANALYSIS_RUN: solo `semanticTopK`); 4) `sandbox[].durationMs` = llamada al Sandbox, `null` si no hubo o no se midió; `runnerHint` string del `TestRunner`; 5) `generation[].attempt` en Run = intento de la última ejecución, no de generación; 6) `artifactHash` = SHA-256 del contenido enviado al Sandbox; `snapshotRef` = UUIDv5 opaco; 7) no exportado: `excerpt`/código, `testCases`, `groundTruth`, `knowledgeId`, reglas omitidas, URLs, claves de storage, `EV-OE*`.
- **Estado inicial:** `C-PENDING`. **`sourceRevision`:** el commit del corte C con las correcciones 2, 8 y la etiqueta del namespace aplicadas (no `d17cd59`, que aún emite `durationMs` nulo en EXPERIMENT y `0` ante reloj retrocedido). Los estados «Implementado» y CS-3 (§6.5, DEC-EVID-001) quedan para el corte D.

## 5. Acciones para el leader (ninguna requiere al usuario)

1. Implementer: decisiones 2 y 8 (código y pruebas) y comentario del namespace (7); ampliar `toRunnerHint` a `PHPUNIT` o dejar nota para `WI-CORE-028` (3).
2. Aplicar en INTEROP (sesión con permiso) el texto de §3 al cerrar el corte C; lanzar CS-1 tras confirmación del usuario; D marca «Implementado».
3. Corregir `plan.md` si cita «namespace DNS» de `snapshotRef` (DEC-EVID-005 no lo fija; usar «namespace URL»).
