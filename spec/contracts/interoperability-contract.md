# Contrato universal de interoperabilidad

**Versión:** INTEROP-2.1
**Compatible con:** SYSTEM-2.1
**Fecha de corte:** 2026-09-14
**Estado:** APROBADO salvo decisiones externas referenciadas explícitamente
**Propietario canónico:** `tjc-be-rag-core-api/spec/contracts/interoperability-contract.md`

Este documento define el vocabulario y los contratos HTTP compartidos por Developer Console, RAG Core y Test Execution Sandbox. Los tres repositorios conservan una copia espejo byte por byte. Una spec local puede detallar su implementación, pero no cambiar rutas, DTOs, estados o semántica de este contrato.

## 1. Compatibilidad y autoridad

- Las rutas manuales de carga ZIP y generación por modos (`METHOD|CLASS|PROJECT`) anteriores a SDD 2.0 quedan retiradas; no existe compatibilidad legacy paralela. El único disparador de análisis es PR-driven (`AnalysisRun`).
- `INTEROP-2.1` es la versión documental vigente. Hereda de `INTEROP-2.0` el nuevo lifecycle PR/HEAD, los estados de AnalysisRun y los perfiles PHP; además retira las rutas manuales del punto anterior (§6.3, §6.4) antes de su primera implementación real — ver `CHANGELOG.md`.
- Los consumidores deben ignorar campos de respuesta desconocidos, pero los servidores rechazan campos de request no declarados.
- Los DTO HTTP son explícitos y no exponen entidades ORM, tipos del SDK de Supabase ni modelos internos del LLM.
- Los nombres de ruta y DTO presentes solo en mocks dejan de ser autoridad cuando contradigan este documento.

## 2. Convenciones universales

```ts
type Id = string // UUID
type IsoDateTime = string // ISO 8601 UTC
type RelativePath = string // POSIX, relativo, normalizado y sin traversal
type Sha256 = string // 64 caracteres hexadecimales minúsculos

interface Page<T> {
  items: T[]
  nextCursor: string | null
}
```

- JSON UTF-8 y propiedades `camelCase`, salvo uploads y descargas binarias.
- Enums en `UPPER_SNAKE_CASE` y duraciones en milisegundos con sufijo `Ms`.
- Contadores, bytes y duraciones son enteros no negativos.
- Un campo nullable declarado se devuelve como `null`; no se usa `""`, `0` o ausencia para representar un valor desconocido.
- Un campo opcional de request se omite cuando no aplica.
- Todo path de proyecto o artefacto usa `/`, nunca es absoluto, no contiene `..` y se valida nuevamente en cada backend.
- `limit` usa default 20, mínimo 1 y máximo 100. `cursor` es opaco y no debe interpretarse en el frontend.

## 3. Headers y correlación

- `x-correlation-id`: opcional desde el navegador; RAG Core lo genera cuando falta y siempre lo devuelve. Core lo propaga al Sandbox y el Sandbox lo devuelve.
- `Idempotency-Key`: UUID obligatorio en respuestas funcionales, solicitudes de publicación y `POST /executions`. Los webhooks usan `x-github-delivery` como identidad externa y no aceptan una key inventada por la Console. La ausencia o formato inválido devuelve `400 IDEMPOTENCY_KEY_REQUIRED` o `400 INVALID_IDEMPOTENCY_KEY`.
- En navegador→Core, Developer Console genera una key por acción lógica y conserva el mismo valor en todo reintento de transporte. Core persiste key + huella canónica del request bajo una restricción única: mismo par devuelve la respuesta aceptada original sin crear recurso/job adicional; misma key con huella distinta devuelve `409 IDEMPOTENCY_CONFLICT`.
- En Core→Sandbox no se reutiliza directamente la key raíz cuando una operación produce varias ejecuciones. Core deriva un UUID v5 estable con el namespace estándar URL `6ba7b811-9dad-11d1-80b4-00c04fd430c8` y un nombre canónico según la unidad lógica: `urn:tjc:sandbox-execution:v1:generation:{jobId}:{targetId}`, `urn:tjc:sandbox-execution:v1:experiment:{jobId}:{strategy}:{repetition}` o `urn:tjc:sandbox-execution:v1:manual-retry:{retryJobId}:{targetId}`. La key hija es también `requestId` y se reutiliza en cualquier retry.
- `Authorization: Bearer <service-token>` es obligatorio en todos los endpoints `/executions`. El valor es un secreto opaco precompartido de alta entropía, configurado como `SANDBOX_SERVICE_TOKEN` en Core y Sandbox; no es JWT, no usa proveedor de identidad y nunca ingresa al frontend, logs, PostgreSQL, Storage o container. Core lo exige cuando configura `SANDBOX_URL`; Sandbox lo exige al arrancar. Los endpoints `/health/live` y `/health/ready` no requieren este header.
- `Authorization: Bearer <user-access-token>` es obligatorio en todos los endpoints navegador→Core salvo `GET /health`. Es un JWT de sesión emitido por Supabase Auth para HU29; RAG Core valida firma, issuer, audience y expiración mediante el mecanismo compatible con las signing keys del proyecto. El token identifica al propietario y nunca se reenvía al Sandbox.
- La ausencia de credencial de usuario devuelve `401 AUTH_REQUIRED`; un token inválido o expirado devuelve `401 INVALID_ACCESS_TOKEN`. Las consultas a recursos de otro propietario responden `404` con el código del recurso (`PROJECT_NOT_FOUND`, `TEST_RUN_NOT_FOUND`, etc.) para no revelar su existencia.

