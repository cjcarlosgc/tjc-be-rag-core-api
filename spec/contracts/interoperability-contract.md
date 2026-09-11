# Contrato universal de interoperabilidad

**Versión:** INTEROP-1.6
**Compatible con:** SYSTEM-1.6
**Fecha de corte:** 2026-09-11
**Estado:** APROBADO salvo decisiones externas referenciadas explícitamente
**Propietario canónico:** `tjc-be-rag-core-api/spec/contracts/interoperability-contract.md`

Este documento define el vocabulario y los contratos HTTP compartidos por Developer Console, RAG Core y Test Execution Sandbox. Los tres repositorios conservan una copia espejo byte por byte. Una spec local puede detallar su implementación, pero no cambiar rutas, DTOs, estados o semántica de este contrato.

## 1. Compatibilidad y autoridad

- Las rutas Sprint 1 ya implementadas por RAG Core permanecen sin prefijo para no romper el frontend existente.
- `INTEROP-1.6` es la versión documental vigente. Todo cambio aditivo conserva la versión mayor; un cambio incompatible exige una nueva versión mayor y migración coordinada de consumidores.
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
- `Idempotency-Key`: UUID obligatorio en `POST /test-runs`, `POST /experiments`, `POST /test-runs/{runId}/targets/{targetId}/retry` y `POST /executions`. Su ausencia o formato inválido devuelve `400 IDEMPOTENCY_KEY_REQUIRED` o `400 INVALID_IDEMPOTENCY_KEY`. No se exige retroactivamente en `POST /projects/index`.
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

- `POST /projects/index`, multipart con `file` ZIP obligatorio y `projectId` o `name` según el flujo, → `202 IndexProjectAcceptedResponse`.
- `GET /project-versions/{projectVersionId}` → `200 ProjectVersionResponse`.
- `GET /project-versions/{projectVersionId}/results` → `200 ProjectVersionResultsResponse` solo al completar.
- `GET /project-versions/{projectVersionId}/test-inventory` → `200 TestInventoryResponse` solo al completar.
- `GET /projects/{projectId}/versions?cursor&limit` → `200 Page<ProjectVersionSummaryResponse>`.

```ts
type ProjectVersionStatus =
  | 'PENDING' | 'EXTRACTING' | 'ANALYZING' | 'CHUNKING'
  | 'EMBEDDING' | 'PERSISTING' | 'COMPLETED' | 'FAILED'

interface IndexProjectAcceptedResponse extends AsyncAccepted {
  projectId: Id
  projectVersionId: Id
}

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

### 6.3 Generación y validación

- `POST /test-runs` → `202 TestRunAcceptedResponse`.
- `GET /test-runs/{runId}` → `200 TestRunStatusResponse`.
- `GET /test-runs/{runId}/results` → `200 TestRunResultsResponse` en estado terminal.
- `GET /project-versions/{projectVersionId}/test-runs?cursor&limit` → `200 Page<TestRunSummaryResponse>` (HU20: historial de generaciones de una versión, orden `createdAt` descendente).
- `POST /test-runs/{runId}/targets/{targetId}/retry` → `202 TargetRetryAcceptedResponse` (HU24: reintento manual de un target `INVALID`/`FAILED`, desde cero, sin ningún mecanismo de corrección automática — ver `009-history-realtime-repair/spec.md`). El run debe estar en un estado terminal (`COMPLETED`/`PARTIAL`/`FAILED`); el target debe tener un resultado en estado `INVALID` o `FAILED`. Actualiza el `TargetRunResultResponse` existente en su lugar (no agrega una fila nueva) y reajusta `validTargets`/`invalidTargets`/`failedTargets`/`status` del run.

```ts
type GenerationMode =
  | 'TARGET' | 'CLASS_ALL' | 'CLASS_MISSING'
  | 'PROJECT_MISSING' | 'PROJECT_ALL'

interface CreateTestRunRequest {
  projectId: Id
  mode: GenerationMode
  targetId?: Id
}

// TARGET requiere targetId METHOD o FUNCTION.
// CLASS_ALL y CLASS_MISSING requieren targetId CLASS.
// PROJECT_MISSING y PROJECT_ALL prohíben targetId.

interface TestRunAcceptedResponse extends AsyncAccepted {
  runId: Id
  projectId: Id
  projectVersionId: Id // currentVersion capturada atómicamente
}

interface TargetRetryAcceptedResponse extends AsyncAccepted {
  testRunId: Id
  targetId: Id
}

type TestRunStatus =
  | 'PENDING' | 'RESOLVING_TARGETS' | 'PROCESSING_TARGETS'
  | 'BATCH_VALIDATING' | 'FINALIZING'
  | 'COMPLETED' | 'PARTIAL' | 'FAILED'

