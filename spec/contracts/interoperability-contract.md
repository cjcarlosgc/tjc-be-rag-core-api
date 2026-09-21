# Contrato universal de interoperabilidad

**Versión:** INTEROP-2.4
**Compatible con:** SYSTEM-2.4
**Fecha de corte:** 2026-09-20
**Estado:** APROBADO salvo decisiones externas referenciadas explícitamente
**Propietario canónico:** `tjc-be-rag-core-api/spec/contracts/interoperability-contract.md`

Este documento define el vocabulario y los contratos HTTP compartidos por Developer Console, RAG Core y Test Execution Sandbox. Los tres repositorios conservan una copia espejo byte por byte. Una spec local puede detallar su implementación, pero no cambiar rutas, DTOs, estados o semántica de este contrato.

## 1. Compatibilidad y autoridad

- Las rutas manuales de carga ZIP y generación por modos (`METHOD|CLASS|PROJECT`) anteriores a SDD 2.0 quedan retiradas; no existe compatibilidad legacy paralela. El único disparador de análisis es PR-driven (`AnalysisRun`).
- `INTEROP-2.4` es la versión documental vigente. Hereda de `INTEROP-2.1` el lifecycle PR/HEAD, los estados de AnalysisRun y los perfiles PHP, de `INTEROP-2.2` el discovery OAuth user-centric y la autorización GitHub-App-centric del repository binding (§6.8), y de `INTEROP-2.3` `DELETE /projects/{projectId}` (§6.1), `POST /projects/{projectId}/integrations/github/enable` y `REPOSITORY_ALREADY_BOUND` (§6.8; HU56/HU57, implementados en Core). **`breaking: false`** a nivel de cable: agrega `GET /workspaces` y `PATCH /projects/{projectId}`, `workspaceId` opcional en `POST /projects`, `GET /projects` y `GET /integrations/github/repositories`, `workspace` y `role` en `ProjectResponse`, ocho códigos de error nuevos (§6.13), la matriz rol -> operación (§6.13) y el manejo de los eventos `member`, `membership`, `organization`, `team` y `repository` (§6.9); ninguna ruta, DTO o código existente cambia de forma incompatible y los consumidores ya ignoran campos de respuesta desconocidos. Tienen efecto de comportamiento sin cambiar el cable: el retiro del login con correo y contraseña (solo GitHub; es configuración de Supabase y de la Console, precondición de despliegue de `DEC-ORG-001`) y que las validaciones de acceso y de binding rechacen peticiones antes aceptadas (p. ej. vincular un repositorio ajeno). Cambio de HU58-HU64 por `DEC-ORG-001`: **Definido, pendiente de implementación.** Lo marcado `[PROPOSED DEC-ORG-002.n]` es recomendación no aprobada.
- 2026-09-15: se define contrato (sin implementar) para 4 capacidades formalizadas como historia en `spec/backlog.md` (HU48-HU55, registradas originalmente por Console) que estaban bloqueadas por falta de contrato: `CreateExperimentRequest` reapunta a `AnalysisRun`/símbolo (§6.5, HU48), historial de transiciones de `AnalysisRun` (§6.10, HU53), listado de Analysis Runs cross-proyecto (§6.10, HU55) y detección de conflicto de Functional Knowledge (§6.11, HU51). Cada bloque queda marcado **Definido, pendiente de implementación**.
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
- `Authorization: Bearer <user-access-token>` es obligatorio en todos los endpoints navegador→Core salvo `GET /health`. Es un JWT de sesión emitido por Supabase Auth para HU29; RAG Core valida firma, issuer, audience y expiración mediante el mecanismo compatible con las signing keys del proyecto. El token identifica a la persona (`sub`) y nunca se reenvía al Sandbox. Toda sesión debe tener identidad GitHub (HU62, `DEC-ORG-001`): Core resuelve el `githubUserId` numérico con la Admin API de Supabase (§6.13, "Identidad"); un token válido sin identidad GitHub devuelve `401 GITHUB_IDENTITY_REQUIRED`.
- `X-GitHub-Provider-Token` es obligatorio solo para `GET /integrations/github/repositories`. Contiene el provider token OAuth GitHub de la sesión Supabase y sirve exclusivamente para discovery user-centric; nunca se persiste, registra, devuelve, reenvía al Sandbox ni se usa para automatización GitHub App.
- La ausencia de credencial de usuario devuelve `401 AUTH_REQUIRED`; un token inválido o expirado devuelve `401 INVALID_ACCESS_TOKEN`. Las consultas a un recurso no visible para el usuario (de un Project que no ve, inexistente o borrado) responden `404` con el código del recurso (`PROJECT_NOT_FOUND`, `TEST_RUN_NOT_FOUND`, etc.) para no revelar su existencia; un recurso visible cuyo rol del usuario no alcanza para la operación responde `403 PROJECT_ROLE_INSUFFICIENT` (§6.13).

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
- `401/403`: credencial ausente/inválida o acceso no permitido. Un recurso no visible es `404`; uno visible con rol insuficiente es `403`.
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
- `POST /projects` → `201 ProjectResponse` (HU63: elige workspace; solo Admin en una organización).
- `GET /projects/{projectId}` → `200 ProjectResponse`.
- `GET /projects?workspaceId&cursor&limit` → `200 Page<ProjectResponse>` (HU58/HU59: Projects visibles, opcionalmente de un workspace).
- `PATCH /projects/{projectId}` → `200 ProjectResponse` (HU63, solo Admin).
- `DELETE /projects/{projectId}` → `204` (HU56; solo Admin, HU63).