## 4. Errores HTTP

Todos los errores HTTP usan:

```ts
interface ErrorEnvelope {
  statusCode: number
  code: string
  message: string
  details: unknown | null
  correlationId: string
  timestamp: IsoDateTime
  path: string
}
```

Reglas:

- `400`: request sintáctica o semánticamente inválida.
- `401/403`: credencial ausente/inválida o acceso no permitido.
- `404`: recurso inexistente.
- `409`: estado actual incompatible, operación aún no terminada o conflicto de idempotencia.
- `413`: payload excede el límite configurado.
- `422`: proyecto, runner o formato reconocido pero no soportado.
- `429`: límite de solicitudes/concurrencia.
- `503`: dependencia de plataforma impide aceptar o consultar la operación.
- Un fallo de compilación, test, dependencia del proyecto o timeout ocurrido después de un `202` es resultado persistido de la ejecución, no un HTTP 5xx.
- Controllers validan DTOs mediante pipes globales con whitelist y rechazo de campos desconocidos; el formato se centraliza mediante filtros de excepción.

## 5. Operaciones asíncronas

Toda creación asíncrona responde `202` con identidad estable y `pollAfterMs`. Los GET de estado son ligeros; los resultados detallados tienen una ruta separada.

```ts
interface AsyncAccepted {
  status: 'PENDING'
  pollAfterMs: number
}
```

- Consultar resultados antes de un estado terminal devuelve `409 *_NOT_FINISHED`.
- Los estados terminales permanecen consultables; un cliente puede repetir GET sin cambiar el recurso.
- Un estado `FAILED` debe conservar código/mensaje resumido y timestamps. Evidencia extensa se entrega por referencias, no embebida sin límite.

## 6. Contrato Developer Console ↔ RAG Core

El navegador consume solamente RAG Core.

### 6.1 Health y proyectos

- `GET /health` → `200 HealthResponse`.
- `POST /projects` → `201 ProjectResponse`.
- `GET /projects/{projectId}` → `200 ProjectResponse`.
- `GET /projects?cursor&limit` → `200 Page<ProjectResponse>`.

```ts
interface HealthResponse {
  status: 'ok'
  timestamp: IsoDateTime
}

interface CreateProjectRequest {
  name: string // trim, 1..200
}

interface ProjectResponse {
  id: Id
  name: string
  currentVersionId: Id | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
```

### 6.2 ProjectVersion e indexación

La carga manual `POST /projects/index` (multipart ZIP) queda **retirada**: el único origen de un `ProjectVersion` es un snapshot derivado de `AnalysisRun` (commit SHA vía GitHub App), pendiente de implementación (HU33/34). Los siguientes endpoints de lectura permanecen vigentes sobre el `ProjectVersion` que produzca ese flujo:

- `GET /project-versions/{projectVersionId}` → `200 ProjectVersionResponse`.
- `GET /project-versions/{projectVersionId}/results` → `200 ProjectVersionResultsResponse` solo al completar.
- `GET /project-versions/{projectVersionId}/test-inventory` → `200 TestInventoryResponse` solo al completar.
- `GET /projects/{projectId}/versions?cursor&limit` → `200 Page<ProjectVersionSummaryResponse>`.

```ts
type ProjectVersionStatus =
  | 'PENDING' | 'EXTRACTING' | 'ANALYZING' | 'CHUNKING'
  | 'EMBEDDING' | 'PERSISTING' | 'COMPLETED' | 'FAILED'

interface ProjectVersionResponse {
  id: Id
  projectId: Id
  status: ProjectVersionStatus
  originalFileName: string | null
  sizeBytes: number | null
  filesProcessed: number | null
  chunksCount: number | null
  failureReason: string | null
  startedAt: IsoDateTime | null
  completedAt: IsoDateTime | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

interface ProjectVersionResultsResponse {
  id: Id
  projectId: Id
  status: 'COMPLETED'
  filesProcessed: number
  chunksCount: number
  detectedFramework: 'JEST' | 'VITEST' | null
  targetsTotal: number
  targetsWithTest: number
  targetsMissingTest: number
  completedAt: IsoDateTime | null
}

interface ProjectVersionSummaryResponse extends ProjectVersionResponse {
  detectedFramework: 'JEST' | 'VITEST' | null
  targetsTotal: number | null
  targetsWithTest: number | null
  targetsMissingTest: number | null
  current: boolean
}

type TestTargetType = 'CLASS' | 'METHOD' | 'FUNCTION'

interface TestTargetResponse {
  id: Id
  filePath: RelativePath
  symbolName: string
  methodName: string | null
  targetType: TestTargetType
  hasTest: boolean
  testFilePaths: RelativePath[]
}

interface TestInventoryResponse {
  projectVersionId: Id
  detectedFramework: 'JEST' | 'VITEST' | null
  targetsTotal: number
  targetsWithTest: number
  targetsMissingTest: number
  targets: TestTargetResponse[]
}
```

### 6.3 Generación y validación (RETIRADO)