interface TestRunStatusResponse {
  id: Id
  projectId: Id
  projectVersionId: Id
  mode: GenerationMode
  status: TestRunStatus
  totalTargets: number | null
  processedTargets: number
  validTargets: number
  invalidTargets: number
  failedTargets: number
  reason: 'NO_MISSING_TARGETS' | null
  failureCode: string | null
  failureMessage: string | null
  startedAt: IsoDateTime | null
  completedAt: IsoDateTime | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

interface TestRunSummaryResponse {
  id: Id
  mode: GenerationMode
  status: TestRunStatus
  totalTargets: number | null
  validTargets: number
  invalidTargets: number
  failedTargets: number
  createdAt: IsoDateTime
  completedAt: IsoDateTime | null
}

type FailureType =
  | 'NONE' | 'COMPILATION' | 'TEST_ASSERTION' | 'TEST_RUNTIME'
  | 'DEPENDENCY' | 'CONFIGURATION' | 'INFRASTRUCTURE' | 'UNKNOWN'

interface ValidationResponse {
  compiled: boolean
  executed: boolean
  passed: boolean
  valid: boolean
  failureType: FailureType
  errorSummary: string | null
  evidenceIds: Id[]
}

interface TargetRunResultResponse {
  targetId: Id
  filePath: RelativePath
  symbolName: string
  methodName: string | null
  targetType: TestTargetType
  status: 'VALID' | 'INVALID' | 'FAILED' | 'SKIPPED'
  artifactIds: Id[]
  validation: ValidationResponse | null
}

interface TestRunResultsResponse {
  id: Id
  projectId: Id
  projectVersionId: Id
  mode: GenerationMode
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
  reason: 'NO_MISSING_TARGETS' | null
  totalTargets: number
  validTargets: number
  invalidTargets: number
  failedTargets: number
  targets: TargetRunResultResponse[]
  completedAt: IsoDateTime
}
```

`valid=false` es un resultado normal. RAG Core calcula `valid` y `failureType` a partir de los hechos devueltos por el Sandbox.

### 6.4 Artefactos

- `GET /test-runs/{runId}/artifacts` → `200 ArtifactListResponse`.
- `GET /artifacts/{artifactId}/diff` → `200 ArtifactDiffResponse`; un artefacto `CREATED` devuelve `409 DIFF_NOT_AVAILABLE`.
- `GET /artifacts/{artifactId}/download` → binario con `Content-Disposition` seguro.
- `GET /test-runs/{runId}/artifacts/download` → ZIP binario con rutas relativas seguras.

```ts
type ArtifactType = 'CREATED' | 'MODIFIED'

interface ArtifactResponse {
  id: Id
  runId: Id
  relativePath: RelativePath
  artifactType: ArtifactType
  valid: boolean
  targetIds: Id[] // targets del run materializados en este archivo
  createdAt: IsoDateTime
}

interface ArtifactListResponse {
  runId: Id
  items: ArtifactResponse[]
}

interface DiffLineResponse {
  type: 'CONTEXT' | 'ADDED' | 'REMOVED'
  oldLineNumber: number | null
  newLineNumber: number | null
  content: string
}

interface ArtifactDiffResponse {
  artifactId: Id
  relativePath: RelativePath
  lines: DiffLineResponse[]
}
```

`storageKey`, bucket, credenciales y URLs internas nunca aparecen en DTOs para el navegador.

### 6.5 Experimento

- `POST /experiments` → `202 ExperimentAcceptedResponse`.
- `GET /experiments/{experimentId}` → `200 ExperimentStatusResponse`.
- `GET /experiments/{experimentId}/results` → `200 ExperimentResultsResponse` al completar.

```ts
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

`HU21`/`HU22`: complemento de los endpoints de estado por polling (6.2/6.3), nunca un reemplazo — ambos siguen siendo el fallback funcional si la conexión WebSocket no está disponible.

```ts
// Eventos cliente -> servidor (namespace Socket.IO por defecto, mismo host que la API HTTP)
interface SubscribeProjectVersionEvent { projectVersionId: Id } // evento 'subscribe:project-version'
interface SubscribeTestRunEvent { testRunId: Id }               // evento 'subscribe:test-run'
interface UnsubscribeProjectVersionEvent { projectVersionId: Id } // evento 'unsubscribe:project-version'
interface UnsubscribeTestRunEvent { testRunId: Id }               // evento 'unsubscribe:test-run'

// Eventos servidor -> cliente
// 'project-version:update', payload: ProjectVersionResponse (mismo shape que GET /project-versions/{id})
// 'test-run:update', payload: TestRunStatusResponse (mismo shape que GET /test-runs/{id})
```

Reglas:

- El servidor emite `project-version:update`/`test-run:update` únicamente a los clientes suscritos a ese id específico (sin broadcast global); una conexión puede suscribirse a varios ids.
- Los payloads son exactamente `ProjectVersionResponse`/`TestRunStatusResponse` ya definidos en 6.2/6.3: no se introduce un DTO paralelo para WebSocket.
- Una desconexión limpia todas las suscripciones de esa conexión sin acción adicional del servidor.
- No se emite ningún dato ausente de los DTOs HTTP equivalentes (sin prompts, embeddings ni keys de Storage).
- El handshake WebSocket incluye el mismo access token de usuario; Core valida identidad antes de aceptar una suscripción y comprueba propiedad del `Project` antes de unir el socket a una sala. HTTP continúa como fallback.

### 6.7 Trazas de contexto

- `GET /test-runs/{runId}/context-traces?targetId&artifactId&includeSuperseded&cursor&limit` → `200 Page<ContextTraceSummaryResponse>` para HU27. `targetId` y `artifactId` son filtros opcionales mutuamente excluyentes. Sin filtros devuelve la traza vigente de cada target del run; `includeSuperseded=true` incorpora intentos anteriores conservados por retry.
- `GET /experiments/{experimentId}/context-traces?strategy&repetition&includeSuperseded&cursor&limit` → `200 Page<ContextTraceSummaryResponse>` para HU27/HU28. `strategy` y `repetition` filtran las seis repeticiones; sin filtros devuelve todas las trazas vigentes.
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

## 7. Contrato RAG Core ↔ Test Execution Sandbox

La integración es HTTP interna y asíncrona. RAG Core es el único consumidor.

### 7.1 Entradas mediante URL firmada temporal

```ts
type ExecutionInputRole = 'PROJECT_SNAPSHOT' | 'GENERATED_ARTIFACT'

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
  runnerHint: 'JEST' | 'VITEST'
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
- `runnerHint` se verifica contra el proyecto. Una incompatibilidad termina como `CONFIGURATION`, no habilita ejecutar comandos suministrados por Core.
- El snapshot debe contener `pnpm-lock.yaml`. V1 instala exclusivamente con pnpm y lockfile congelado; npm, Yarn o ausencia de lockfile producen `UNSUPPORTED_PACKAGE_MANAGER`.
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
  runner: 'JEST' | 'VITEST'
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

## 8. Disponibilidad al aprobar INTEROP-1.6

- RAG Core implementa las rutas HTTP/WebSocket descritas en la sección 6 hasta HU25. Ya aplica `Idempotency-Key` en los tres POST indicados (`IdempotencyRecord`/`IdempotencyService`) y ya actualizó su cliente Sandbox conforme a las secciones 3 y 7 (`Authorization: Bearer`, identidades hijas UUID v5 estables).
- Developer Console todavía debe completar sus adapters/vistas contra este contrato. Nunca envía `SANDBOX_SERVICE_TOKEN` ni llama directamente al Sandbox.
- Test Execution Sandbox implementa `/executions`, Bearer, deduplicación y pipeline aislado. Su decisión local `DEC-SBX-002` fija pnpm + `pnpm-lock.yaml` como única combinación V1 ejecutable.
- La integración Core↔Sandbox permanece pendiente de verificación real de extremo a extremo hasta que ambos servicios se desplieguen y se prueben juntos; esto ya no es deuda de implementación de Core, es validación de integración entre repositorios.
- `DEC-INT-001`, `DEC-AUTH-001`, `DEC-IDEMP-001`, `DEC-WEB-AUTH-001`, `DEC-EXP-002`, `DEC-CHUNK-001` y `DEC-EMB-001` están `APROBADO`.
- `DEC-GH-001` permanece `PENDING` y bloquea únicamente la integración futura con GitHub/PR; no autoriza rutas ni DTOs adicionales en esta versión.
- `DEC-MET-001` y `DEC-VAL-001` permanecen PENDING y no bloquean implementación ordinaria.

## 9. Reglas de implementación

- Organizar controllers, DTOs, servicios y adapters por feature en ambos backends.
- Validar todos los requests y serializar respuestas mediante DTOs explícitos.
- Centralizar correlación y `ErrorEnvelope` en interceptors/filtros; no formatear errores manualmente en cada controller.
- Usar tokens de inyección para `ObjectStorageService` en Core, el downloader HTTP del Sandbox, clientes HTTP y demás puertos reemplazables.
- No compartir paquetes de código entre repositorios como fuente oculta de verdad: cada implementación deriva de `INTEROP-1.6` y se verifica mediante contract tests/fixtures versionados.
- Todo cambio de contrato debe actualizar primero el documento canónico, después sus dos espejos y finalmente los adapters/tests afectados.