```ts
interface HealthResponse {
  status: 'ok'
  timestamp: IsoDateTime
}

interface CreateProjectRequest {
  name: string // trim, 1..200
  workspaceId?: string // WorkspaceResponse.id; omitido o igual al id del workspace personal = personal
}

interface UpdateProjectRequest {
  name: string // trim, 1..200; único campo modificable
}

interface ProjectResponse {
  id: Id
  name: string
  currentVersionId: Id | null
  workspace: WorkspaceRefResponse // §6.13
  role: ProjectRole // rol del usuario autenticado en este Project, §6.13
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
```

`POST /projects` sin `workspaceId` (o con el id del workspace personal) crea un Project personal; el creador es Admin. Con el id de una organización exige que Core verifique en vivo que el usuario es owner activo de esa organización (§6.13): un `workspaceId` que no es un workspace del usuario responde `404 WORKSPACE_NOT_FOUND`, uno de organización donde el usuario es miembro pero no owner `403 WORKSPACE_ADMIN_REQUIRED`, y si GitHub no responde `503 GITHUB_VERIFICATION_UNAVAILABLE` (no se concede lo nuevo). El workspace del Project se fija al crearlo (`githubOrgId`/`login` de la organización, o personal) y no cambia. Un Project nace sin repositorio y solo lo ven sus Admin hasta que se vincula uno (§6.13).

`GET /projects` sin `workspaceId` devuelve todos los Projects visibles para el usuario, cada uno con su `workspace`; con `workspaceId` devuelve solo los de ese workspace (`404 WORKSPACE_NOT_FOUND` si no es un workspace del usuario). `[PROPOSED DEC-ORG-002.2]` el listado sin filtro incluye los Projects personales de otras personas a los que el usuario ya tiene acceso registrado.

`PATCH /projects/{projectId}` renombra (mismas reglas de `name` que la creación; campos no declarados se rechazan con `400`). No cambia workspace, repositorio ni binding. Un Project no visible responde `404 PROJECT_NOT_FOUND`; visible sin rol Admin, `403 PROJECT_ROLE_INSUFFICIENT`.

`DELETE /projects/{projectId}` es un borrado lógico sin endpoint de restauración y solo lo hace un Admin: un Project inexistente, no visible o ya borrado responde `404 PROJECT_NOT_FOUND` (no se distingue entre los tres) y uno visible con rol menor `403 PROJECT_ROLE_INSUFFICIENT`. En una única transacción Core lo marca borrado, elimina su `RepositoryBinding` (libera el `repositoryId` para otro Project) y cancela u obsoleta sus `AnalysisRun` y jobs en curso. Runs, versiones y Functional Knowledge se conservan como evidencia pero dejan de ser visibles: desde ese momento `GET /projects`, `GET /projects/{projectId}`, el binding, los Runs (incluido `GET /analysis-runs`), Functional Knowledge, preguntas, publicaciones, versiones, targets y experimentos de ese Project se comportan como inexistentes (`404 PROJECT_NOT_FOUND` en rutas con `projectId`; ausentes de los listados). Los jobs no procesan ni publican Runs de un Project borrado, ni de uno cuyo binding pertenezca a otro Project.

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
- `GET /analysis-runs/{analysisRunId}/experiments?cursor&limit` → `200 Page<ExperimentStatusResponse>` (HU48, "Run comparison": punto de entrada desde el Run Detail para listar/lanzar comparaciones sobre ese Run).

El experimento `RAG` vs `GENERALIST_AGENT` (HU19) se conserva. `CreateExperimentRequest` reapunta la unidad experimental a un `AnalysisRun` (HU48): ya no referencia un `TestTarget` (id interno, propio de la indexación ZIP retirada — §6.2) sino un símbolo del changeset, identificado igual que en `AnalysisSymbolResponse` (§6.10). Core resuelve internamente el `TestTarget` correspondiente sobre el `ProjectVersion` del Run (`AnalysisRun.projectVersionId`); ese mapeo es un detalle de implementación, no de contrato. El símbolo debe existir entre los `DIRECTLY_CHANGED` de ese Run y ser `METHOD` o `FUNCTION`; si no existe responde `404 ANALYSIS_SYMBOL_NOT_FOUND`, si existe pero no es `METHOD`/`FUNCTION` responde `422 UNSUPPORTED_SYMBOL_KIND`. **Definido, pendiente de implementación** — el DTO anterior (`projectId`/`targetId`) queda retirado con este cambio; no hay consumidor real hoy.