Los 5 modos manuales de generación (`TARGET|CLASS_ALL|CLASS_MISSING|PROJECT_MISSING|PROJECT_ALL`), `POST /test-runs` y endpoints asociados (estado, resultados, historial HU20, retry manual HU24) quedan **retirados como ruta de producto** junto con la carga ZIP de la que dependían (ver `CHANGELOG.md`). La generación real nace de un `AnalysisRun` (HU39-40, pendiente de implementación); no hay contrato HTTP vigente para generación manual.

### 6.4 Artefactos (RETIRADO)

Los 4 endpoints de artefactos (`GET /test-runs/{runId}/artifacts`, `.../artifacts/download`, `GET /artifacts/{artifactId}/diff`, `.../download`) dependían exclusivamente de `TestGenerationRun` (§6.3, retirado) y quedan retirados con él. Los artefactos de tests generados vuelven, rediseñados sobre `AnalysisRun`, con la publicación por companion PR (HU39-40).

`storageKey`, bucket, credenciales y URLs internas nunca aparecen en DTOs para el navegador.

### 6.5 Experimento

- `POST /experiments` → `202 ExperimentAcceptedResponse`.
- `GET /experiments/{experimentId}` → `200 ExperimentStatusResponse`.
- `GET /experiments/{experimentId}/results` → `200 ExperimentResultsResponse` al completar.

El experimento `RAG` vs `GENERALIST_AGENT` (HU19) se conserva. `CreateExperimentRequest.targetId` referenciaba un `TestTarget` producido por la indexación ZIP ahora retirada (§6.2); mientras no se reapunte la unidad experimental a un `AnalysisRun` (P1/P4, corte futuro), este endpoint no tiene una ruta vigente para crear targets nuevos. El DTO se conserva sin cambios para no anticipar un diseño no aprobado.

```ts
type FailureType =
  | 'NONE' | 'COMPILATION' | 'TEST_ASSERTION' | 'TEST_RUNTIME'
  | 'DEPENDENCY' | 'CONFIGURATION' | 'INFRASTRUCTURE' | 'UNKNOWN'

interface CreateExperimentRequest {
  projectId: Id
  targetId: Id // METHOD o FUNCTION
  repetitions?: number // default y único valor V1 aprobado: 3
}

interface ExperimentAcceptedResponse extends AsyncAccepted {
  experimentId: Id
  projectVersionId: Id
}

type ExperimentStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
type ExperimentStrategy = 'RAG' | 'GENERALIST_AGENT'

interface ExperimentStatusResponse {
  id: Id
  projectId: Id
  projectVersionId: Id
  targetId: Id
  status: ExperimentStatus
  completedRepetitions: number
  totalRepetitions: number // 6: 3 por estrategia
  failureCode: string | null
  failureMessage: string | null
  startedAt: IsoDateTime | null
  completedAt: IsoDateTime | null
}

interface StrategyMetricsResponse {
  strategy: ExperimentStrategy
  validRate: number
  compilationRate: number
  executionRate: number
  passedRate: number
  generationDurationMs: number
  executionDurationMs: number
  totalDurationMs: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCost: number | null
  retrievedChunks: number | null
  selectedChunks: number | null
  contextTokens: number | null
  toolCalls: number | null
  filesInspected: number | null
  failures: Partial<Record<FailureType, number>>
}

interface ExperimentRepetitionResponse {
  repetition: 1 | 2 | 3
  strategy: ExperimentStrategy
  valid: boolean
  failureType: FailureType
  generationDurationMs: number
  executionDurationMs: number
  totalDurationMs: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCost: number | null
}

interface ExperimentResultsResponse {
  experimentId: Id
  projectVersionId: Id
  targetId: Id
  repetitionsPerStrategy: 3
  strategies: StrategyMetricsResponse[]
  repetitions: ExperimentRepetitionResponse[]
  completedAt: IsoDateTime
}
```

Las tasas usan el intervalo `[0,1]`. Un valor no observable se representa con `null`, nunca con cero. La moneda y metodología de `estimatedCost` deben viajar en la configuración persistida del experimento; este campo no implica una divisa universal.

El contrato HTTP queda definido. `DEC-EXP-002` queda `APROBADO` (herramientas, límites y paridad del agente generalista definidos en `spec/features/008-experimental-comparison/spec.md`); implementar HU19 ya no está bloqueado por decisión, solo pendiente de código. `BASELINE` no es un valor válido.

### 6.6 Progreso en tiempo real (WebSockets)

`HU21`/`HU22`: complemento del endpoint de estado por polling (6.2), nunca un reemplazo — sigue siendo el fallback funcional si la conexión WebSocket no está disponible. Los eventos `subscribe:test-run`/`unsubscribe:test-run`/`test-run:update` quedan retirados junto con la generación manual (§6.3); vuelven, rediseñados sobre `AnalysisRun`, cuando exista un equivalente PR-driven.

```ts
// Eventos cliente -> servidor (namespace Socket.IO por defecto, mismo host que la API HTTP)
interface SubscribeProjectVersionEvent { projectVersionId: Id } // evento 'subscribe:project-version'
interface UnsubscribeProjectVersionEvent { projectVersionId: Id } // evento 'unsubscribe:project-version'

// Eventos servidor -> cliente
// 'project-version:update', payload: ProjectVersionResponse (mismo shape que GET /project-versions/{id})
```

Reglas:

- El servidor emite `project-version:update` únicamente a los clientes suscritos a ese id específico (sin broadcast global); una conexión puede suscribirse a varios ids.
- El payload es exactamente `ProjectVersionResponse` ya definido en 6.2: no se introduce un DTO paralelo para WebSocket.
- Una desconexión limpia todas las suscripciones de esa conexión sin acción adicional del servidor.
- No se emite ningún dato ausente de los DTOs HTTP equivalentes (sin prompts, embeddings ni keys de Storage).
- El handshake WebSocket incluye el mismo access token de usuario; Core valida identidad antes de aceptar una suscripción y comprueba propiedad del `Project` antes de unir el socket a una sala. HTTP continúa como fallback.

### 6.7 Trazas de contexto

- `GET /experiments/{experimentId}/context-traces?strategy&repetition&includeSuperseded&cursor&limit` → `200 Page<ContextTraceSummaryResponse>` para HU27/HU28. `strategy` y `repetition` filtran las seis repeticiones; sin filtros devuelve todas las trazas vigentes. (El endpoint equivalente sobre `test-runs`, HU27, quedó retirado junto con la generación manual — §6.3; no está implementado en código.)
- `GET /context-traces/{traceId}` → `200 ContextTraceDetailResponse`.
- `GET /context-traces/{traceId}/discovered-files?step&cursor&limit` → `200 Page<DiscoveredFileResponse>`; solo aplica a un paso `list_files` de una traza `AGENT`.

```ts
type ContextTraceKind = 'RAG' | 'AGENT'
type ContextTraceStrategy = 'RAG' | 'GENERALIST_AGENT'

interface ContextTraceSummaryResponse {
  id: Id
  kind: ContextTraceKind
  projectVersionId: Id
  targetId: Id
  testRunId: Id | null
  experimentId: Id | null
  strategy: ContextTraceStrategy
  repetition: 1 | 2 | 3 | null
  attempt: number // empieza en 1; retry crea otro intento
  current: boolean
  artifactIds: Id[]
  createdAt: IsoDateTime
}

interface SourceLineResponse {
  lineNumber: number
  content: string
}

interface SourceExcerptResponse {
  filePath: RelativePath
  symbolName: string | null
  parentSymbolName: string | null
  startLine: number | null
  endLine: number | null
  snippet: string
  before: SourceLineResponse[] // máximo tres líneas
  after: SourceLineResponse[] // máximo tres líneas
  contentSha256: Sha256
  truncated: boolean
}

type RagMatchedVia = 'SEMANTIC' | 'IMPORTS' | 'IMPORTED_BY'
type RagCandidateDecision = 'SELECTED' | 'DISCARDED'
type RagDiscardReason = 'BELOW_MINIMUM_SCORE' | 'TOP_K_LIMIT' | 'TOKEN_BUDGET'

interface RagTargetNodeResponse {
  chunkIds: Id[]
  excerpt: SourceExcerptResponse
  tokenCount: number
}

interface RagCandidateNodeResponse {
  chunkId: Id
  rank: number
  excerpt: SourceExcerptResponse
  tokenCount: number
  semanticScore: number | null
  structuralMatch: 'IMPORTS' | 'IMPORTED_BY' | null
  combinedScore: number
  matchedVia: RagMatchedVia[]
  decision: RagCandidateDecision
  discardReason: RagDiscardReason | null
}

interface RagContextTraceDetailResponse extends ContextTraceSummaryResponse {
  kind: 'RAG'
  target: RagTargetNodeResponse
  candidates: RagCandidateNodeResponse[]
  retrievedChunks: number
  selectedChunks: number
  contextTokens: number
  configuration: {
    minimumScore: number
    topK: number
    maxContextTokens: number
    semanticWeight: number
    structuralWeight: number
  }
}

type AgentToolName = 'list_files' | 'search_text' | 'inspect_symbol' | 'read_file'
type AgentStepStatus = 'SUCCEEDED' | 'EMPTY' | 'FAILED'
type AgentObservationKind = 'FILE_LIST_SUMMARY' | 'TEXT_MATCH' | 'SYMBOL' | 'FILE_CONTENT'

interface AgentObservationResponse {
  kind: AgentObservationKind
  filePath: RelativePath | null
  symbolName: string | null
  excerpt: SourceExcerptResponse | null
  discoveredFilesCount: number | null
}

interface AgentTrajectoryStepResponse {
  step: number
  toolName: AgentToolName
  arguments: Record<string, unknown>
  status: AgentStepStatus
  resultSummary: string
  resultSha256: Sha256
  truncated: boolean
  observations: AgentObservationResponse[]
}

interface AgentContextTraceDetailResponse extends ContextTraceSummaryResponse {
  kind: 'AGENT'
  trajectory: AgentTrajectoryStepResponse[]
  toolCalls: number
  filesInspected: number
}

interface DiscoveredFileResponse {
  filePath: RelativePath
}

type ContextTraceDetailResponse =
  | RagContextTraceDetailResponse
  | AgentContextTraceDetailResponse
```

Reglas:

- Una traza se vincula a una `ProjectVersion` inmutable. Los hashes, rangos y snippets son evidencia; las líneas circundantes pueden reconstruirse desde el snapshot congelado.
- `RAG` conserva candidatos seleccionados y descartados. `discardReason` es `null` únicamente cuando `decision=SELECTED`; un score no se presenta como probabilidad.
- `AGENT` conserva la secuencia observable de tool calls. No usa `SELECTED`/`DISCARDED`, no expone mensajes internos del modelo y no afirma qué contenido influyó en su respuesta.
- `list_files` devuelve un nodo resumen; sus rutas completas se consultan paginadas. Un resultado vacío o un error permanece como paso atenuable mediante `status`.
- El detalle de una traza o un listado de archivos antes del estado terminal de su run/experimento devuelve `409 CONTEXT_TRACE_NOT_FINISHED`. Un id inexistente o no autorizado devuelve `404 CONTEXT_TRACE_NOT_FOUND`.

