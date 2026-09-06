# Contrato universal de interoperabilidad

**Versión:** INTEROP-1.1
**Compatible con:** SYSTEM-1.3
**Fecha de corte:** 2026-09-05
**Estado:** APROBADO salvo decisiones externas referenciadas explícitamente
**Propietario canónico:** `tjc-be-rag-core-api/spec/contracts/interoperability-contract.md`

Este documento define el vocabulario y los contratos HTTP compartidos por Developer Console, RAG Core y Test Execution Sandbox. Los tres repositorios conservan una copia espejo byte por byte. Una spec local puede detallar su implementación, pero no cambiar rutas, DTOs, estados o semántica de este contrato.

## 1. Compatibilidad y autoridad

- Las rutas Sprint 1 ya implementadas por RAG Core permanecen sin prefijo para no romper el frontend existente.
- `INTEROP-1.1` versiona el contrato documental. Todo cambio aditivo conserva la versión mayor; un cambio incompatible exige una nueva versión mayor y migración coordinada de consumidores.
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
- `Idempotency-Key`: obligatorio en `POST /test-runs`, `POST /experiments` y `POST /executions`; UUID estable por intento lógico. Repetir key y body devuelve la operación original. Repetir key con body distinto devuelve `409 IDEMPOTENCY_CONFLICT`. No se exige retroactivamente en `POST /projects/index`.
- `Authorization: Bearer <service-token>`: obligatorio entre Core y Sandbox. El token vive en configuración del host y nunca ingresa al container.
- Los endpoints de navegador no tienen todavía un contrato de autenticación aprobado. Antes de validación empresarial se aplica `DEC-VAL-001`.

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
- `UNSUPPORTED_PROJECT`, `UNSUPPORTED_RUNNER`, `UNSUPPORTED_PACKAGE_MANAGER` → 422 antes de aceptar cuando puedan detectarse; después del `202` se persisten como resultado `FAILED`/`CONFIGURATION`.
- `INPUT_URL_EXPIRED`, `INPUT_DOWNLOAD_FAILED`, `INTEGRITY_CHECK_FAILED`, `INVALID_ARCHIVE`, `INVALID_ARTIFACT_PATH` → resultado fallido si ocurren después del `202`.
- Un fallo de Storage al generar la URL ocurre en RAG Core antes de invocar al Sandbox y se normaliza allí; `SANDBOX_UNAVAILABLE` → 503 si el Sandbox no permite aceptar o consultar la operación.

### 7.5 Health del Sandbox

- `GET /health/live`: proceso activo; no bloquea en dependencias remotas.
- `GET /health/ready`: confirma que puede aceptar ejecuciones y distingue indisponibilidad de Docker, conectividad de adquisición y capacidad interna, sin consultar Supabase mediante credenciales.
- Estos endpoints no ejecutan código del proyecto ni revelan secretos o configuración sensible.

## 8. Disponibilidad al aprobar INTEROP-1.1

- Las operaciones Sprint 1 indicadas en 6.1 y 6.2 conservan su disponibilidad implementada actual; listado de proyectos y versiones quedan aprobados para implementar.
- Generación, validación, artefactos y transporte experimental quedan contractualmente aprobados, aunque su código todavía no exista.
- Core↔Sandbox deja de estar bloqueado por falta de contrato: `DEC-INT-001` queda resuelto por este documento.
- `DEC-EXP-002` queda `APROBADO`; HU19 ya no está bloqueada por decisión, solo pendiente de implementación.
- `DEC-CHUNK-001` y `DEC-EMB-001` quedan `APROBADO`; el contrato de retrieval definitivo ya no está sujeto a decisión, solo pendiente de implementación en `004-rag-retrieval-context`.
- `DEC-SBX-001` y `DEC-SBX-002` conservan sus alcances locales; este contrato no elige package managers.
- `DEC-MET-001` y `DEC-VAL-001` permanecen PENDING y no bloquean implementación ordinaria.

## 9. Reglas de implementación

- Organizar controllers, DTOs, servicios y adapters por feature en ambos backends.
- Validar todos los requests y serializar respuestas mediante DTOs explícitos.
- Centralizar correlación y `ErrorEnvelope` en interceptors/filtros; no formatear errores manualmente en cada controller.
- Usar tokens de inyección para `ObjectStorageService` en Core, el downloader HTTP del Sandbox, clientes HTTP y demás puertos reemplazables.
- No compartir paquetes de código entre repositorios como fuente oculta de verdad: cada implementación deriva de `INTEROP-1.1` y se verifica mediante contract tests/fixtures versionados.
- Todo cambio de contrato debe actualizar primero el documento canónico, después sus dos espejos y finalmente los adapters/tests afectados.