```ts
type FailureType =
  | 'NONE' | 'COMPILATION' | 'TEST_ASSERTION' | 'TEST_RUNTIME'
  | 'DEPENDENCY' | 'CONFIGURATION' | 'INFRASTRUCTURE' | 'UNKNOWN'

interface CreateExperimentRequest {
  analysisRunId: Id
  symbolFilePath: RelativePath
  symbolQualifiedName: string
  repetitions?: number // default y único valor V1 aprobado: 3
}

interface ExperimentAcceptedResponse extends AsyncAccepted {
  analysisRunId: Id
  experimentId: Id
  projectVersionId: Id
}

type ExperimentStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
type ExperimentStrategy = 'RAG' | 'GENERALIST_AGENT'

interface ExperimentStatusResponse {
  id: Id
  analysisRunId: Id
  projectId: Id
  projectVersionId: Id
  symbol: AnalysisSymbolResponse
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
  analysisRunId: Id
  projectVersionId: Id
  symbol: AnalysisSymbolResponse
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
- El handshake WebSocket incluye el mismo access token de usuario; Core valida identidad antes de aceptar una suscripción y comprueba que el usuario tenga al menos rol Reader sobre el `Project` antes de unir el socket a una sala; cuando el usuario pierde el acceso (§6.9), Core saca sus sockets de las salas de ese Project y deja de emitirle eventos. HTTP continúa como fallback.

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

Repository discovery is user-centric; repository automation is GitHub-App-centric.

- `GET /integrations/github/repositories?workspaceId&cursor&limit` -> `200 Page<GitHubUserRepositoryResponse>`; exige `Authorization` y `X-GitHub-Provider-Token` (HU64: `workspaceId` filtra por workspace).
- `POST /integrations/github/repositories/verify-app-access` -> `200 GitHubAppAccessResponse`.
- `GET /integrations/github/repositories/{owner}/{repo}/branches` -> `200 GitHubRepositoryBranchesResponse`.
- `POST /projects/{projectId}/integrations/github` -> `201 ProjectRepositoryBindingResponse`.
- `GET /projects/{projectId}/integrations/github` -> `200 ProjectRepositoryBindingResponse`.
- `POST /projects/{projectId}/integrations/github/enable` -> `200 ProjectRepositoryBindingResponse` (HU57).
- `DELETE /projects/{projectId}/integrations/github` -> `204`.

```ts
interface GitHubUserRepositoryResponse {
  repositoryId: string
  name: string
  repositoryName: string // owner/name
  owner: { login: string; type: 'User' | 'Organization'; avatarUrl: string | null }
  private: boolean
  defaultBranch: string
  permissions: { admin: boolean; maintain: boolean; push: boolean; pull: boolean }
}

type GitHubAppAccessStatus = 'AUTHORIZED' | 'NOT_AUTHORIZED'

interface VerifyGitHubAppAccessRequest {
  repositoryId: string
  repositoryName: string
}

interface GitHubAppAccessResponse {
  repositoryId: string
  repositoryName: string
  status: GitHubAppAccessStatus
  installationId: string | null
  app: { displayName: string; configureUrl: string }
}

interface GitHubRepositoryBranchResponse { name: string; protected: boolean }
interface GitHubRepositoryBranchesResponse { items: GitHubRepositoryBranchResponse[] }