### 6.8 GitHub App y repository binding

- `POST /projects/{projectId}/integrations/github/installations` -> `201 GitHubInstallationSessionResponse`.
- `POST /projects/{projectId}/integrations/github/callback` -> `200 ProjectRepositoryBindingResponse`.
- `GET /projects/{projectId}/integrations/github` -> `200 ProjectRepositoryBindingResponse`.
- `DELETE /projects/{projectId}/integrations/github` -> `204`.

```ts
interface GitHubInstallationSessionResponse {
  projectId: Id
  installationUrl: string
  stateExpiresAt: IsoDateTime
}

interface CompleteGitHubInstallationRequest {
  installationId: string
  repositoryId: string
  state: string
  integrationBranch?: string // default develop
}

interface ProjectRepositoryBindingResponse {
  projectId: Id
  installationId: string
  repositoryId: string
  repositoryName: string
  integrationBranch: string
  status: 'ENABLED' | 'DISABLED' | 'REVOKED'
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
```

`state` es opaco, de un solo uso, expira y debe vincular inequívocamente usuario, Project e intento de instalación. Core valida que la instalación autoriza el repository id antes de persistir. Desconectar deja de aceptar eventos nuevos, no borra Runs ni Functional Knowledge.

### 6.9 Webhooks GitHub y normalización PR

- `POST /integrations/github/webhooks` -> `202 GitHubWebhookAcceptedResponse` o `200` para una entrega ya procesada.

GitHub envía `x-github-delivery`, `x-github-event` y `x-hub-signature-256`. Core verifica la firma sobre el body crudo antes de parsear o persistir. Solo instalaciones y bindings `ENABLED` producen trabajo.

```ts
type PullRequestAction =
  | 'opened'
  | 'reopened'
  | 'ready_for_review'
  | 'synchronize'
  | 'closed'
  | 'edited'
  | 'converted_to_draft'

interface GitHubWebhookAcceptedResponse {
  deliveryId: string
  accepted: boolean
  duplicate: boolean
  analysisRunId: Id | null
}
```

La identidad durable combina delivery id, repository id, PR number, head SHA, event y action. `opened|reopened|ready_for_review|synchronize` crean o actualizan lifecycle solo cuando el PR está ready y `baseRef == integrationBranch`. `synchronize`, incluido force-push, obsoleta el Run del HEAD previo y crea el del HEAD nuevo. `closed|edited|converted_to_draft` no crean análisis ciego; actualizan vigencia y cancelación/obsolescencia. Un resultado tardío de un Run no vigente no publica Check actual.

### 6.10 Analysis Runs

- `GET /projects/{projectId}/analysis-runs?status&cursor&limit` -> `200 Page<AnalysisRunSummaryResponse>`.
- `GET /analysis-runs/{analysisRunId}` -> `200 AnalysisRunDetailResponse`.

```ts
type AnalysisRunStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'ACTION_REQUIRED'
  | 'SUCCESS'
  | 'BEHAVIORAL_MISMATCH'
  | 'TECHNICAL_GENERATION_FAILURE'
  | 'INFRASTRUCTURE_FAILURE'
  | 'BASELINE_FAILED'
  | 'NO_ADDITIONAL_TESTS_REQUIRED'
  | 'NO_TEST_RELEVANT_CHANGES'
  | 'OBSOLETE'

interface PullRequestRefResponse {
  repositoryId: string
  repositoryName: string
  number: number
  title: string
  baseRef: string
  headRef: string
  baseSha: string
  headSha: string
  draft: boolean
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  actorLogin: string | null
}

interface AnalysisRunSummaryResponse {
  id: Id
  projectId: Id
  pullRequest: PullRequestRefResponse
  status: AnalysisRunStatus
  current: boolean
  actionRequiredCount: number
  generatedTestsCount: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  completedAt: IsoDateTime | null
}

type SymbolChangeKind = 'DIRECTLY_CHANGED' | 'POTENTIALLY_IMPACTED'

interface AnalysisSymbolResponse {
  language: 'TYPESCRIPT' | 'PHP'
  kind: 'CLASS' | 'METHOD' | 'FUNCTION' | 'INTERFACE' | 'TYPE' | 'TRAIT' | 'ENUM'
  qualifiedName: string
  filePath: RelativePath
  changeKind: SymbolChangeKind
}

interface AnalysisRunDetailResponse extends AnalysisRunSummaryResponse {
  attemptCount: number
  indexMode: 'BOOTSTRAP' | 'INCREMENTAL'
  changesetBaseSha: string
  changesetHeadSha: string
  indexDeltaBaseSha: string | null
  symbols: AnalysisSymbolResponse[]
  functionalBehaviorValidated: boolean
  resultSummary: string | null
  detailsUrl: string
}
```

Un Run corresponde a un PR/HEAD; un Job/Attempt no. Una continuación por respuesta humana incrementa attempts sobre el mismo Run si el SHA no cambia. Un HEAD nuevo crea otro Run y marca el anterior `OBSOLETE` aunque estuviera `PROCESSING` o `ACTION_REQUIRED`.

### 6.11 Action Required y Functional Knowledge

- `GET /action-required?projectId&cursor&limit` -> `200 Page<FunctionalQuestionResponse>`.
- `GET /analysis-runs/{analysisRunId}/context-questions` -> `200 FunctionalQuestionSetResponse`.
- `POST /analysis-runs/{analysisRunId}/context-questions/{questionId}/answers` -> `202 FunctionalAnswerAcceptedResponse`.
- `GET /projects/{projectId}/functional-knowledge?status&cursor&limit` -> `200 Page<FunctionalKnowledgeResponse>`.

```ts
type FunctionalScope = 'PROJECT' | 'MODULE' | 'CLASS' | 'METHOD' | 'SYMBOL'
type FunctionalQuestionStatus = 'PENDING' | 'ANSWERED' | 'OBSOLETE'
type FunctionalAnswerChoice = 'YES' | 'NO' | 'DEPENDS' | 'UNKNOWN' | 'FREE_TEXT'

interface VisualAidResponse {
  kind: 'STATE_DIAGRAM' | 'SYMBOL_RELATION' | 'MINI_DIFF' | 'CODE_FRAGMENT'
  title: string
  content: string
  language: string | null
}

interface FunctionalQuestionResponse {
  id: Id
  analysisRunId: Id
  projectId: Id
  repositoryName: string
  pullRequestNumber: number
  headSha: string
  target: AnalysisSymbolResponse
  question: string
  rationale: string
  status: FunctionalQuestionStatus
  visualAid: VisualAidResponse | null
  createdAt: IsoDateTime
}

interface FunctionalQuestionSetResponse {
  analysisRunId: Id
  currentQuestion: FunctionalQuestionResponse | null
  functionalBehaviorValidated: boolean
}

interface SubmitFunctionalAnswerRequest {
  choice: FunctionalAnswerChoice
  answer: string | null
}

interface FunctionalAnswerAcceptedResponse extends AsyncAccepted {
  analysisRunId: Id
  questionId: Id
  continuationAttemptId: Id | null
  knowledgeId: Id | null
}

interface FunctionalKnowledgeResponse {
  id: Id
  projectId: Id
  scope: FunctionalScope
  targetRef: string | null
  originalQuestion: string
  originalAnswer: string
  normalizedRule: string
  source: 'HUMAN_ANSWER' | 'APPROVED_IMPORT'
  status: 'ACTIVE' | 'SUPERSEDED'
  supersedesId: Id | null
  createdAt: IsoDateTime
}
```

`UNKNOWN` puede cerrar una pregunta pero devuelve `knowledgeId=null` y nunca crea conocimiento autoritativo. Si el HEAD cambió, la pregunta queda `OBSOLETE`, no se reanuda el Run viejo y cualquier regla potencial se reevalúa contra el Run actual. La siguiente pregunta es adaptativa y reemplaza visualmente a la anterior; no se expone un total fijo.

### 6.12 Checks, propuestas y companion PR

- `GET /analysis-runs/{analysisRunId}/test-proposals` -> `200 GeneratedTestProposalSetResponse`.
- `POST /analysis-runs/{analysisRunId}/test-publications` -> `202 TestPublicationAcceptedResponse`.
- `GET /test-publications/{publicationId}` -> `200 TestPublicationResponse`.

```ts
interface GeneratedTestProposalResponse {
  id: Id
  relativePath: RelativePath
  target: AnalysisSymbolResponse
  contentSha256: Sha256
  status: 'AVAILABLE' | 'HELD' | 'STALE' | 'PUBLISHED'
}

interface GeneratedTestProposalSetResponse {
  analysisRunId: Id
  headSha: string
  items: GeneratedTestProposalResponse[]
}

interface CreateTestPublicationRequest {
  proposalIds: Id[]
}

interface TestPublicationAcceptedResponse extends AsyncAccepted {
  publicationId: Id
  analysisRunId: Id
}

interface TestPublicationResponse {
  id: Id
  analysisRunId: Id
  sourceHeadSha: string
  status: 'PENDING' | 'PUBLISHING' | 'PUBLISHED' | 'STALE' | 'FAILED' | 'CLOSED'
  branchName: string | null
  companionPullRequestNumber: number | null
  companionPullRequestUrl: string | null
  failureMessage: string | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
```

La solicitud exige Run `SUCCESS`, proposals `AVAILABLE`, usuario autorizado y HEAD vigente. Core vuelve a comprobar freshness al ejecutar el job. Publica desde el HEAD validado a una rama `rag-tests/pr-<number>-<short-sha>` y abre companion PR hacia la feature branch original; no auto-mergea ni reabre un companion PR cerrado. `BEHAVIORAL_MISMATCH` conserva propuestas `HELD`. La conclusión del GitHub Check pertenece al `headSha` del Run y su `details_url` apunta a `/projects/{projectId}/runs/{analysisRunId}`; la merge policy pertenece al repositorio.

## 7. Contrato RAG Core ↔ Test Execution Sandbox

La integración es HTTP interna y asíncrona. RAG Core es el único consumidor.

### 7.1 Entradas mediante URL firmada temporal