interface CreateRepositoryBindingRequest {
  repositoryId: string
  repositoryName: string
  integrationBranch: string
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

`workspaceId` (el `id` de un `WorkspaceResponse`, §6.13) limita la lista a los repositorios del workspace: con el id de una organización, solo repositorios cuyo propietario es esa organización; con el id del workspace personal, solo los que pertenecen a la cuenta del usuario. Un `workspaceId` que no es un workspace del usuario responde `404 WORKSPACE_NOT_FOUND`. Sin `workspaceId` la lista no se filtra (compatibilidad); la Console lo envía con `Project.workspace.id` al vincular, y la validación autoritativa ocurre siempre en `POST .../integrations/github`. Se ofrecen también repositorios donde el usuario solo tiene `read`/`triage` (`permissions` lo indica); vincularlos se rechaza en el `POST`.

Core valida `repositoryId` y `repositoryName` contra GitHub antes de persistir (`POST .../integrations/github`). `verify-app-access` devuelve `repositoryId` y `repositoryName` tal como se enviaron; la validación autoritativa del id ocurre en `POST .../integrations/github`. `installationId` es evidencia resuelta por Core: no se acepta desde el navegador y es `null` cuando el resultado es `NOT_AUTHORIZED`. Las ramas se consultan con el installation access token, por lo que un repositorio sin acceso devuelve `403 GITHUB_APP_ACCESS_REQUIRED`. La creación exige que `integrationBranch` exista; no hay default. `NOT_AUTHORIZED` no es un error HTTP. Desconectar (`DELETE .../integrations/github`) deja el binding `DISABLED`: es una pausa reversible que conserva la fila y su `repositoryId`, deja de aceptar eventos nuevos y no borra Runs ni Functional Knowledge. Sobre un binding `REVOKED` responde `204` sin cambiar el estado (nunca lo degrada a `DISABLED`); sobre uno ya `DISABLED`, `204`. `installation.suspend` solo pausa bindings `ENABLED`; no altera `REVOKED` ni `DISABLED`.

Reglas de `POST .../integrations/github` (HU57, HU64), en este orden de validación: `404 PROJECT_NOT_FOUND` (Project no visible), `403 PROJECT_ROLE_INSUFFICIENT` (rol menor que Maintainer), `409 REPOSITORY_BINDING_ALREADY_EXISTS` (el Project ya tiene binding), `403 GITHUB_APP_ACCESS_REQUIRED`, `404 GITHUB_REPOSITORY_NOT_FOUND`, `400 REPOSITORY_OUTSIDE_WORKSPACE`, `403 REPOSITORY_PERMISSION_INSUFFICIENT`, `409 REPOSITORY_ALREADY_BOUND`, `404 INTEGRATION_BRANCH_NOT_FOUND`. Core resuelve el `repositoryId` real contra GitHub y no confía en el enviado por el cliente. Si GitHub no encuentra el repositorio, o su `repositoryId` real no coincide con el enviado para `repositoryName`, responde `404 GITHUB_REPOSITORY_NOT_FOUND` sin persistir. Esta validación ocurre después de comprobar el acceso de la App y antes de comprobar si otro Project ya usa el repositorio. Un usuario sin ningún permiso sobre el repositorio (ni siquiera `read`) recibe el mismo `404 GITHUB_REPOSITORY_NOT_FOUND` que uno inexistente. `REPOSITORY_OUTSIDE_WORKSPACE`: el propietario real del repositorio (id de GitHub resuelto por Core) no es la organización del Project o, en un Project personal, no es la cuenta de su creador; en una organización solo se aceptan repositorios de esa organización. `REPOSITORY_PERMISSION_INSUFFICIENT`: el permiso efectivo del usuario sobre el repositorio, leído con el installation token (`role_name`; un rol personalizado se mapea por su permiso base), es `read` o `triage` y no `maintain`, `write` o `admin`, porque la GitHub App publica con permisos de escritura. Ambas validaciones ocurren antes de comprobar `REPOSITORY_ALREADY_BOUND`, de modo que un usuario no puede sondear qué repositorios ajenos están vinculados. Si GitHub no responde al verificar, `503 GITHUB_VERIFICATION_UNAVAILABLE` y no se persiste nada. Un Project tiene un solo repositorio y no se revincula: no existe ruta para cambiarlo, `DELETE .../integrations/github` solo pausa y un `POST` posterior responde `409 REPOSITORY_BINDING_ALREADY_EXISTS`; para usar otro repositorio se elimina el Project y se crea otro. Como un Project sin repositorio solo lo ven sus Admin (§6.13), el primer vínculo lo hace un Admin. `REPOSITORY_ALREADY_BOUND` significa que otro Project ya usa ese repositorio; su mensaje es genérico y no revela el Project ni el usuario ajeno. Una violación de unicidad concurrente se traduce al `409` correspondiente, nunca a `500`.

Reglas de `POST .../integrations/github/enable` (HU57): pasa `DISABLED` a `ENABLED` y es idempotente (un binding ya `ENABLED` responde `200` con el mismo cuerpo, sin revalidar). Antes de reactivar Core revalida el acceso de la App (installation resuelta por Core) y refresca `installationId`; sin acceso responde `403 GITHUB_APP_ACCESS_REQUIRED` y el estado no cambia. Un binding `REVOKED` también se reactiva por esta ruta si la revalidación confirma que la App recuperó acceso al repositorio (así un Project sale de `REVOKED` sin borrarse); si no hay acceso, `403 GITHUB_APP_ACCESS_REQUIRED` y sigue `REVOKED`. Sin Project propio (inexistente, ajeno o borrado): `404 PROJECT_NOT_FOUND`; sin binding: `404 REPOSITORY_BINDING_NOT_FOUND`.

`GET .../integrations/github` exige rol Reader; `POST .../integrations/github`, `POST .../enable` y `DELETE .../integrations/github` exigen Maintainer (que incluye a Admin), y `enable` sobre un binding `REVOKED` sigue la regla de visibilidad de §6.13. `[PROPOSED DEC-ORG-002.4]` `POST /integrations/github/repositories/verify-app-access` y `GET /integrations/github/repositories/{owner}/{repo}/branches`, que no reciben un Project, exigen que el usuario tenga permiso `maintain`, `write` o `admin` sobre el repositorio consultado: con permiso menor responden `403 REPOSITORY_PERMISSION_INSUFFICIENT` y sin ninguna visibilidad `branches` responde `404 GITHUB_REPOSITORY_NOT_FOUND` y `verify-app-access` `NOT_AUTHORIZED`, de modo que no revelan la instalación ni las ramas de repositorios ajenos.

El renombre de un repositorio actualiza `repositoryName` del binding; su transferencia fuera del workspace del Project o su eliminación pasa el binding a `REVOKED` sin borrar evidencia (§6.9).

Errores de dominio: `GITHUB_ACCOUNT_REQUIRED` (401), `GITHUB_USER_TOKEN_INVALID` (401), `GITHUB_APP_ACCESS_REQUIRED` (403), `GITHUB_REPOSITORY_NOT_FOUND` (404), `INTEGRATION_BRANCH_NOT_FOUND` (404), `REPOSITORY_BINDING_ALREADY_EXISTS` (409), `REPOSITORY_ALREADY_BOUND` (409) y `REPOSITORY_BINDING_NOT_FOUND` (404); desde `INTEROP-2.4` también `REPOSITORY_OUTSIDE_WORKSPACE` (400), `REPOSITORY_PERMISSION_INSUFFICIENT` (403), `PROJECT_ROLE_INSUFFICIENT` (403), `WORKSPACE_NOT_FOUND` (404) y `GITHUB_VERIFICATION_UNAVAILABLE` (503), definidos en §6.13. No se exponen mensajes crudos de GitHub.

### 6.9 Webhooks GitHub y normalización PR

- `POST /integrations/github/webhooks` -> `202 GitHubWebhookAcceptedResponse` o `200` para una entrega ya procesada.

GitHub envía `x-github-delivery`, `x-github-event` y `x-hub-signature-256`. Core verifica la firma sobre el body crudo antes de parsear o persistir. Solo instalaciones y bindings `ENABLED` producen trabajo de análisis; los eventos de acceso de "Eventos de acceso" (abajo) se procesan aunque el binding no esté `ENABLED`, porque mantienen los registros de acceso de todo Project vivo.

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

#### Eventos de acceso (`DEC-ORG-001`, HU61)

La GitHub App se suscribe además a `member`, `membership`, `organization`, `team` y `repository` (`installation` e `installation_repositories` llegan siempre). Van al mismo ingress, con la misma firma y respuesta (`202 GitHubWebhookAcceptedResponse`, `analysisRunId: null`); el ingress no espera a GitHub: encola la verificación en la cola de jobs existente y responde. **Definido, pendiente de implementación.**

Regla de confianza: el payload solo selecciona qué pares (usuario, Project) reverificar; el rol resultante siempre sale de una verificación viva con el installation token de la App (§6.13), nunca del payload, porque un evento puede llegar duplicado, tarde o fuera de orden. Reverificar es idempotente: confirma y actualiza `role`/`verifiedAt`, borra el registro si GitHub confirma que se perdió el acceso o lo conserva si no puede verificar.

| Evento (`action`) | Efecto |
|---|---|
| `member` (`added`, `edited`, `removed`) | Reverifica al usuario `member.id` sobre los Projects vinculados a `repository.id`. |
| `membership` (`added`, `removed`) | Cambio de miembro de un Team: reverifica al usuario `member.id` sobre todos los Projects con repositorio de `organization.id` (los repositorios del Team no vienen en el payload). |
| `organization` (`member_removed`) | Reverifica al usuario `membership.user.id` sobre todos los Projects de `organization.id` (borra sus registros, incluido Admin, si ya no es miembro activo). |
| `organization` (`renamed`) | Actualiza el `login` de la organización en los Projects de `organization.id`. |
| `organization` (`deleted`) | Pasa a `REVOKED` los bindings de sus Projects y borra sus registros de acceso; los Projects se conservan ocultos. |
| `team` (`added_to_repository`, `removed_from_repository`, `edited`, `deleted`) | Reverifica los registros de los Projects vinculados a `repository.id` si viene en el payload; si no, de todos los Projects con repositorio de `organization.id`. Un cambio del permiso de un Team no está garantizado como evento. |
| `repository` (`renamed`) | Actualiza `repositoryName` del binding. |
| `repository` (`transferred`) | Si el nuevo propietario no es la organización (o cuenta) del Project: binding `REVOKED` y borrado de los registros Maintainer y Reader; si lo es, solo actualiza el nombre. |
| `repository` (`deleted`) | Binding `REVOKED`; se borran los registros Maintainer y Reader. |
| `repository` (`privatized`) | Reverifica todos los registros de los Projects vinculados a `repository.id` (el `read` implícito de un repositorio público deja de existir). |
| `installation` (`deleted`) y `installation_repositories` (`removed`) | Además de lo ya definido para el binding, borran los registros de acceso Maintainer y Reader de los Projects afectados; si se desinstala la App de una organización, también los de Admin (la organización deja de poder verificarse y sus Projects quedan ocultos hasta reinstalar). |
| `installation` (`suspend`) | No borra registros: una instalación suspendida no puede verificar y se trata como GitHub no disponible (se conserva lo existente, no se concede lo nuevo). |

Sin evento fiable (ventana de hasta una hora, solo la reconciliación los corrige): cambio de rol en la organización, cambio del permiso base de la organización y accesos heredados que cambian sin evento directo. Los demás valores de `action` y los eventos no listados se ignoran (`202`).

**Reconciliación horaria.** Un job periódico, cada hora, sobre la cola `jobs` existente, recorre los Projects vivos con registros de acceso y, con el installation token: (a) comprueba que la organización sea resoluble, que la App siga instalada y que tenga al menos un owner activo; si no, sus Projects quedan ocultos (bindings `REVOKED` y registros de acceso borrados) y reaparecen, con binding `REVOKED` hasta que un usuario lo reactive (`POST .../enable`), cuando la App se reinstala o la organización vuelve, porque el acceso se vuelve a crear al entrar (§6.13); (b) recalcula cada registro con las mismas reglas que el alta, borra los que GitHub confirma perdidos y conserva los no verificables. Ante una caída de GitHub (error de red, `5xx`, límite de tasa, instalación suspendida o falta de `Members: read` en la organización) la reconciliación no revoca nada ni concede nada nuevo, y el siguiente ciclo se programa igualmente. No se agrega una caché de permisos.

### 6.10 Analysis Runs

- `GET /projects/{projectId}/analysis-runs?status&cursor&limit` -> `200 Page<AnalysisRunSummaryResponse>`.
- `GET /analysis-runs?status&cursor&limit` -> `200 Page<AnalysisRunSummaryResponse>` (HU55, sin `projectId`: Runs de todos los Projects visibles para el usuario autenticado (cualquier rol), mismo shape — no es una vista global sin dueño; solo cubre Projects donde el usuario ya tiene acceso registrado). **Definido, pendiente de implementación.**
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

type AnalysisRunTransitionReason =
  | 'RUN_CREATED'
  | 'SNAPSHOT_PROCESSING_STARTED'
  | 'FUNCTIONAL_CONTEXT_REQUIRED'
  | 'FUNCTIONAL_ANSWER_CONTINUATION'
  | 'GENERATION_COMPLETED'
  | 'GITHUB_HEAD_SUPERSEDED'
  | 'PULL_REQUEST_CLOSED'
  | 'MANUAL_OBSOLETE'

interface AnalysisRunTransitionResponse {
  fromStatus: AnalysisRunStatus | null // null solo en la creación inicial
  toStatus: AnalysisRunStatus
  reason: AnalysisRunTransitionReason
  occurredAt: IsoDateTime
}

interface AnalysisRunDetailResponse extends AnalysisRunSummaryResponse {
  attemptCount: number
  indexMode: 'BOOTSTRAP' | 'INCREMENTAL'
  changesetBaseSha: string
  changesetHeadSha: string
  indexDeltaBaseSha: string | null
  symbols: AnalysisSymbolResponse[]
  history: AnalysisRunTransitionResponse[]
  functionalBehaviorValidated: boolean
  resultSummary: string | null
  detailsUrl: string
}
```

Un Run corresponde a un PR/HEAD; un Job/Attempt no. Una continuación por respuesta humana incrementa attempts sobre el mismo Run si el SHA no cambia. Un HEAD nuevo crea otro Run y marca el anterior `OBSOLETE` aunque estuviera `PROCESSING` o `ACTION_REQUIRED`.

`history` (HU53) es append-only y ordenado cronológicamente ascendente, incluida la creación inicial (`fromStatus: null`, `toStatus: 'QUEUED'`, `reason: 'RUN_CREATED'`); complementa los timestamps de `AnalysisRunSummaryResponse`, no los reemplaza. **Definido, pendiente de implementación.**

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
  conflictResolution?: {
    conflictId: Id
    action: 'SUPERSEDE' | 'KEEP_EXISTING'
  }
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

interface FunctionalKnowledgeConflictResponse {
  conflictId: Id
  analysisRunId: Id
  questionId: Id
  conflictingKnowledge: FunctionalKnowledgeResponse
  proposedNormalizedRule: string
}
```

**HU51, implementado (2026-09-18).** Antes de persistir la regla que produciría una respuesta, Core evalúa si ya existe una `FunctionalKnowledge` `ACTIVE` para el mismo scope+símbolo exacto (match exacto por ahora; jerarquía PROJECT⊃MODULE⊃CLASS y contradicción semántica vía LLM quedan pendientes, ver `harness/state.json`). Si detecta una regla existente y la request no trae `conflictResolution`, responde `409 FUNCTIONAL_KNOWLEDGE_CONFLICT` con `details: FunctionalKnowledgeConflictResponse` (§4) y no persiste ni avanza el Run — Focus Mode muestra la regla existente junto a la propuesta para que el usuario decida antes de contaminar el conocimiento. Un reenvío con `conflictResolution.action: 'SUPERSEDE'` persiste la nueva regla `ACTIVE` y pasa la existente a `SUPERSEDED` (`supersedesId` la referencia); `'KEEP_EXISTING'` registra la respuesta como evidencia de la pregunta (`knowledgeId: null`) sin tocar la regla vigente. `conflictId` reutiliza el `questionId` (de un solo uso, expira si el HEAD cambia igual que una pregunta `OBSOLETE`).

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

**§6.12 implementado por completo (2026-09-18, HU39/HU40).** `GET .../test-proposals` (corte Validation), Checks nativos por HEAD (HU39, `checks/`) y `POST .../test-publications`/`GET /test-publications/{id}` (HU40, `publications/`) ya están construidos. `GeneratedTestProposal.status` usa `AVAILABLE`/`HELD`/`PUBLISHED`; `STALE` está reservado en el enum pero todavía no se activa automáticamente para propuestas (solo la `TestPublication` misma queda `STALE` cuando el freshness check al ejecutar el job de publicación detecta que el HEAD real del PR ya no coincide con `sourceHeadSha` — no hay un barrido que marque `STALE` cualquier propuesta `AVAILABLE` cuando llega un HEAD nuevo). `HELD` cubre tanto `BEHAVIORAL_MISMATCH` como `TECHNICAL_GENERATION_FAILURE` sin distinguirlos en el campo `status` (sí en `AnalysisRun.status` y en `failureSummary`, campo interno no expuesto por este endpoint). El companion PR nunca reabre uno cerrado (`findPullRequestByHead` detecta el estado y la publicación termina `FAILED` en ese caso) y reutiliza un PR abierto existente si el job se reintenta sobre la misma rama. Errores de dominio de HU40 (no estaban listados explícitamente en el contrato, se definieron al implementar): `TEST_PUBLICATION_NOT_FOUND` (404), `TEST_PUBLICATION_INVALID_RUN_STATUS` (409, Run no `SUCCESS` o no vigente), `TEST_PUBLICATION_PROPOSAL_NOT_AVAILABLE` (422, algún `proposalId` no existe para ese Run o no está `AVAILABLE`).

### 6.13 Workspaces, roles y acceso

Fuente: `DEC-ORG-001` (HU58-HU64). GitHub es la fuente de verdad de la autorización; este contrato no repite las decisiones de producto, define su superficie HTTP. **Definido, pendiente de implementación.**

- `GET /workspaces` -> `200 WorkspaceListResponse` (HU58).

```ts
type WorkspaceKind = 'PERSONAL' | 'ORGANIZATION'
type WorkspaceRole = 'ADMIN' | 'MEMBER'
type ProjectRole = 'ADMIN' | 'MAINTAINER' | 'READER'

interface WorkspaceRefResponse {
  kind: WorkspaceKind
  id: string // id numérico de GitHub de la cuenta u organización, como texto
  login: string | null // null solo en un workspace personal cuyo login Core aún no conoce
}

interface WorkspaceResponse extends WorkspaceRefResponse {
  avatarUrl: string | null
  role: WorkspaceRole // ADMIN: cuenta personal siempre, u owner activo de la organización
}

interface WorkspaceListResponse {
  items: WorkspaceResponse[] // sin paginar: el usuario pertenece a pocas organizaciones
}

interface ProjectRoleInsufficientDetails {
  requiredRole: ProjectRole
  currentRole: ProjectRole
}
```

**Workspaces.** `GET /workspaces` devuelve la cuenta personal del usuario (siempre, primero) y cada organización donde la GitHub App está instalada y el usuario es miembro activo, ordenadas por `login`. Core la obtiene listando las instalaciones de la App y verificando la membresía con el token de la App; no usa el token OAuth del usuario ni el scope `read:org`. Una organización aparece cuando alguien instala la App en ella; una organización cuya instalación no tiene aceptado `Members: read` no se ofrece. Los Teams de GitHub no son workspace. `WorkspaceRefResponse.id` es lo que se envía como `workspaceId` en las demás rutas. Si GitHub no responde, la lista se compone de la cuenta personal y de las organizaciones de los Projects donde el usuario ya tiene acceso registrado (`role: ADMIN` si tiene algún registro Admin en ella, si no `MEMBER`); no se ofrecen organizaciones nuevas.

**Identidad.** Core resuelve `PlatformUser -> githubUserId` una vez y persiste el vínculo. El `githubUserId` es el `id` numérico de la entrada `provider: 'github'` de `identities[]` que devuelve la Admin API de Supabase `GET /auth/v1/admin/users/{sub}` (con la credencial de servicio de Core, nunca expuesta al navegador); nunca se toma de `user_metadata`, que el propio usuario puede editar, y no se usa el listado `GET /auth/v1/admin/users`, que devuelve `identities: null`. El `login` de GitHub es un dato opcional de presentación y nunca autoriza. Un token válido sin identidad GitHub responde `401 GITHUB_IDENTITY_REQUIRED` y, si la Admin API no responde y el vínculo aún no está persistido, `503 IDENTITY_UNAVAILABLE`.

**Visibilidad y rol.** Un usuario ve un Project si Core verificó que tiene un rol sobre él; el rol es el más alto que aplique, con jerarquía Admin ⊃ Maintainer ⊃ Reader:

- **Admin:** en una organización, owner activo de la organización (`GET /orgs/{org}/memberships/{login}` con `role: admin` y `state: active`, permiso `Members: read` de la App); en el workspace personal, quien creó el Project. Un Admin además es Maintainer y Reader. Un Project sin repositorio vinculado solo lo ven los Admin: todos los owners de la organización, o el creador en personal.
- **Maintainer:** permiso `maintain`, `write` o `admin` sobre el repositorio vinculado (`role_name` de `GET /repos/{owner}/{repo}/collaborators/{username}/permission`, con `Metadata: read`; un rol personalizado se mapea por su permiso base).
- **Reader:** permiso `triage` o `read` sobre el repositorio vinculado, también en el workspace personal.
- `[PROPOSED DEC-ORG-002.1]` el `read` implícito de un repositorio público no cuenta como acceso: en una organización se exige además ser miembro activo de ella y en el workspace personal ser colaborador directo del repositorio.
- `[PROPOSED DEC-ORG-002.3]` con el binding `REVOKED` no hay permiso de repositorio verificable: solo los Admin ven el Project (para reactivar el binding con `POST .../enable` o eliminarlo). Si la organización desaparece, se desinstala la App o queda sin owners, el Project queda oculto para todos y se conserva.

**Alta del acceso.** Nadie invita: el registro de acceso se crea al entrar, verificando en vivo. Toda petición que apunta a un Project (o a un recurso descendiente, incluido un deep link a un Run) sobre el que el usuario no tiene registro dispara esa verificación; `GET /projects` (sin filtro o con `workspaceId` de una organización) verifica también los Projects vivos del workspace que aún no tiene registrados. El listado cross-proyecto `GET /analysis-runs` y `GET /action-required` sin `projectId` solo cubren los Projects con registro ya existente. Un acceso concedido queda registrado como `(projectId, userId, rol, verifiedAt)`; `verifiedAt` es la última confirmación, no una caducidad: no hay TTL ni caché, el registro rige hasta que un evento (§6.9) o la reconciliación lo cambia.

**Caída de GitHub.** Si GitHub no puede consultarse (red, `5xx`, límite de tasa, instalación suspendida, `Members: read` sin aceptar) Core conserva los registros ya existentes y no concede accesos nuevos: los listados omiten los Projects aún no verificados sin fallar, y una petición directa a un Project cuyo acceso no puede verificarse responde `503 GITHUB_VERIFICATION_UNAVAILABLE`, para que el usuario reintente en lugar de creer que no existe.

**Errores nuevos** (todos con `ErrorEnvelope`, §4):

| Código | HTTP | Cuándo |
|---|---|---|
| `GITHUB_IDENTITY_REQUIRED` | 401 | Token válido sin identidad GitHub en Supabase. |
| `IDENTITY_UNAVAILABLE` | 503 | La Admin API de Supabase no responde y el vínculo no está persistido. |
| `WORKSPACE_NOT_FOUND` | 404 | `workspaceId` que no es un workspace del usuario (no existe, no es miembro o la App no está instalada). |
| `WORKSPACE_ADMIN_REQUIRED` | 403 | Crear un Project en una organización donde el usuario es miembro pero no owner. |
| `PROJECT_ROLE_INSUFFICIENT` | 403 | Project visible, rol menor al mínimo de la operación; `details: ProjectRoleInsufficientDetails`. |
| `REPOSITORY_OUTSIDE_WORKSPACE` | 400 | El repositorio no pertenece al workspace del Project (§6.8). |
| `REPOSITORY_PERMISSION_INSUFFICIENT` | 403 | El usuario tiene `read`/`triage`, no `maintain`/`write`/`admin`, sobre el repositorio (§6.8). |
| `GITHUB_VERIFICATION_UNAVAILABLE` | 503 | GitHub no permite verificar un acceso o permiso nuevo. |

Un recurso no visible conserva el `404` de su recurso (`PROJECT_NOT_FOUND`, etc.).

**Matriz rol -> operación.** El rol es el mínimo requerido sobre el Project del recurso; un rol mayor también satisface. Un Project no visible responde `404` antes de evaluar el rol.

| Rol mínimo | Operaciones |
|---|---|
| Sin rol de Project (solo sesión GitHub válida) | `GET /workspaces`; `GET /integrations/github/repositories` (con `workspaceId`: pertenencia al workspace); `POST /integrations/github/repositories/verify-app-access` y `GET /integrations/github/repositories/{owner}/{repo}/branches` (`[PROPOSED DEC-ORG-002.4]` exigen permiso `maintain`/`write`/`admin` sobre el repositorio); `POST /projects` (personal: cualquiera; organización: Admin de la organización). Sin sesión: `GET /health` y `POST /integrations/github/webhooks` (firma HMAC). |
| Reader | `GET /projects`, `GET /projects/{projectId}`; `GET /projects/{projectId}/versions`; `GET /project-versions/{id}`, `.../results`, `.../test-inventory`; `GET /projects/{projectId}/integrations/github`; `GET /projects/{projectId}/analysis-runs`, `GET /analysis-runs`, `GET /analysis-runs/{id}`; `GET /action-required`, `GET /analysis-runs/{id}/context-questions`, `GET /projects/{projectId}/functional-knowledge`; `GET /analysis-runs/{id}/test-proposals`, `GET /test-publications/{id}`; `GET /experiments/{id}`, `.../results`, `GET /analysis-runs/{id}/experiments`; `GET /experiments/{id}/context-traces`, `GET /context-traces/{id}`, `.../discovered-files`; suscripción WebSocket `subscribe:project-version`. |
| Maintainer | `POST /projects/{projectId}/integrations/github`, `POST .../enable`, `DELETE .../integrations/github` (pausa) (con la salvedad de que un Project sin repositorio lo ve solo un Admin); `POST /analysis-runs/{id}/context-questions/{questionId}/answers`; `POST /analysis-runs/{id}/test-publications`; `POST /experiments`. |
| Admin | `PATCH /projects/{projectId}`; `DELETE /projects/{projectId}`; `POST /projects` en una organización. |

Notas de la matriz: (1) no existe ruta que dispare una validación manual, que es PR-driven; leer sus resultados (`test-proposals`, Runs) es Reader, y si más adelante existiera un disparador manual sería Maintainer; (2) `GET /analysis-runs` y `GET /action-required` solo devuelven Runs y preguntas de Projects visibles; (3) el rol se exige al aceptar la petición: un job ya aceptado (p. ej. una publicación) no se reevalúa contra el rol del usuario porque la automatización la autoriza la GitHub App; (4) las rutas retiradas (§6.3, §6.4) no se clasifican.

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

## 8. Disponibilidad en INTEROP-2.2

- Las rutas manuales de generación/ZIP de la sección 6 (6.3, 6.4) quedan retiradas; ya no existen como camino de compatibilidad. 6.2 (lectura de `ProjectVersion`) y 6.5 (Experimento) permanecen vigentes según lo descrito en cada sección.
- Las operaciones 6.8-6.13 son contrato aprobado para implementar (salvo lo marcado `[PROPOSED DEC-ORG-002.n]`). Su disponibilidad efectiva se declara por componente en las features y tareas correspondientes; Core construye progresivamente las capacidades PR-driven.
- Developer Console conserva únicamente mocks alineados a INTEROP-2.2 y separados de live; no constituyen evidencia ni sustituyen endpoints de Core.
- Test Execution Sandbox implementa actualmente el equivalente de `NODE_TYPESCRIPT` con Jest/Vitest. `PHP_LARAVEL_PHPUNIT`, `phase` y la evidencia ampliada quedan aprobados pero pendientes de implementación.
- La integración Core↔Sandbox actual continúa operativa bajo el subconjunto compatible de 1.6; la adopción completa de los campos 2.0 exige migración coordinada y contract tests en ambos backends.
- `DEC-GH-001`, `DEC-INT-001`, `DEC-AUTH-001`, `DEC-IDEMP-001`, `DEC-WEB-AUTH-001`, `DEC-ORG-001`, `DEC-EXP-002`, `DEC-CHUNK-001` y `DEC-EMB-001` están `APROBADO`; `DEC-ORG-002` está `PROPOSED`.
- `DEC-MET-001`, `DEC-INF-001`, `DEC-VAL-001` y `DEC-EXP-FK-001` permanecen `PENDING` con los blocks acotados por `SYSTEM-2.2`.

## 9. Reglas de implementación

- Organizar controllers, DTOs, servicios y adapters por feature en ambos backends.
- Validar todos los requests y serializar respuestas mediante DTOs explícitos.
- Centralizar correlación y `ErrorEnvelope` en interceptors/filtros; no formatear errores manualmente en cada controller.
- Usar tokens de inyección para `ObjectStorageService` en Core, el downloader HTTP del Sandbox, clientes HTTP y demás puertos reemplazables.
- No compartir paquetes de código entre repositorios como fuente oculta de verdad: cada implementación deriva de `INTEROP-2.2` y se verifica mediante contract tests/fixtures versionados.
- Todo cambio de contrato debe actualizar primero el documento canónico, después sus dos espejos y finalmente los adapters/tests afectados.