```ts
type ExecutionInputRole = 'PROJECT_SNAPSHOT' | 'GENERATED_ARTIFACT'
type ExecutionProfile = 'NODE_TYPESCRIPT' | 'PHP_LARAVEL_PHPUNIT'
type TestRunner = 'JEST' | 'VITEST' | 'PHPUNIT'

interface EphemeralDownloadRef {
  role: ExecutionInputRole
  url: string // URL HTTPS firmada; capacidad temporal y sensible
  expiresAt: IsoDateTime
  sha256: Sha256
  sizeBytes: number
}
```

- RAG Core conserva bucket y `objectKey`, genera la URL mediante su `ObjectStorageService` y no persiste la URL firmada como dato de dominio.
- La vigencia es corta y configurable, suficiente para iniciar la adquisición de la entrada; `expiresAt` permite rechazar una capacidad expirada sin intentar ejecutar.
- El Sandbox acepta únicamente HTTPS y hosts permitidos por configuración; no acepta URLs arbitrarias suministradas por usuarios.
- El proceso host del Sandbox descarga inmediatamente, verifica `sha256` y `sizeBytes`, descarta la URL y solo entonces materializa el archivo en el workspace.
- La URL no se entrega al container, no se devuelve en responses, no se registra completa y no forma parte de errores persistidos.
- El Sandbox no necesita SDK, bucket, key ni credenciales de Supabase para consumir esta referencia.

### 7.2 Crear ejecución

- `POST /executions` → `202 SandboxExecutionAcceptedResponse`.

```ts
interface ExecutionArtifactInput {
  artifactId: Id
  relativePath: RelativePath
  artifactType: ArtifactType
  download: EphemeralDownloadRef // role GENERATED_ARTIFACT
}

interface CreateSandboxExecutionRequest {
  requestId: Id // igual a Idempotency-Key
  testRunId: Id
  projectVersionId: Id
  snapshot: EphemeralDownloadRef // role PROJECT_SNAPSHOT
  artifacts: ExecutionArtifactInput[]
  scope: 'TARGET' | 'BATCH'
  targetIds: Id[]
  executionProfile: ExecutionProfile
  runnerHint: TestRunner
  phase: 'BASELINE' | 'GENERATED_TESTS'
}

interface SandboxExecutionAcceptedResponse extends AsyncAccepted {
  executionId: Id
  requestId: Id
  projectVersionId: Id
}
```

Reglas:

- No se aceptan comandos arbitrarios, scripts de shell, variables secretas, credenciales, prompts, campos de estrategia ni URLs fuera de `EphemeralDownloadRef`.
- `snapshot.role` debe ser `PROJECT_SNAPSHOT`; los artefactos deben usar `GENERATED_ARTIFACT`.
- Para idempotencia se comparan IDs, roles, rutas, hashes y tamaños; la firma o nueva expiración de una URL no cambia por sí sola la identidad lógica del request.
- `TARGET` requiere uno o más `targetIds`; `BATCH` aplica el conjunto final de artefactos del run actual.
- `executionProfile` y `runnerHint` se verifican contra el snapshot. Una incompatibilidad termina como `CONFIGURATION`, no habilita ejecutar comandos suministrados por Core.
- `NODE_TYPESCRIPT` exige `pnpm-lock.yaml`, instala con pnpm y lockfile congelado, y admite Jest/Vitest. npm, Yarn o ausencia de lockfile producen `UNSUPPORTED_PACKAGE_MANAGER`.
- `PHP_LARAVEL_PHPUNIT` exige `composer.json`, usa `composer.lock` cuando existe, materializa dependencias con Composer y ejecuta PHPUnit en un container PHP/Laravel-compatible. Las versiones concretas son política del profile, no comandos suministrados por Core.
- `phase=BASELINE` ejecuta únicamente tests relevantes ya existentes; `GENERATED_TESTS` incorpora los artefactos autorizados. Sandbox reporta hechos equivalentes en ambos casos y Core decide `BASELINE_FAILED` u otra clasificación.
- Los límites de CPU, memoria, output y tiempo son configuración/política del Sandbox, no parámetros controlables por el request.

### 7.3 Consultar ejecución y resultado

- `GET /executions/{executionId}` → `200 SandboxExecutionStatusResponse`.
- `GET /executions/{executionId}/result` → `200 SandboxExecutionResultResponse` cuando termina.

```ts
type SandboxStage =
  | 'PREPARING' | 'INSTALLING_DEPENDENCIES' | 'COMPILING'
  | 'RUNNING_TESTS' | 'FINALIZING'

type SandboxExecutionStatus =
  | 'PENDING' | SandboxStage | 'COMPLETED' | 'FAILED' | 'TIMED_OUT'

interface SandboxExecutionStatusResponse {
  executionId: Id
  requestId: Id
  projectVersionId: Id
  status: SandboxExecutionStatus
  stage: SandboxStage | null
  failureCode: string | null
  failureMessage: string | null
  startedAt: IsoDateTime | null
  completedAt: IsoDateTime | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

interface TestCaseFact {
  suitePath: RelativePath | null
  name: string
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'TODO'
  durationMs: number | null
  errorMessage: string | null
}

interface RunnerFacts {
  executionProfile: ExecutionProfile
  runner: TestRunner
  compiled: boolean
  executed: boolean
  passed: boolean
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  testCases: TestCaseFact[]
  testCasesTruncated: boolean
}

interface StageDuration {
  stage: SandboxStage
  durationMs: number
}

interface SandboxFailureFact {
  stage: SandboxStage
  category: 'COMPILATION' | 'TEST_ASSERTION' | 'TEST_RUNTIME' | 'DEPENDENCY' | 'CONFIGURATION' | 'INFRASTRUCTURE' | 'UNKNOWN'
  code: string
  message: string
}

type ExecutionEvidenceKind =
  | 'COMPILER_STDOUT' | 'COMPILER_STDERR'
  | 'TEST_STDOUT' | 'TEST_STDERR' | 'RUNNER_REPORT'

interface ExecutionEvidenceFact {
  kind: ExecutionEvidenceKind
  stage: SandboxStage
  content: string
  truncated: boolean
  originalBytes: number | null
}

interface SandboxExecutionResultResponse {
  executionId: Id
  requestId: Id
  testRunId: Id
  projectVersionId: Id
  status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT'
  facts: RunnerFacts | null
  failure: SandboxFailureFact | null
  stageDurations: StageDuration[]
  appliedArtifactIds: Id[]
  evidence: ExecutionEvidenceFact[]
  startedAt: IsoDateTime
  completedAt: IsoDateTime
}
```

El Sandbox devuelve hechos y evidencia acotada. No devuelve `valid`, una estrategia experimental ni una conclusión sobre calidad; RAG Core realiza esa normalización y persiste el resultado final en PostgreSQL. La evidencia que exceda el límite no autoriza acceso directo del Sandbox a Storage: se trunca de forma explícita o se entrega a Core mediante un mecanismo futuro aprobado.

### 7.4 Errores propios de la integración

- `EXECUTION_NOT_FOUND` → 404.
- `EXECUTION_NOT_FINISHED` → 409.
- `IDEMPOTENCY_CONFLICT` → 409.
- `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_KEY_MISMATCH` → 400.
- `UNSUPPORTED_PROJECT`, `UNSUPPORTED_RUNNER`, `UNSUPPORTED_PACKAGE_MANAGER` → 422 antes de aceptar cuando puedan detectarse; después del `202` se persisten como resultado `FAILED`/`CONFIGURATION`.
- `INPUT_URL_EXPIRED`, `INPUT_DOWNLOAD_FAILED`, `INTEGRITY_CHECK_FAILED`, `INVALID_ARCHIVE`, `INVALID_ARTIFACT_PATH` → resultado fallido si ocurren después del `202`.
- Un fallo de Storage al generar la URL ocurre en RAG Core antes de invocar al Sandbox y se normaliza allí; `SANDBOX_UNAVAILABLE` → 503 si el Sandbox no permite aceptar o consultar la operación.

### 7.5 Health del Sandbox

- `GET /health/live`: proceso activo; no bloquea en dependencias remotas.
- `GET /health/ready`: confirma que puede aceptar ejecuciones y distingue indisponibilidad de Docker, conectividad de adquisición y capacidad interna, sin consultar Supabase mediante credenciales.
- Estos endpoints no ejecutan código del proyecto ni revelan secretos o configuración sensible.

## 8. Disponibilidad al aprobar INTEROP-2.0

- Las rutas manuales de generación/ZIP de la sección 6 (6.3, 6.4) quedan retiradas; ya no existen como camino de compatibilidad. 6.2 (lectura de `ProjectVersion`) y 6.5 (Experimento) permanecen vigentes según lo descrito en cada sección.
- Las operaciones 6.8-6.12 son contrato aprobado para implementar. GitHub App, repository binding, AnalysisRun, Action Required, Checks y companion PR todavía no están disponibles en Core.
- Developer Console conserva superficies legacy/mock de SDD 1.16, que quedan superseded; debe migrar sus mocks y adapters al contrato 2.0 antes de tratarlos como demo vigente.
- Test Execution Sandbox implementa actualmente el equivalente de `NODE_TYPESCRIPT` con Jest/Vitest. `PHP_LARAVEL_PHPUNIT`, `phase` y la evidencia ampliada quedan aprobados pero pendientes de implementación.
- La integración Core↔Sandbox actual continúa operativa bajo el subconjunto compatible de 1.6; la adopción completa de los campos 2.0 exige migración coordinada y contract tests en ambos backends.
- `DEC-GH-001`, `DEC-INT-001`, `DEC-AUTH-001`, `DEC-IDEMP-001`, `DEC-WEB-AUTH-001`, `DEC-EXP-002`, `DEC-CHUNK-001` y `DEC-EMB-001` están `APROBADO`.
- `DEC-MET-001`, `DEC-INF-001`, `DEC-VAL-001` y `DEC-EXP-FK-001` permanecen `PENDING` con los blocks acotados por `SYSTEM-2.0`.

## 9. Reglas de implementación

- Organizar controllers, DTOs, servicios y adapters por feature en ambos backends.
- Validar todos los requests y serializar respuestas mediante DTOs explícitos.
- Centralizar correlación y `ErrorEnvelope` en interceptors/filtros; no formatear errores manualmente en cada controller.
- Usar tokens de inyección para `ObjectStorageService` en Core, el downloader HTTP del Sandbox, clientes HTTP y demás puertos reemplazables.
- No compartir paquetes de código entre repositorios como fuente oculta de verdad: cada implementación deriva de `INTEROP-2.0` y se verifica mediante contract tests/fixtures versionados.
- Todo cambio de contrato debe actualizar primero el documento canónico, después sus dos espejos y finalmente los adapters/tests afectados.
