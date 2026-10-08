# Contrato universal de interoperabilidad

**Versión:** INTEROP-2.7
**Compatible con:** SYSTEM-2.6
**Fecha de corte:** 2026-10-08
**Estado:** APROBADO salvo decisiones externas referenciadas explícitamente
**Propietario canónico:** `tjc-be-rag-core-api/spec/contracts/interoperability-contract.md`

Este documento define el contrato HTTP operativo entre Developer Console, RAG Core y Test Execution Sandbox. Core y Console conservan una copia espejo byte por byte; Sandbox mantiene la línea base anterior mientras otro desarrollador trabaja allí. `GH-INTEROP-1.2` especifica además la superficie autenticada Console→GitHub Integration y el callback privado Integration→Core. Las rutas actuales Core de discovery, verificación y ramas se mantienen durante la compatibilidad; no se retiran en este corte.

## 1. Compatibilidad y autoridad

- El único disparador de análisis productivo es un PR/HEAD vinculado a un `AnalysisRun`. El snapshot ZIP interno se transfiere a Docker/Sandbox y no constituye una entrada manual.
- `INTEROP-2.7` es la versión documental vigente (preparada en `WI-CORE-017`). Sobre la base de `INTEROP-2.6` agrega el rol Writer (§6.13), la abstención auditada de `UNKNOWN` y la procedencia y escenarios de Functional Knowledge (§6.11), las extensiones de OE5 (§6.5.1), la comparación de retrieval OE2 (§6.15) y el trace operativo con exportación de evidencia (§6.16). Todo lo agregado está definido pero pendiente de implementar y verificar según el WI indicado en cada sección; nada de ello se infiere implementado por el número de versión. Antes de `INTEROP-2.7` regía `INTEROP-2.6`, que mantiene las rutas Core→Console y Core↔Sandbox, agrega el límite directo de UI GitHub (§6.14) y declara el lenguaje de `ProjectVersion` y el framework PHPUNIT. La compatibilidad durante el cambio se valida antes de retirar rutas anteriores.
- Las capacidades de experimento sobre `AnalysisRun`, historial de transiciones, listado transversal de Runs y conflicto de Functional Knowledge se especifican en §6.5, §6.10 y §6.11. Cada sección indica por separado si está implementada o pendiente; no se infiere de una nota histórica.
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

- JSON UTF-8 y propiedades `camelCase`; las transferencias binarias internas de snapshots y contenido generado se rigen por referencias efímeras (§8), nunca por una carga manual de código desde la Console.
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
- En Core→Sandbox no se reutiliza directamente la key raíz cuando una operación produce varias ejecuciones. Core deriva un UUID v5 estable con el namespace URL estándar y un nombre canónico de la unidad lógica, por ejemplo `urn:tjc:sandbox-execution:v1:generation:{jobId}:{targetId}` o `urn:tjc:sandbox-execution:v1:experiment:{jobId}:{strategy}:{repetition}`. La key hija es también `requestId` y se reutiliza en cualquier retry de transporte.
- `Authorization: Bearer <service-token>` es obligatorio en todos los endpoints `/executions`. El valor es un secreto opaco precompartido de alta entropía, configurado como `SANDBOX_SERVICE_TOKEN` en Core y Sandbox; no es JWT, no usa proveedor de identidad y nunca ingresa al frontend, logs, PostgreSQL, Storage o container. Core lo exige cuando configura `SANDBOX_URL`; Sandbox lo exige al arrancar. Los endpoints `/health/live` y `/health/ready` no requieren este header.
- `Authorization: Bearer <user-access-token>` es obligatorio en todos los endpoints navegador→Core salvo `GET /health`. Es un JWT de sesión emitido por Supabase Auth para HU01/HU02; RAG Core valida firma, issuer, audience y expiración mediante el mecanismo compatible con las signing keys del proyecto. El token identifica a la persona (`sub`) y nunca se reenvía al Sandbox. Toda sesión debe tener identidad GitHub (HU01/HU02, `DEC-ORG-001`): Core resuelve el `githubUserId` numérico con la Admin API de Supabase (§6.13, "Identidad"); un token válido sin identidad GitHub devuelve `401 GITHUB_IDENTITY_REQUIRED`.
- `X-GitHub-Provider-Token` se exige para discovery: tanto en la ruta Core heredada `GET /integrations/github/repositories` como en la ruta directa Console→Integration. Para verificar un repositorio nuevo también se exige en la ruta directa de Integration. En la ruta Core heredada de discovery, Console lo envía a Core y Core lo reenvía temporalmente a GitHub Integration; en las rutas directas, Console lo envía solo a Integration. No se usa para bindings existentes ni para listar ramas. Nunca se persiste, registra, devuelve ni reenvía a Sandbox, y no se usa para automatización GitHub App.
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
- `POST /projects` → `201 ProjectResponse` (HU01: elige workspace; solo Admin en una organización).
- `GET /projects/{projectId}` → `200 ProjectResponse`.
- `GET /projects?workspaceId&cursor&limit` → `200 Page<ProjectResponse>` (HU01: Projects visibles, opcionalmente de un workspace).
- `PATCH /projects/{projectId}` → `200 ProjectResponse` (HU01, solo Admin).
- `DELETE /projects/{projectId}` → `204` (HU01; solo Admin, HU01).

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

`POST /projects` sin `workspaceId` (o con el id del workspace personal) crea un Project personal; el creador es su único usuario y su Admin. Con el id de una organización exige que Core verifique en vivo que el usuario es owner activo de esa organización (§6.13): un `workspaceId` que no es un workspace del usuario responde `404 WORKSPACE_NOT_FOUND`, uno de organización donde el usuario es miembro pero no owner `403 WORKSPACE_ADMIN_REQUIRED`, y si GitHub no responde `503 GITHUB_VERIFICATION_UNAVAILABLE` (no se concede lo nuevo). El workspace del Project se fija al crearlo (`githubOrgId`/`login` de la organización, o personal) y no cambia. Un Project nace sin repositorio y solo lo ven sus Admin hasta que se vincula uno (§6.13).

`GET /projects` sin `workspaceId` devuelve todos los Projects visibles para el usuario (los personales que creó y los de sus organizaciones), cada uno con su `workspace`; con `workspaceId` devuelve solo los de ese workspace (`404 WORKSPACE_NOT_FOUND` si no es un workspace del usuario). Nunca devuelve Projects personales de otra persona: los Projects personales no se comparten (`DEC-ORG-002`).

`PATCH /projects/{projectId}` renombra (mismas reglas de `name` que la creación; campos no declarados se rechazan con `400`). No cambia workspace, repositorio ni binding. Un Project no visible responde `404 PROJECT_NOT_FOUND`; visible sin rol Admin, `403 PROJECT_ROLE_INSUFFICIENT`.

`DELETE /projects/{projectId}` es un borrado lógico sin endpoint de restauración y solo lo hace un Admin: un Project inexistente, no visible o ya borrado responde `404 PROJECT_NOT_FOUND` (no se distingue entre los tres) y uno visible con rol menor `403 PROJECT_ROLE_INSUFFICIENT`. En una única transacción Core lo marca borrado, elimina su `RepositoryBinding` (libera el `repositoryId` para otro Project) y cancela u obsoleta sus `AnalysisRun` y jobs en curso. Runs, versiones y Functional Knowledge se conservan como evidencia pero dejan de ser visibles: desde ese momento `GET /projects`, `GET /projects/{projectId}`, el binding, los Runs (incluido `GET /analysis-runs`), Functional Knowledge, preguntas, publicaciones, versiones, targets y experimentos de ese Project se comportan como inexistentes (`404 PROJECT_NOT_FOUND` en rutas con `projectId`; ausentes de los listados). Los jobs no procesan ni publican Runs de un Project borrado, ni de uno cuyo binding pertenezca a otro Project.

### 6.2 ProjectVersion e indexación

Un `ProjectVersion` se deriva internamente del snapshot por commit SHA de un `AnalysisRun`. El ZIP se conserva para Docker/Sandbox, no para carga de código por el usuario. Las rutas de lectura siguientes se aplican a esa versión interna:

- `GET /project-versions/{projectVersionId}` → `200 ProjectVersionResponse`.
- `GET /project-versions/{projectVersionId}/results` → `200 ProjectVersionResultsResponse` solo al completar.
- `GET /project-versions/{projectVersionId}/test-inventory` → `200 TestInventoryResponse` solo al completar.
- `GET /projects/{projectId}/versions?cursor&limit` → `200 Page<ProjectVersionSummaryResponse>`.

```ts
type ProjectVersionStatus =
  | 'PENDING' | 'EXTRACTING' | 'ANALYZING' | 'CHUNKING'
  | 'EMBEDDING' | 'PERSISTING' | 'COMPLETED' | 'FAILED'

type ProjectLanguage = 'TYPESCRIPT' | 'PHP'
type TestFramework = 'JEST' | 'VITEST' | 'PHPUNIT'

interface ProjectVersionResponse {
  id: Id
  projectId: Id
  status: ProjectVersionStatus
  language: ProjectLanguage
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
  language: ProjectLanguage
  filesProcessed: number
  chunksCount: number
  detectedFramework: TestFramework | null
  targetsTotal: number
  targetsWithTest: number
  targetsMissingTest: number
  completedAt: IsoDateTime | null
}

interface ProjectVersionSummaryResponse extends ProjectVersionResponse {
  detectedFramework: TestFramework | null
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
  language: ProjectLanguage
  detectedFramework: TestFramework | null
  targetsTotal: number
  targetsWithTest: number
  targetsMissingTest: number
  targets: TestTargetResponse[]
}
```

### 6.3 Generación y validación del AnalysisRun

La generación y validación ocurren dentro del lifecycle de `AnalysisRun` (§6.10 y §6.12); no existe una operación HTTP independiente para solicitarlas.

### 6.4 Propuestas y evidencia

Las propuestas y su diff se consultan desde el `AnalysisRun`; la publicación revisada crea un companion PR conforme a §6.12. El navegador no descarga un paquete legacy de resultados.

`storageKey`, bucket, credenciales y URLs internas nunca aparecen en DTOs para el navegador.

### 6.5 Experimento

- `POST /experiments` → `202 ExperimentAcceptedResponse`.
- `GET /experiments/{experimentId}` → `200 ExperimentStatusResponse`.
- `GET /experiments/{experimentId}/results` → `200 ExperimentResultsResponse` al completar.
- `GET /analysis-runs/{analysisRunId}/experiments?cursor&limit` → `200 Page<ExperimentStatusResponse>` (HU17, "Run comparison": punto de entrada desde el Run Detail para listar/lanzar comparaciones sobre ese Run).

La comparación `RAG` vs `GENERALIST_AGENT` de HU17 recibe un `AnalysisRun` y un símbolo `METHOD`/`FUNCTION` del changeset `DIRECTLY_CHANGED`, identificado como `AnalysisSymbolResponse` (§6.10). Core resuelve internamente el target sobre la versión congelada del Run; ese mapeo no es contrato. Símbolo ausente: `404 ANALYSIS_SYMBOL_NOT_FOUND`; tipo no elegible: `422 UNSUPPORTED_SYMBOL_KIND`. **Definido, adaptación live pendiente de implementar y verificar.**

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

El contrato HTTP queda definido. `DEC-EXP-002` queda `APROBADO` (herramientas, límites y paridad del agente generalista definidos en `spec/features/008-experimental-comparison/spec.md`); implementar HU17 ya no está bloqueado por decisión, solo pendiente de código. `BASELINE` no es un valor válido.

### 6.5.1 Extensiones de OE5 (INTEROP-2.7)

**Definido, pendiente de implementar y verificar** (`WI-CORE-023`, `WI-CORE-024`, `WI-CORE-025`). Bajo `DEC-EXP-FK-001`, `DEC-EXP-003` y `DEC-EXP-004`, OE5 compara la arquitectura RAG completa con un agente generalista competente de solo lectura bajo condiciones experimentales externas controladas; no mide solo retrieval y no afirma paridad estricta de información.

- Ambos brazos comparten repositorio, PR/HEAD, snapshot, target, proveedor, modelo y versión, esfuerzo de razonamiento, parámetros comunes, perfil de Sandbox y presupuesto comparable. Por `DEC-EXP-004` el modelo es `gpt-6-luna` vía la API de OpenAI y el esfuerzo es el máximo soportado por el modelo y el runtime, idénticos en ambos brazos y registrados en la evidencia; el flujo de producto conserva su configuración actual. Core no degrada el razonamiento en silencio: si el proveedor no admite el esfuerzo pedido, el experimento falla al crearse en lugar de ejecutarse con otro. El esfuerzo y los parámetros efectivos se persisten.
- RAG usa recuperación SE, `ContextBuilder` y el conocimiento funcional `ACTIVE` aplicable. El agente generalista explora en modo solo lectura, sin retriever RAG, sin `ContextBuilder` y sin conocimiento funcional persistente. Ninguno recibe el oráculo. El agente puede descubrir y leer las pruebas existentes; no se le entregan directamente ni se ocultan.
- Herramientas permitidas del agente: `list_files`, `read_file`, `search_text` e `inspect_symbol`/referencias. Prohibidos: shell, Composer/PHPUnit/Jest/Vitest, escritura, Internet y GitHub API. Se persisten el tope de tool calls, el presupuesto de contexto, tokens, archivos y duración, y la secuencia observable de herramientas.
- Diseño pareado: 3 repeticiones RAG y 3 GA forman 3 pares, cada repetición en sesión fresca. El orden dentro de cada par es aleatorio y reproducible a partir de `randomizationSeed`, que se persiste por experimento.
- Reintentos: un fallo de la estrategia no tiene reintento de calidad; un fallo externo demostrado admite como máximo un reintento; un segundo fallo de infraestructura deja la repetición `technicallyEvaluable: false`.
- Ningún DTO declara un ganador. `validRate`, `passedRate` y similares son diagnóstico técnico y no se derivan en CF/CO (SYSTEM-2.6, «Calidad, métricas y evidencia»).
- Autorización y errores: `POST /experiments` exige Writer y `Idempotency-Key`; los GET exigen Reader y un experimento inexistente o no visible responde el mismo `404` que ya devuelve `GET /experiments/{experimentId}`. Si el proveedor no admite el esfuerzo de razonamiento pedido, la creación responde `422 REASONING_EFFORT_UNSUPPORTED` y no se crea el experimento.
- PHP/PHPUnit (`PHP_LARAVEL_PHPUNIT`, `PHPUNIT`) sigue bloqueado para experimentos hasta que `WI-CORE-013` y la coordinación con el dueño de Sandbox estén resueltos.

```ts
interface ExperimentModelConfigResponse {
  provider: string
  model: string
  modelVersion: string | null
  reasoningEffort: string | null // efectivo y común a ambos brazos
  temperature: number | null
  maxOutputTokens: number | null
}

interface ExperimentBudgetResponse {
  toolCallCap: number
  contextTokenBudget: number
  maxDurationMs: number
}

// Campos que INTEROP-2.7 agrega a ExperimentStatusResponse (los consumidores ignoran campos desconocidos):
interface ExperimentStatusV27Additions {
  model: ExperimentModelConfigResponse
  budget: ExperimentBudgetResponse
  executionProfile: string
  runnerHint: string
  randomizationSeed: string
}

// Campos que INTEROP-2.7 agrega a ExperimentRepetitionResponse:
interface ExperimentRepetitionV27Additions {
  pairId: Id
  pairPosition: 1 | 2 // posición de ejecución dentro del par, reproducible desde randomizationSeed
  attempt: number // 1 o 2
  technicallyEvaluable: boolean
}
```

### 6.6 Progreso en tiempo real (WebSockets)

El estado en tiempo real de `AnalysisRun` complementa, pero no reemplaza, los GET de estado por polling. Si el WebSocket no está disponible, el cliente continúa por HTTP sin duplicar la operación.

```ts
// Eventos cliente -> servidor (namespace Socket.IO por defecto, mismo host que la API HTTP)
interface SubscribeProjectVersionEvent { projectVersionId: Id } // evento 'subscribe:project-version'
interface UnsubscribeProjectVersionEvent { projectVersionId: Id } // evento 'unsubscribe:project-version'

interface SubscribeAck { subscribed: boolean; code: 'GITHUB_VERIFICATION_UNAVAILABLE' | null; retryable: boolean } // acknowledgment de 'subscribe:project-version'

// Eventos servidor -> cliente
// 'project-version:update', payload: ProjectVersionResponse (mismo shape que GET /project-versions/{id})
```

Reglas:

- El servidor emite `project-version:update` únicamente a los clientes suscritos a ese id específico (sin broadcast global); una conexión puede suscribirse a varios ids.
- El payload es exactamente `ProjectVersionResponse` ya definido en 6.2: no se introduce un DTO paralelo para WebSocket.
- Una desconexión limpia todas las suscripciones de esa conexión sin acción adicional del servidor.
- No se emite ningún dato ausente de los DTOs HTTP equivalentes (sin prompts, embeddings ni keys de Storage).
- El handshake WebSocket incluye el mismo access token de usuario; Core valida identidad antes de aceptar una suscripción y comprueba que el usuario tenga al menos rol Reader sobre el `Project` antes de unir el socket a una sala; Core mantiene el mapa socket -> `Project` de cada suscripción y saca al socket de las salas de un `Project` cuando el usuario pierde el acceso (§6.9), el Project se borra lógicamente o deja de ser visible para él (p. ej. su binding pasa a `REVOKED` y no es Admin), y deja de emitirle eventos. El acknowledgment de `subscribe:project-version` devuelve `SubscribeAck` con exactamente tres resultados: suscrito (`{ subscribed: true, code: null, retryable: false }`); verificación no disponible (§6.13, GitHub no permite verificar), rechazo reintentable (`{ subscribed: false, code: 'GITHUB_VERIFICATION_UNAVAILABLE', retryable: true }`); y sin visibilidad, sin distinguirlo de un id inexistente (`{ subscribed: false, code: null, retryable: false }`). La identidad del handshake se resuelve por la misma vía que en HTTP (§6.13, "Identidad"): un token válido sin identidad GitHub rechaza la conexión (`connect_error` con `data: { code: 'GITHUB_IDENTITY_REQUIRED', retryable: false }`) y una Admin API de Supabase no disponible con el vínculo no persistido la rechaza con `data: { code: 'IDENTITY_UNAVAILABLE', retryable: true }`; un token inválido o expirado, con `INVALID_ACCESS_TOKEN`. Un handshake sin token se acepta (compatibilidad con clientes que suscriben tras autenticar): cualquier `subscribe:*` sin credencial se rechaza con `AUTH_REQUIRED`, y un token presente que no puede autenticarse rechaza la conexión con `connect_error` y `data { code, message, retryable }`. Un rechazo desde middleware desactiva la reconexión automática de `socket.io-client`: con `retryable: true` el cliente debe llamar a `socket.connect()`. HTTP continúa como fallback.

### 6.7 Trazas de contexto

- `GET /experiments/{experimentId}/context-traces?strategy&repetition&includeSuperseded&cursor&limit` → `200 Page<ContextTraceSummaryResponse>` para HU17. `strategy` y `repetition` filtran las seis repeticiones; sin filtros devuelve todas las trazas vigentes.
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

- `GET /integrations/github/repositories?workspaceId&cursor&limit` -> `200 Page<GitHubUserRepositoryResponse>`; exige `Authorization` y `X-GitHub-Provider-Token` (HU02: `workspaceId` filtra por workspace).
- `POST /integrations/github/repositories/verify-app-access` -> `200 GitHubAppAccessResponse`.
- `GET /integrations/github/repositories/{owner}/{repo}/branches` -> `200 GitHubRepositoryBranchesResponse`.
- `POST /projects/{projectId}/integrations/github` -> `201 ProjectRepositoryBindingResponse`.
- `GET /projects/{projectId}/integrations/github` -> `200 ProjectRepositoryBindingResponse`.
- `POST /projects/{projectId}/integrations/github/enable` -> `200 ProjectRepositoryBindingResponse` (HU02).
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

`workspaceId` (el `id` de un `WorkspaceResponse`, §6.13) limita la lista a los repositorios del workspace: con el id de una organización, solo repositorios cuyo propietario es esa organización; con el id del workspace personal, solo los que pertenecen a la cuenta del usuario. Un `workspaceId` que no es un workspace del usuario responde `404 WORKSPACE_NOT_FOUND`, y si la pertenencia a la organización no puede verificarse, `503 GITHUB_VERIFICATION_UNAVAILABLE`. Sin `workspaceId` la lista no se filtra (compatibilidad); la Console lo envía con `Project.workspace.id` al vincular, y la validación autoritativa ocurre siempre en `POST .../integrations/github`. Se ofrecen también repositorios donde el usuario solo tiene `read`/`triage` (`permissions` lo indica); vincularlos se rechaza en el `POST`.

Core valida `repositoryId` y `repositoryName` mediante GitHub Integration antes de persistir (`POST .../integrations/github`). `verify-app-access` devuelve `repositoryId` y `repositoryName` tal como se enviaron; la validación autoritativa del id ocurre en `POST .../integrations/github`. `installationId` es evidencia resuelta por Core: no se acepta desde el navegador y es `null` cuando el resultado es `NOT_AUTHORIZED`. Las ramas se consultan mediante GitHub Integration, que conserva el token de instalación; por eso un repositorio sin acceso devuelve `403 GITHUB_APP_ACCESS_REQUIRED`. La creación exige que `integrationBranch` exista; no hay default. `NOT_AUTHORIZED` no es un error HTTP. Desconectar (`DELETE .../integrations/github`) deja el binding `DISABLED`: es una pausa reversible que conserva la fila y su `repositoryId`, deja de aceptar eventos nuevos y no borra Runs ni Functional Knowledge. Sobre un binding `REVOKED` responde `204` sin cambiar el estado (nunca lo degrada a `DISABLED`); sobre uno ya `DISABLED`, `204`. `installation.suspend` solo pausa bindings `ENABLED`; no altera `REVOKED` ni `DISABLED`.

Reglas de `POST .../integrations/github` (HU02, HU02), en este orden de validación: `404 PROJECT_NOT_FOUND` (Project no visible), `403 PROJECT_ROLE_INSUFFICIENT` (rol menor que Writer), `409 REPOSITORY_BINDING_ALREADY_EXISTS` (el Project ya tiene binding), `403 GITHUB_APP_ACCESS_REQUIRED`, `404 GITHUB_REPOSITORY_NOT_FOUND`, `400 REPOSITORY_OUTSIDE_WORKSPACE`, `403 REPOSITORY_PERMISSION_INSUFFICIENT`, `409 REPOSITORY_ALREADY_BOUND`, `404 INTEGRATION_BRANCH_NOT_FOUND`. Core solicita a GitHub Integration resolver el `repositoryId` real y no confía en el enviado por el cliente. Si GitHub Integration confirma que el repositorio no existe o su `repositoryId` real no coincide con el enviado para `repositoryName`, Core responde `404 GITHUB_REPOSITORY_NOT_FOUND` sin persistir. Esta validación ocurre después de comprobar el acceso de la App y antes de comprobar si otro Project ya usa el repositorio. Un usuario sin ningún permiso sobre el repositorio (ni siquiera `read`) recibe el mismo `404 GITHUB_REPOSITORY_NOT_FOUND` que uno inexistente: ese caso colapsa en este paso, antes de `REPOSITORY_OUTSIDE_WORKSPACE`, y se acepta la diferencia residual con el `403 GITHUB_APP_ACCESS_REQUIRED` anterior (App no instalada frente a instalada sin permiso del usuario). En un Project de organización quien no es miembro activo ni siquiera ve el Project (`404 PROJECT_NOT_FOUND`, primer paso). `REPOSITORY_OUTSIDE_WORKSPACE`: el propietario real del repositorio (id de GitHub resuelto a través de GitHub Integration) no es la organización del Project o, en un Project personal, no es la cuenta de su creador (en personal, ser propietario del repositorio implica `admin` sobre él); en una organización solo se aceptan repositorios de esa organización. `REPOSITORY_PERMISSION_INSUFFICIENT`: el permiso efectivo del usuario sobre el repositorio, leído mediante GitHub Integration y normalizado como nivel (`role_name`; un rol personalizado se mapea por su permiso base), es `read` o `triage` y no `maintain`, `write` o `admin`, porque la GitHub App publica con permisos de escritura. Ambas validaciones ocurren antes de comprobar `REPOSITORY_ALREADY_BOUND`, de modo que un usuario no puede sondear qué repositorios ajenos están vinculados. Si GitHub Integration no puede verificar el permiso o la pertenencia, `503 GITHUB_VERIFICATION_UNAVAILABLE` y no se persiste nada; en `verify-app-access`, `branches` y `GET /integrations/github/repositories?workspaceId` un permiso o una pertenencia no verificable responde también `503`, nunca `NOT_AUTHORIZED` ni `404`. Un Project tiene un solo repositorio y no se revincula: no existe ruta para cambiarlo, `DELETE .../integrations/github` solo pausa y un `POST` posterior responde `409 REPOSITORY_BINDING_ALREADY_EXISTS`; para usar otro repositorio se elimina el Project y se crea otro. Como un Project sin repositorio solo lo ven sus Admin (§6.13), el primer vínculo lo hace un Admin. `REPOSITORY_ALREADY_BOUND` significa que otro Project ya usa ese repositorio; su mensaje es genérico y no revela el Project ni el usuario ajeno. Una violación de unicidad concurrente se traduce al `409` correspondiente, nunca a `500`.

Reglas de `POST .../integrations/github/enable` (HU02): pasa `DISABLED` a `ENABLED` y es idempotente (un binding ya `ENABLED` responde `200` con el mismo cuerpo, sin revalidar). Antes de reactivar Core solicita a GitHub Integration revalidar el acceso de la App y refresca `installationId`; sin acceso responde `403 GITHUB_APP_ACCESS_REQUIRED` y el estado no cambia. Un binding `REVOKED` también se reactiva por esta ruta (en un Project de organización solo lo hace un Admin, el único que lo ve, §6.13) si la revalidación confirma que la App recuperó acceso al repositorio (así un Project sale de `REVOKED` sin borrarse); si no hay acceso, `403 GITHUB_APP_ACCESS_REQUIRED` y sigue `REVOKED`. Reactivar un `REVOKED` aplica además la misma validación de propietario y de `repositoryId` que `POST .../integrations/github`: Core solicita a GitHub Integration resolver el `repositoryId` real del `repositoryName` guardado y, si GitHub Integration confirma que no existe o no coincide con el `repositoryId` persistido (repositorio eliminado y recreado con el mismo nombre), responde `404 GITHUB_REPOSITORY_NOT_FOUND`, y si su propietario ya no es el workspace del Project (transferido), `400 REPOSITORY_OUTSIDE_WORKSPACE`; en ambos casos el binding sigue `REVOKED`. La reactivación siempre compara el `repositoryId` persistido. Sin Project propio (inexistente, ajeno o borrado): `404 PROJECT_NOT_FOUND`; sin binding: `404 REPOSITORY_BINDING_NOT_FOUND`.

`GET .../integrations/github` exige rol Reader; `POST .../integrations/github`, `POST .../enable` y `DELETE .../integrations/github` exigen Writer (que incluye a Maintainer y Admin; INTEROP-2.7, definido y pendiente de implementar en `WI-CORE-019`; hasta entonces rige Maintainer), y `enable` sobre un binding `REVOKED` sigue la regla de visibilidad de §6.13. `POST /integrations/github/repositories/verify-app-access` y `GET /integrations/github/repositories/{owner}/{repo}/branches`, que no reciben un Project, exigen que el usuario tenga permiso `maintain`, `write` o `admin` sobre el repositorio consultado: con permiso menor responden `403 REPOSITORY_PERMISSION_INSUFFICIENT` y sin ninguna visibilidad `branches` responde `404 GITHUB_REPOSITORY_NOT_FOUND` (mismo criterio que `POST .../integrations/github`) y `verify-app-access` `NOT_AUTHORIZED`, de modo que no revelan la instalación ni las ramas de repositorios ajenos; un permiso no verificable responde `503 GITHUB_VERIFICATION_UNAVAILABLE`. Orden en `branches`: App no instalada en el repositorio `403 GITHUB_APP_ACCESS_REQUIRED` (como hasta ahora), después sin visibilidad `404 GITHUB_REPOSITORY_NOT_FOUND`, después permiso menor `403 REPOSITORY_PERMISSION_INSUFFICIENT`; en `verify-app-access`: App no instalada `NOT_AUTHORIZED`, instalada sin visibilidad `NOT_AUTHORIZED`, permiso menor `403 REPOSITORY_PERMISSION_INSUFFICIENT`, no verificable `503`. Se acepta por escrito la diferencia residual `403 GITHUB_APP_ACCESS_REQUIRED` (App no instalada) frente a `404` (instalada, sin permiso del usuario), igual que en `POST .../integrations/github`. Un Reader no debe llamar `verify-app-access` (`403`): el estado del binding se consulta con `GET .../integrations/github`, que exige solo Reader. Estas dos rutas no exigen membresía de la organización: el permiso `maintain`/`write`/`admin` sobre el repositorio ya implica poder verlo; la membresía se exige al vincular, donde el Project de organización solo lo ve un miembro (§6.13). Es una corrección de seguridad de `INTEROP-2.3` y anteriores (`DEC-ORG-002`), donde estas dos rutas respondían sobre cualquier repositorio al que la App tuviera acceso, sin comprobar al usuario.

El renombre de un repositorio actualiza `repositoryName` del binding; su transferencia fuera del workspace del Project o su eliminación pasa el binding a `REVOKED` sin borrar evidencia (§6.9).

Errores de dominio: `GITHUB_ACCOUNT_REQUIRED` (401), `GITHUB_USER_TOKEN_INVALID` (401), `GITHUB_APP_ACCESS_REQUIRED` (403), `GITHUB_REPOSITORY_NOT_FOUND` (404), `INTEGRATION_BRANCH_NOT_FOUND` (404), `REPOSITORY_BINDING_ALREADY_EXISTS` (409), `REPOSITORY_ALREADY_BOUND` (409) y `REPOSITORY_BINDING_NOT_FOUND` (404); desde `INTEROP-2.4` también `REPOSITORY_OUTSIDE_WORKSPACE` (400), `REPOSITORY_PERMISSION_INSUFFICIENT` (403), `PROJECT_ROLE_INSUFFICIENT` (403), `WORKSPACE_NOT_FOUND` (404) y `GITHUB_VERIFICATION_UNAVAILABLE` (503), definidos en §6.13. No se exponen mensajes crudos de GitHub.

### 6.9 Webhooks GitHub y normalización PR

- `POST /internal/v1/github/webhook-events` -> `202 GitHubWebhookAcceptedResponse` para una aceptación nueva/no-op y `200` solo para un PR cuya entrega ya está persistida. Es un endpoint privado GH Integration→Core; no pertenece a la API pública de Console ni acepta sesiones de usuario.

GitHub envía `x-github-delivery`, `x-github-event` y `x-hub-signature-256` al host de GitHub Integration. Ese componente verifica la firma sobre el body crudo, normaliza el evento y reenvía a Core solo los campos allowlisted. Core autentica ese salto con un bearer GH→Core independiente y valida `schemaVersion` y la forma estricta del evento antes de procesarlo; el detalle del DTO y sus reglas está en `GH-INTEROP-1.2` (`spec/contracts/github-integration-contract.md`, §Webhooks). Core no recibe ni verifica firmas GitHub ni expone un ingress público de webhooks. Solo instalaciones y bindings `ENABLED` producen trabajo de análisis; los eventos de acceso de "Eventos de acceso" (abajo) se procesan aunque el binding no esté `ENABLED`, porque mantienen los registros de acceso de todo Project vivo.

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

Core solo crea o reinicia Runs cuando `pullRequest.createdAt >= RepositoryBinding.createdAt`. Un PR anterior al binding no se vuelve elegible por un evento posterior. Si `createdAt` es `null` o no verificable, el webhook se acepta, no se crea un Run provisional y Core conserva el evento normalizado en un job durable; tras verificar la fecha, el job reanuda el análisis únicamente si el binding sigue habilitado y el PR permanece abierto con el mismo HEAD. No se usa `receivedAt` como sustituto. Las acciones que cierran o desactivan un PR se aplican aun sin fecha verificable.

#### Eventos de acceso (`DEC-ORG-001`, HU01/HU02)

La GitHub App se suscribe además a `member`, `membership`, `organization`, `team` y `repository` (`installation` e `installation_repositories` llegan siempre). GitHub Integration valida la firma y los entrega a Core mediante el endpoint privado descrito arriba. Core responde `202 GitHubWebhookAcceptedResponse` (`analysisRunId: null`) tras aplicar el efecto idempotente o encolar la reverificación en la cola de jobs existente; no hace llamadas de verificación a GitHub dentro del request. **Implementado (bundle B).**

Los registros de acceso existen solo para Projects de organización: `member`, `membership`, `team` y `organization` no afectan a Projects personales, mientras `repository` e `installation`/`installation_repositories` siguen actualizando el binding de cualquier Project.

Regla de confianza: el payload solo selecciona qué pares (usuario, Project) reverificar; el rol resultante siempre sale de una verificación viva solicitada a GitHub Integration (§6.13), nunca del payload, porque un evento puede llegar duplicado, tarde o fuera de orden. Reverificar es idempotente: confirma y actualiza `role`/`verifiedAt`, borra el registro si GitHub confirma que se perdió el acceso o lo conserva si no puede verificar.

| Evento (`action`) | Efecto |
|---|---|
| `member` (`added`, `edited`, `removed`) | Reverifica al usuario `member.id` sobre los Projects de organización vinculados a `repository.id`. |
| `membership` (`added`, `removed`) | Cambio de miembro de un Team: reverifica al usuario `member.id` sobre todos los Projects con repositorio de `organization.id` (los repositorios del Team no vienen en el payload). |
| `organization` (`member_removed`) | Reverifica al usuario `membership.user.id` sobre todos los Projects de `organization.id` (borra sus registros, incluido Admin, si ya no es miembro activo). |
| `organization` (`renamed`) | Actualiza el `login` de la organización en los Projects de `organization.id`. |
| `organization` (`deleted`) | Pasa a `REVOKED` los bindings de sus Projects y borra sus registros de acceso; los Projects se conservan ocultos. |
| `team` (`added_to_repository`, `removed_from_repository`, `edited`, `deleted`) | Reverifica los registros de los Projects vinculados a `repository.id` si viene en el payload; si no, de todos los Projects con repositorio de `organization.id`. Un cambio del permiso de un Team no está garantizado como evento. |
| `repository` (`renamed`) | Actualiza `repositoryName` del binding. |
| `repository` (`transferred`) | Si el nuevo propietario no es la organización (o cuenta) del Project: binding `REVOKED` y borrado de los registros Maintainer, Writer y Reader; si lo es, solo actualiza el nombre. |
| `repository` (`deleted`) | Binding `REVOKED`; se borran los registros Maintainer, Writer y Reader. |
| `repository` (`privatized`) | Reverifica todos los registros de los Projects vinculados a `repository.id` (el `read` implícito de un repositorio público deja de existir). |
| `installation` (`deleted`) y `installation_repositories` (`removed`) | Además de lo ya definido para el binding, borran los registros de acceso Maintainer, Writer y Reader de los Projects afectados; si se desinstala la App de una organización, también los de Admin (la organización deja de poder verificarse y sus Projects quedan ocultos hasta reinstalar). |
| `installation` (`suspend`) | No borra registros: una instalación suspendida no puede verificar y se trata como GitHub no disponible (se conserva lo existente, no se concede lo nuevo). |

Sin evento fiable (ventana de hasta una hora, solo la reconciliación los corrige): cambio de rol en la organización, cambio del permiso base de la organización y accesos heredados que cambian sin evento directo. Los demás valores de `action` y los eventos no listados se ignoran (`202`).

**Reconciliación horaria.** Un job periódico, cada hora, sobre la cola `jobs` existente, recorre los Projects vivos y solicita las verificaciones a GitHub Integration: (a) para los de organización con registros de acceso, comprueba que la organización sea resoluble, que la App siga instalada y que tenga al menos un owner activo (una lista de owners vacía, que en GitHub no es un estado real y suele ser un artefacto de visibilidad, se trata como no verificable: se conserva todo y se reintenta); si GitHub confirma lo contrario, sus Projects quedan ocultos (bindings `REVOKED` y registros de acceso borrados) y reaparecen, con binding `REVOKED` hasta que un Admin lo reactive (`POST .../enable`), cuando la App se reinstala o la organización vuelve, porque el acceso se vuelve a crear al entrar (§6.13); (b) para los Projects con registros de acceso, recalcula cada registro con las mismas reglas que el alta, borra los que GitHub confirma perdidos y conserva los no verificables; (c) revalida el propietario y el nombre del repositorio vinculado de todo Project vivo con binding, personales incluidos (transferido fuera del workspace o eliminado: binding `REVOKED`, y al pasar a `REVOKED` se borran también los registros Maintainer, Writer y Reader; renombrado: actualiza `repositoryName`), para que un evento `repository` perdido también se corrija. Una verificación por evento (`ACCESS_REVERIFY`) que no puede completarse por una caída de GitHub se reprograma con un backoff creciente acotado a una hora en lugar de fallar en silencio; la reconciliación es el respaldo. Una App desinstalada de la organización no es una caída de GitHub: la organización deja de ofrecerse y sus Projects se ocultan (`404`, no un `503` permanente); una instalación suspendida sí se trata como no verificable. Ante una caída de GitHub (error de red, `5xx`, límite de tasa, instalación suspendida o falta de `Members: read` en la organización) la reconciliación no revoca nada ni concede nada nuevo, y el siguiente ciclo se programa igualmente. No se agrega una caché de permisos.

### 6.10 Analysis Runs

- `GET /projects/{projectId}/analysis-runs?status&cursor&limit` -> `200 Page<AnalysisRunSummaryResponse>`.
- `GET /analysis-runs?status&cursor&limit` -> `200 Page<AnalysisRunSummaryResponse>` (HU14, sin `projectId`: Runs de todos los Projects visibles para el usuario autenticado (cualquier rol), mismo shape — no es una vista global sin dueño; cubre los Projects personales del usuario más los de organización con registro de acceso ya existente). **Implementado (HU14, bundle B).**
- `GET /analysis-runs/{analysisRunId}` -> `200 AnalysisRunDetailResponse`.

Las listas y los detalles omiten Runs cuyo `pullRequest.createdAt` aún no se verificó o cuya fecha precede al binding; un deep link a uno de esos Runs responde como inexistente. Los Runs y su evidencia se conservan físicamente. La elegibilidad se filtra antes de paginar, por lo que un cursor no expone ni salta entre filas ocultas.

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

`history` (HU12) es append-only y ordenado cronológicamente ascendente, incluida la creación inicial (`fromStatus: null`, `toStatus: 'QUEUED'`, `reason: 'RUN_CREATED'`); complementa los timestamps de `AnalysisRunSummaryResponse`, no los reemplaza. **Definido, pendiente de implementación.**

### 6.11 Action Required y Functional Knowledge

- `GET /action-required?projectId&cursor&limit` -> `200 Page<FunctionalQuestionResponse>`. Sin `projectId` cubre los Projects personales del usuario más los de organización con registro de acceso ya existente. Con `projectId` de un Project no visible responde `404 PROJECT_NOT_FOUND` (cambio observable de `INTEROP-2.4`: antes, una página vacía). Solo incluye preguntas `PENDING` cuyo `AnalysisRun` esté en `ACTION_REQUIRED` y `current=true`; al obsoletarse el Run, sus preguntas pendientes pasan a `OBSOLETE` y dejan de ser accionables.
- `GET /analysis-runs/{analysisRunId}/context-questions` -> `200 FunctionalQuestionSetResponse`.
- `POST /analysis-runs/{analysisRunId}/context-questions/{questionId}/answers` -> `202 FunctionalAnswerAcceptedResponse`.
- `GET /projects/{projectId}/functional-knowledge?status&cursor&limit` -> `200 Page<FunctionalKnowledgeResponse>`.

El inbox de preguntas también omite cualquier pregunta cuyo Run esté sin clasificar o corresponda a un PR anterior al binding. Al clasificarlo como anterior, las preguntas `PENDING` se obsoletan junto al Run.

```ts
type FunctionalScope = 'PROJECT' | 'MODULE' | 'CLASS' | 'METHOD' | 'SYMBOL'
type FunctionalQuestionStatus = 'PENDING' | 'ANSWERED' | 'OBSOLETE'
type FunctionalAnswerChoice = 'YES' | 'NO' | 'DEPENDS' | 'UNKNOWN' | 'FREE_TEXT'
// Los tipos y campos marcados INTEROP-2.7 siguientes están definidos y pendientes de implementar (WI-CORE-018, WI-CORE-019 y WI-CORE-020).
type ScenarioKind = 'EXPECTED_RESULT' | 'BOUNDARY' | 'EXCEPTION' | 'STATE_TRANSITION' | 'OBSERVABLE_SIDE_EFFECT' | 'FUNCTIONAL_PRECONDITION'
type ConfirmingRole = 'ADMIN' | 'MAINTAINER'

interface FunctionalAbstentionSummary {
  count: number
  lastAt: IsoDateTime
  lastByUserId: Id
  lastByRole: ConfirmingRole
}

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
  scenarioKind: ScenarioKind // INTEROP-2.7 (pendiente, WI-CORE-018): un escenario por pregunta atómica
  scenarioKey: string // derivado por Core de forma determinista (DEC-FK-004, WI-CORE-018); nunca lo escribe una persona
  abstention: FunctionalAbstentionSummary | null // INTEROP-2.7 (pendiente, WI-CORE-018): abstenciones UNKNOWN auditadas
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
  outcome: 'ANSWERED' | 'ABSTAINED' // INTEROP-2.7 (pendiente, WI-CORE-018): ABSTAINED implica continuationAttemptId=null y knowledgeId=null
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
  scenarioKind: ScenarioKind // INTEROP-2.7 (pendiente, WI-CORE-020)
  scenarioKey: string // INTEROP-2.7 (pendiente, WI-CORE-020)
  confirmedByUserId: Id | null // INTEROP-2.7 (pendiente, WI-CORE-019): null solo en reglas históricas anteriores a esta versión
  confirmedRole: ConfirmingRole | null
  originHeadSha: string | null // procedencia, no vencimiento
  sourceRef: string | null // solo si source=APPROVED_IMPORT
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

**HU09, implementado (2026-09-18).** Antes de persistir la regla que produciría una respuesta, Core evalúa si ya existe una `FunctionalKnowledge` `ACTIVE` para el mismo scope+símbolo exacto (match exacto por ahora; jerarquía PROJECT⊃MODULE⊃CLASS y contradicción semántica vía LLM quedan pendientes, ver `harness/state.json`). Si detecta una regla existente y la request no trae `conflictResolution`, responde `409 FUNCTIONAL_KNOWLEDGE_CONFLICT` con `details: FunctionalKnowledgeConflictResponse` (§4) y no persiste ni avanza el Run — Focus Mode muestra la regla existente junto a la propuesta para que el usuario decida antes de contaminar el conocimiento. Un reenvío con `conflictResolution.action: 'SUPERSEDE'` persiste la nueva regla `ACTIVE` y pasa la existente a `SUPERSEDED` (`supersedesId` la referencia); `'KEEP_EXISTING'` registra la respuesta como evidencia de la pregunta (`knowledgeId: null`) sin tocar la regla vigente. `conflictId` reutiliza el `questionId` (de un solo uso, expira si el HEAD cambia igual que una pregunta `OBSOLETE`).

**INTEROP-2.7, `DEC-FK-001` (definido y pendiente de implementar en `WI-CORE-020`).** El match se refina por `scenarioKey`: el conflicto solo existe entre reglas con el mismo scope, `targetRef` y `scenarioKey`, y reglas con distinto `scenarioKey` coexisten como `ACTIVE`. Hasta `WI-CORE-020` rige el match exacto por scope+símbolo descrito arriba.

**`UNKNOWN` (INTEROP-2.7, `DEC-FK-002`; definido, pendiente de implementar en `WI-CORE-018`).** `UNKNOWN` es una abstención auditada y no una respuesta: solo Maintainer o Admin pueden registrarla (`403 PROJECT_ROLE_INSUFFICIENT` para Writer y Reader). La pregunta permanece `PENDING`, el Run permanece `ACTION_REQUIRED`, no se crea ni modifica Functional Knowledge, no se encola continuación y no hay generación. Core responde `202` con `outcome: 'ABSTAINED'`, `continuationAttemptId: null` y `knowledgeId: null`, y registra quién se abstuvo, con qué rol y cuándo (`abstention`). Otra persona con autoridad puede responder la misma pregunta después. Si el HEAD cambió, la pregunta queda `OBSOLETE`, no se reanuda el Run viejo y cualquier regla potencial se reevalúa contra el Run actual. La siguiente pregunta es adaptativa y reemplaza visualmente a la anterior; no se expone un total fijo.

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

**§6.12 implementado por completo (2026-09-18, HU14/HU16).** `GET .../test-proposals` (corte Validation), Checks nativos por HEAD (HU14, `checks/`) y `POST .../test-publications`/`GET /test-publications/{id}` (HU16, `publications/`) ya están construidos. `GeneratedTestProposal.status` usa `AVAILABLE`/`HELD`/`PUBLISHED`; `STALE` está reservado en el enum pero todavía no se activa automáticamente para propuestas (solo la `TestPublication` misma queda `STALE` cuando el freshness check al ejecutar el job de publicación detecta que el HEAD real del PR ya no coincide con `sourceHeadSha` — no hay un barrido que marque `STALE` cualquier propuesta `AVAILABLE` cuando llega un HEAD nuevo). `HELD` cubre tanto `BEHAVIORAL_MISMATCH` como `TECHNICAL_GENERATION_FAILURE` sin distinguirlos en el campo `status` (sí en `AnalysisRun.status` y en `failureSummary`, campo interno no expuesto por este endpoint). El companion PR nunca reabre uno cerrado (`findPullRequestByHead` detecta el estado y la publicación termina `FAILED` en ese caso) y reutiliza un PR abierto existente si el job se reintenta sobre la misma rama. Errores de dominio de HU16 (no estaban listados explícitamente en el contrato, se definieron al implementar): `TEST_PUBLICATION_NOT_FOUND` (404), `TEST_PUBLICATION_INVALID_RUN_STATUS` (409, Run no `SUCCESS` o no vigente), `TEST_PUBLICATION_PROPOSAL_NOT_AVAILABLE` (422, algún `proposalId` no existe para ese Run o no está `AVAILABLE`).

### 6.13 Workspaces, roles y acceso

Fuente: `DEC-ORG-001` (HU01/HU02). GitHub es la fuente de verdad de la autorización; este contrato no repite las decisiones de producto, define su superficie HTTP. **Implementado (bundle A y bundle B), salvo el rol Writer (INTEROP-2.7, `DEC-ORG-003`): definido y pendiente de implementar en `WI-CORE-019`.**

- `GET /workspaces` -> `200 WorkspaceListResponse` (HU01).

```ts
type WorkspaceKind = 'PERSONAL' | 'ORGANIZATION'
type WorkspaceRole = 'ADMIN' | 'MEMBER'
type ProjectRole = 'ADMIN' | 'MAINTAINER' | 'WRITER' | 'READER' // WRITER: INTEROP-2.7, DEC-ORG-003, definido y pendiente de implementar en WI-CORE-019

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

**Workspaces.** `GET /workspaces` devuelve la cuenta personal del usuario (siempre, primero) y cada organización donde la GitHub App está instalada y el usuario es miembro activo, ordenadas por `login`. Core solicita las instalaciones y verifica la membresía mediante GitHub Integration; no usa el token OAuth del usuario ni el scope `read:org` para ese fin. Una organización aparece cuando alguien instala la App en ella; una organización cuya instalación no tiene aceptado `Members: read` no se ofrece. Los Teams de GitHub no son workspace. `WorkspaceRefResponse.id` es lo que se envía como `workspaceId` en las demás rutas. Si GitHub no responde, la lista se compone de la cuenta personal y de las organizaciones de los Projects donde el usuario ya tiene acceso registrado (`role: ADMIN` si tiene algún registro Admin en ella, si no `MEMBER`); no se ofrecen organizaciones nuevas.

**Identidad.** Core resuelve `PlatformUser -> githubUserId` una vez y persiste el vínculo. El `githubUserId` es el `id` numérico de la entrada `provider: 'github'` de `identities[]` que devuelve la Admin API de Supabase `GET /auth/v1/admin/users/{sub}` (con la credencial de servicio de Core, nunca expuesta al navegador); nunca se toma de `user_metadata`, que el propio usuario puede editar, y no se usa el listado `GET /auth/v1/admin/users`, que devuelve `identities: null`. El `login` de GitHub es un dato opcional de presentación y nunca autoriza. El linking manual de identidades de Supabase permanece deshabilitado. El handshake WebSocket usa esta misma resolución. En desarrollo local, un `AUTH_BYPASS` explícito (nunca en producción) aporta una identidad GitHub sintética configurada y no consulta la Admin API. Un token válido sin identidad GitHub responde `401 GITHUB_IDENTITY_REQUIRED` y, si la Admin API no responde y el vínculo aún no está persistido, `503 IDENTITY_UNAVAILABLE`. Si el `githubUserId` resuelto ya está vinculado a otro `sub`, Core no comparte identidad ni roles entre cuentas de Supabase: responde `401 GITHUB_IDENTITY_REQUIRED` (sin revelar el otro `sub`) y no modifica el vínculo existente. El vínculo es inmutable; un usuario que recrea su cuenta de Supabase queda bloqueado hasta que un operador elimine la fila huérfana de `user_github_identities`, y la Console no debe tratar ese `401` como "inicia sesión con GitHub" en bucle.

**Visibilidad y rol.** Un Project personal lo ve únicamente su creador, siempre como Admin, sin registro de acceso ni verificación contra GitHub: los Projects personales no se comparten con colaboradores, solo se comparte mediante organizaciones (`DEC-ORG-002`, que enmienda la visibilidad de `DEC-ORG-001`). Un Project de organización lo ve un usuario si Core verificó que tiene un rol sobre él; el rol es el más alto que aplique, con jerarquía Admin ⊃ Maintainer ⊃ Writer ⊃ Reader (INTEROP-2.7; antes no existía Writer y `write` producía Maintainer, ahora produce Writer, un cambio observable; definido y pendiente de implementar en `WI-CORE-019`):

- **Admin:** en una organización, owner activo de la organización (`GET /orgs/{org}/memberships/{login}` con `role: admin` y `state: active`, permiso `Members: read` de la App); en el workspace personal, el creador, siempre. Un Admin además es Maintainer, Writer y Reader. Un Project sin repositorio vinculado solo lo ven los Admin: todos los owners de la organización, o el creador en personal.
- **Maintainer:** en una organización, miembro activo de ella y con permiso `maintain` o `admin` sobre el repositorio vinculado (`role_name` de `GET /repos/{owner}/{repo}/collaborators/{username}/permission`, con `Metadata: read`; un rol personalizado se mapea por su permiso base).
- **Writer (definido, pendiente de implementar en `WI-CORE-019`):** en una organización, miembro activo de ella y con permiso `write` sobre el repositorio vinculado (misma fuente `role_name` que Maintainer). Puede todo lo que puede un Maintainer salvo responder preguntas funcionales y registrar `UNKNOWN`; no es una degradación global a Reader.
- **Reader:** en una organización, miembro activo de ella y con permiso `triage` o `read` sobre el repositorio vinculado.
- **La membresía activa se exige siempre** (`DEC-ORG-002`): en un Project de organización Maintainer, Writer y Reader necesitan ser miembros activos de la organización además del permiso sobre el repositorio, sea este privado, internal o público. Un colaborador externo (no miembro) no accede al Project aunque tenga `write`, y el `read` implícito de un repositorio público no cuenta. Una única lectura `GET /orgs/{org}/memberships/{login}` sirve para la membresía y el rol de owner.
- Con el binding `REVOKED` no hay permiso de repositorio verificable, y la regla se evalúa en cada petición (no depende de que el paso a `REVOKED` haya borrado registros): un registro Maintainer, Writer o Reader no da acceso a un Project con binding `REVOKED`. Solo los Admin ven el Project (para reactivar el binding con `POST .../enable` o eliminarlo). Si la organización desaparece, se desinstala la App o queda sin owners, el Project queda oculto para todos y se conserva.

**Alta del acceso.** Nadie invita: en un Project de organización el registro de acceso se crea al entrar, verificando en vivo. Toda petición que apunta a un Project de organización (o a un recurso descendiente, incluido un deep link a un Run) sobre el que el usuario no tiene registro dispara esa verificación; un Project personal de otra persona responde `404` sin verificar nada; `GET /projects` (sin filtro o con `workspaceId` de una organización) verifica también los Projects vivos del workspace que aún no tiene registrados. El listado cross-proyecto `GET /analysis-runs` y `GET /action-required` sin `projectId` cubren los Projects personales del usuario más los de organización con registro de acceso ya existente. Un acceso concedido a un Project de organización queda registrado como `(projectId, userId, rol, verifiedAt)`; `verifiedAt` es la última confirmación, no una caducidad: no hay TTL ni caché, el registro rige hasta que un evento (§6.9) o la reconciliación lo cambia. Un alta nunca sobrescribe una revocación posterior al inicio de su verificación: una verificación de alta que comenzó antes de un evento o de una reverificación que borró el acceso no puede volver a crearlo con un resultado ya obsoleto (la verificación y el upsert se serializan con un advisory lock transaccional por `(projectId, userId)`, el mismo que toman las reverificaciones y las revocaciones; retiene una conexión de base de datos durante las llamadas a GitHub, acotado por el presupuesto de verificaciones). Las verificaciones contra GitHub tienen un tope de concurrencia y un presupuesto por petición; agotado el presupuesto, los candidatos restantes se tratan como no verificables (omitidos en listados, `503` en accesos directos). No se memoizan denegaciones: se acepta el riesgo residual de que un límite de tasa de GitHub degrade las altas nuevas, nunca lo ya registrado.

**Caída de GitHub.** Si GitHub no puede consultarse (red, `5xx`, límite de tasa, instalación suspendida, `Members: read` sin aceptar) Core conserva los registros ya existentes y no concede accesos nuevos: los listados omiten los Projects aún no verificados sin fallar, y una petición directa a un Project de organización cuyo acceso no puede verificarse responde `503 GITHUB_VERIFICATION_UNAVAILABLE`, para que el usuario reintente en lugar de creer que no existe. Una App desinstalada de la organización no es "GitHub no disponible": la organización deja de aparecer en `GET /workspaces` y sus Projects responden `404 PROJECT_NOT_FOUND`, no `503`.

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
| `GITHUB_VERIFICATION_UNAVAILABLE` | 503 | GitHub no permite verificar un acceso, permiso o pertenencia nuevos (también en `verify-app-access`, `branches`, discovery con `workspaceId` y suscripciones WebSocket, con `retryable`). |

Un recurso no visible conserva el `404` de su recurso (`PROJECT_NOT_FOUND`, etc.).

**Matriz rol -> operación.** El rol es el mínimo requerido sobre el Project del recurso; un rol mayor también satisface. **Estado de implementación (INTEROP-2.7):** hasta `WI-CORE-019` el rol efectivo de quien tiene `write` sigue siendo Maintainer; la fila Writer y la restricción de responder preguntas a Maintainer son la meta definida, no el comportamiento actual. Un Project no visible responde `404` antes de evaluar el rol.

| Rol mínimo | Operaciones |
|---|---|
| Sin rol de Project (solo sesión GitHub válida) | `GET /workspaces`; `GET /integrations/github/repositories` (con `workspaceId`: pertenencia al workspace); `POST /integrations/github/repositories/verify-app-access` y `GET /integrations/github/repositories/{owner}/{repo}/branches` (exigen permiso `maintain`/`write`/`admin` sobre el repositorio); `POST /projects` (personal: cualquiera; organización: Admin de la organización). Sin sesión de usuario: `GET /health`. El receptor privado normalizado GH Integration→Core se rige por `GH-INTEROP-1.2` (§6.9), no es una operación pública sujeta a rol de Project ni de Console. |
| Reader | `GET /projects`, `GET /projects/{projectId}`; `GET /projects/{projectId}/versions`; `GET /project-versions/{id}`, `.../results`, `.../test-inventory`; `GET /projects/{projectId}/integrations/github`; `GET /projects/{projectId}/analysis-runs`, `GET /analysis-runs`, `GET /analysis-runs/{id}`; `GET /action-required`, `GET /analysis-runs/{id}/context-questions`, `GET /projects/{projectId}/functional-knowledge`; `GET /analysis-runs/{id}/test-proposals`, `GET /test-publications/{id}`; `GET /experiments/{id}`, `.../results`, `GET /analysis-runs/{id}/experiments`; `GET /experiments/{id}/context-traces`, `GET /context-traces/{id}`, `.../discovered-files`; `GET /retrieval-comparisons/{id}`, `.../results`, `.../evidence`, `GET /analysis-runs/{id}/retrieval-comparisons`; `GET /analysis-runs/{id}/trace`, `GET /analysis-runs/{id}/evidence`, `GET /experiments/{id}/evidence`; suscripción WebSocket `subscribe:project-version`. |
| Writer | `POST /projects/{projectId}/integrations/github`, `POST .../enable`, `DELETE .../integrations/github` (pausa) (con la salvedad de que un Project sin repositorio, y uno con binding `REVOKED`, lo ve solo un Admin: reactivar un binding `REVOKED` lo hace un Admin); `POST /analysis-runs/{id}/test-publications`; `POST /experiments`; `POST /retrieval-comparisons`. |
| Maintainer | `POST /analysis-runs/{id}/context-questions/{questionId}/answers` (incluye la abstención `UNKNOWN`, `DEC-FK-002`). |
| Admin | `PATCH /projects/{projectId}`; `DELETE /projects/{projectId}`; `POST /projects` en una organización. |

Notas de la matriz: (1) la validación nace del `AnalysisRun`; leer propuestas y Runs requiere Reader; (2) `GET /analysis-runs` y `GET /action-required` solo devuelven recursos de Projects visibles; (3) en un Project personal el creador es Admin; (4) el rol se exige al aceptar la petición, mientras que la automatización de un job aceptado se autoriza por la GitHub App; (5) default-deny: toda ruta autenticada declara su rol mínimo o una excepción explícita.

### 6.14 Integración de interfaz Console ↔ GitHub Integration

Este límite es exclusivo de operaciones GitHub que la interfaz necesita durante el enlace de un repositorio. No convierte GitHub Integration en backend de Projects: Core sigue siendo propietario de workspaces, Projects, autorización de dominio, persistencia de bindings, RAG y análisis. El navegador nunca se autentica con credenciales de servicio ni puede imponer un `installationId`, un rol o hechos GitHub.

**Rutas públicas de usuario en GitHub Integration** (origin `VITE_GITHUB_INTEGRATION_API_URL`; autenticación `Authorization: Bearer <Supabase access token>`):

| Método y ruta | Uso y resultado |
|---|---|
| `GET /v1/github/app` | `{ displayName, slug, configureUrl }`; requiere sesión y autorización Core de `VIEW_APP_INFO`. |
| `GET /v1/github/repositories?projectId&cursor&limit` | Discovery user-centric con `X-GitHub-Provider-Token`; Core autoriza `DISCOVER_REPOSITORIES` y devuelve el owner scope permitido. GitHub Integration filtra por ese owner los resultados de GitHub antes de responder. |
| `POST /v1/github/repositories/verify-access` | Body `{ projectId, repositoryId, repositoryName, integrationBranch? }`; comprueba App, propietario, permiso del usuario y, si se envía, existencia de la rama. Devuelve estado, metadatos de App y `authorizationEvidence` solo cuando `integrationBranch` fue verificada. |
| `GET /v1/github/repositories/{owner}/{repo}/branches?projectId` | No acepta provider token. Core valida el rol del Project y devuelve la identidad GitHub vinculada y el owner scope; Integration valida instalación, propietario, permiso/membresía con la App, reautoriza los hechos en Core y devuelve `{ items: RepositoryBranch[] }`. |

Las rutas directas Console→Integration son distintas de `/internal/v1/github/*`; su CORS permite solo los orígenes Console configurados. Nunca reciben ni devuelven bearer de servicio, installation token o App JWT. En esas rutas, `X-GitHub-Provider-Token` se limita a discovery y verificación de un repositorio nuevo; se usa en memoria, no se registra ni reenvía a Core. La excepción temporal es la ruta Core heredada de discovery, que recibe el token y lo reenvía a Integration hasta retirar esa compatibilidad en un corte posterior. Binding existente y ramas no reciben OAuth: para ramas Core entrega la identidad vinculada y scope tras validar el Project, Integration obtiene hechos con la App y los vuelve a autorizar en Core. El servidor GitHub Integration envía al callback de Core únicamente la sesión Supabase y hechos allowlisted.

**Autorización síncrona Integration → Core.** `POST /internal/v1/github/authorization-decisions` usa `Authorization: Bearer <GITHUB_INTEGRATION_TO_CORE_TOKEN>` y `X-Platform-User-Token: Bearer <Supabase access token>`. Core valida ese JWT mediante su verificador existente y obtiene el vínculo `PlatformUser → githubUserId`. Cuando el request incluye identidad —OAuth para discovery o una vinculación nueva— Core exige que coincida con el vínculo e impone la política local sobre `projectId`, workspace y recurso. En la consulta inicial de ramas, el request omite `githubUserId`; Core devuelve la identidad vinculada y owner scope solo después de validar sesión, Project y rol. Luego Integration consulta instalación/propietario/permiso/membresía con la App y hace un segundo callback con el `githubUserId` y hechos GitHub allowlisted; Core vuelve a comparar la identidad con el vínculo, valida que el repositorio pertenece al scope y autoriza la acción. El `githubUserId` nunca se anida dentro de `repositories[]`. La respuesta es `ALLOW`/`DENY` más `repositoryOwnerId`/`repositoryOwnerType`, `githubUserId` cuando aplica y `authorizationEvidence` para binding. Core no vuelve a llamar a GitHub Integration durante una misma comprobación. Errores/timeout de Core fallan cerrados y no se convierten en permiso.

```ts
type GithubUiAction = 'VIEW_APP_INFO' | 'DISCOVER_REPOSITORIES'
  | 'VERIFY_REPOSITORY_ACCESS' | 'LIST_REPOSITORY_BRANCHES'

interface GithubAuthorizationDecisionRequest {
  action: GithubUiAction
  projectId?: string
  githubUserId?: string
  repositoryId?: string // solo verificación de binding existente sin OAuth
  repositoryName?: string // solo verificación de binding existente sin OAuth
  repositories?: Array<{
    repositoryId: string; repositoryName: string; ownerId: string
    ownerType: 'User' | 'Organization'
    permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none'
    installationId?: string; installationActive: boolean
    organizationMembership?: { state: 'active' | 'pending'; role: 'admin' | 'member' }
  }>
  integrationBranch?: string // solo si Integration comprobó que existe
}

interface GithubAuthorizationDecisionResponse {
  decision: 'ALLOW' | 'DENY'
  repositoryOwnerId?: string
  repositoryOwnerType?: 'User' | 'Organization'
  githubUserId?: string
  authorizationEvidence?: string | null
}
```

Core firma la evidencia con una clave exclusiva (`GITHUB_BINDING_EVIDENCE_SECRET`, no compartida con los tokens de servicio) y duración máxima de 60 segundos. Sus claims obligatorios son `sub=userId`, `act=CREATE_REPOSITORY_BINDING`, `projectId`, `repositoryId`, `repositoryName`, `ownerId`, `installationId`, `integrationBranch`, `iat`, `exp`, `jti`; `githubUserId` procede de la sesión validada. La evidencia solo se entrega tras permiso Writer/Maintainer/Admin (INTEROP-2.7; hasta `WI-CORE-019`, Maintainer/Admin), propiedad de workspace correcta, App instalada, permiso de repositorio suficiente y rama confirmada. La firma es opaca para el navegador.

**Persistencia y compatibilidad.** Console conserva el `projectId` y selección UX actuales. Al vincular, vuelve a llamar a Integration con la rama elegida para obtener evidencia fresca y envía `{ repositoryId, repositoryName, integrationBranch, authorizationEvidence }` a `POST /projects/{projectId}/integrations/github/verified`. Core valida firma, audiencia/acción, usuario autenticado, alcance exacto, vencimiento y Project vigente; toma el `installationId` únicamente del claim firmado y escribe el binding sin llamar a Integration. Campos de rol/installationId del request se rechazan. La ruta Core existente `POST /projects/{projectId}/integrations/github` y las rutas Core de discovery, verify-access y ramas se mantienen sin cambio durante este corte; su retiro será otra tarea/corte una vez verificado el consumo directo. Core sigue sirviendo las operaciones de binding no GitHub, Projects/workspaces y toda actividad RAG/análisis.

### 6.15 Comparación de retrieval OE2 (SE vs SEM)

**Definido en INTEROP-2.7, pendiente de implementar y verificar** (`WI-CORE-022`; la Console la consume en `WI-CONSOLE-014`). Es una capacidad experimental separada de OE5 y del producto operativo, con alcance HU05 y HU17. El producto normal usa siempre `SE`; no existe un selector permanente de modo en la interfaz.

- `POST /retrieval-comparisons` → `202 RetrievalComparisonAcceptedResponse`. Exige `Idempotency-Key` (scope `RETRIEVAL_COMPARISON_CREATE`) y rol Writer.
- `GET /retrieval-comparisons/{retrievalComparisonId}` → `200 RetrievalComparisonStatusResponse`.
- `GET /retrieval-comparisons/{retrievalComparisonId}/results` → `200 RetrievalComparisonResultsResponse`; antes de un estado terminal, `409 RETRIEVAL_COMPARISON_NOT_FINISHED`.
- `GET /analysis-runs/{analysisRunId}/retrieval-comparisons?cursor&limit` → `200 Page<RetrievalComparisonStatusResponse>`.

El target se identifica igual que en §6.5 (`AnalysisRun` + símbolo `METHOD`/`FUNCTION` `DIRECTLY_CHANGED`); ausente: `404 ANALYSIS_SYMBOL_NOT_FOUND`; tipo no elegible: `422 UNSUPPORTED_SYMBOL_KIND`; comparación inexistente o no visible: `404 RETRIEVAL_COMPARISON_NOT_FOUND`; un `AnalysisRun` inexistente o no visible responde el mismo `404` que `GET /analysis-runs/{analysisRunId}`; rol insuficiente: `403 PROJECT_ROLE_INSUFFICIENT`; validación de cuerpo y `Idempotency-Key`: los errores `400` de §4. La operación es asíncrona (§5) y de solo retrieval: no invoca LLM, Functional Knowledge, `ACTION_REQUIRED`, generación, Sandbox ni publicación, y no cambia el estado del `AnalysisRun`.

Ambos modos comparten `Project`/`ProjectVersion`, snapshot, target, chunks, embeddings, query anchor, los 20 primeros candidatos semánticos y las exclusiones generales. `SEM` es solo semántico (coseno), conserva `semanticScore`, no aplica refuerzo estructural y selecciona los 10 primeros. `SE` une y deduplica los 20 semánticos con los candidatos estructurales, pondera `0.7·semántico + 0.3·estructural` (configurable, sin presentarse como verdad científica) y selecciona los 10 primeros. Para PHP, las relaciones estructurales son `IMPORTS`, `IMPORTED_BY`, `SAME_NAMESPACE`, `FULLY_QUALIFIED_REFERENCE` y `DECLARING_CLASS` (su implementación PHP queda diferida con `WI-CORE-028`).

`Precision@10` y `Recall@10` son las métricas principales; `Precision@5` y `Recall@5`, secundarias. La verdad de terreno, Cohen κ, bootstrap y Wilcoxon son externos a Core: Core calcula P@k y R@k solo si la solicitud trae `groundTruth` y, si no, `metrics` es `null`. Nunca se inventa una verdad de terreno ni se declara un ganador.

```ts
type RetrievalMode = 'SE' | 'SEM'
type StructuralRelation = 'IMPORTS' | 'IMPORTED_BY' | 'SAME_NAMESPACE' | 'FULLY_QUALIFIED_REFERENCE' | 'DECLARING_CLASS'
type RetrievalComparisonStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

interface RetrievalGroundTruthItem {
  filePath: RelativePath
  symbolQualifiedName: string
}

interface CreateRetrievalComparisonRequest {
  analysisRunId: Id
  symbolFilePath: RelativePath
  symbolQualifiedName: string
  groundTruth?: RetrievalGroundTruthItem[] // externa; sin ella, metrics=null
}

interface RetrievalComparisonAcceptedResponse extends AsyncAccepted {
  analysisRunId: Id
  retrievalComparisonId: Id
  projectVersionId: Id
}

interface RetrievalComparisonStatusResponse {
  id: Id
  analysisRunId: Id
  projectId: Id
  projectVersionId: Id
  symbol: AnalysisSymbolResponse
  status: RetrievalComparisonStatus
  failureCode: string | null
  failureMessage: string | null
  startedAt: IsoDateTime | null
  completedAt: IsoDateTime | null
}

interface RetrievalCandidateResponse {
  rank: number
  chunkId: Id
  filePath: RelativePath
  symbolQualifiedName: string | null
  semanticScore: number | null
  structuralRelation: StructuralRelation | null
  combinedScore: number | null // solo SE
  selected: boolean
}

interface RetrievalMetricsResponse {
  precisionAt5: number
  recallAt5: number
  precisionAt10: number
  recallAt10: number
}

interface RetrievalModeResultResponse {
  mode: RetrievalMode
  retrievalId: Id
  config: {
    semanticTopK: number // 20
    finalTopK: number // 10
    semanticWeight: number | null // SE: 0.7 por defecto; SEM: null
    structuralWeight: number | null // SE: 0.3 por defecto; SEM: null
    embeddingModel: string
  }
  candidates: RetrievalCandidateResponse[]
  metrics: RetrievalMetricsResponse | null
}

interface RetrievalComparisonResultsResponse {
  retrievalComparisonId: Id
  analysisRunId: Id
  projectVersionId: Id
  symbol: AnalysisSymbolResponse
  modes: RetrievalModeResultResponse[] // exactamente SE y SEM
  completedAt: IsoDateTime
}
```

### 6.16 Trace operativo y exportación de evidencia

**Definido en INTEROP-2.7, pendiente de implementar y verificar** (`WI-CORE-026`, `WI-CORE-027`; la Console los consume en `WI-CONSOLE-016` y `WI-CONSOLE-017`). El trace operativo del `AnalysisRun` (HU15) es distinto del `ContextTrace` experimental de §6.7. Core introduce `retrieval_id` y `context_id` y reutiliza el `execution_id` del Sandbox; no crea otros identificadores ni identificadores de evidencia académica (`EV-OE*`).

- `GET /analysis-runs/{analysisRunId}/trace` → `200 AnalysisRunTraceResponse` (Reader).
- `GET /analysis-runs/{analysisRunId}/evidence`, `GET /experiments/{experimentId}/evidence`, `GET /retrieval-comparisons/{retrievalComparisonId}/evidence` → `200 EvidenceBundleResponse` (Reader). Antes de un estado terminal, `409 EVIDENCE_NOT_FINISHED`; un `AnalysisRun`, experimento o comparación inexistente o no visible responde el `404` de su ruta de estado; rol insuficiente: `403 PROJECT_ROLE_INSUFFICIENT`.

Los nueve enlaces se mapean a los DTO así: (1) repositorio/PR/HEAD → `repositoryName`, `pullRequestNumber`, `headSha`; (2) `AnalysisRun` → `analysisRunId`; (3) changeset/targets → `changeset` y `targets[].symbol`; (4) retrieval → `targets[].retrieval`; (5) contexto → `targets[].context`; (6) generación → `targets[].generation`; (7) Sandbox y (8) resultados → `targets[].executions` (`executionId` y `outcome`); (9) publicación → `publication`. Un enlace es `NOT_APPLICABLE` solo cuando el flujo termina legítimamente antes (por ejemplo, un Run sin targets no tiene retrieval). La traza y la evidencia de un `AnalysisRun` están disponibles en cualquier estado salvo `QUEUED` y `PROCESSING` (`409 EVIDENCE_NOT_FINISHED`), incluido `ACTION_REQUIRED`, donde los enlaces posteriores constan `NOT_APPLICABLE`; un experimento o una comparación de retrieval son terminales en `COMPLETED` y `FAILED`. La traza responde ese mismo `409`. La evidencia no incluye chain-of-thought ni credenciales, y los fragmentos de código se tratan como datos potencialmente confidenciales (§6.7).

```ts
type TraceLinkStatus = 'PRESENT' | 'NOT_APPLICABLE'

interface TraceExecutionResponse {
  executionId: string // identificador del Sandbox
  proposalId: Id
  attempt: number
  executionProfile: string
  outcome: string // clasificación técnica ya expuesta en el Run
}

interface TraceTargetResponse {
  symbol: AnalysisSymbolResponse
  retrieval: { status: TraceLinkStatus; retrievalId: Id | null }
  context: { status: TraceLinkStatus; contextId: Id | null; functionalRuleIds: Id[] }
  generation: { status: TraceLinkStatus; proposalIds: Id[] }
  executions: { status: TraceLinkStatus; items: TraceExecutionResponse[] }
}

interface TracePublicationResponse {
  status: TraceLinkStatus
  checkId: string | null
  companionBranch: string | null
  companionPullRequestUrl: string | null
  sourceHeadSha: string | null
  freshness: 'CURRENT' | 'STALE' | null
}

interface AnalysisRunTraceResponse {
  analysisRunId: Id
  repositoryName: string
  pullRequestNumber: number
  headSha: string
  changeset: { status: TraceLinkStatus; targetCount: number }
  targets: TraceTargetResponse[]
  publication: TracePublicationResponse
}

type EvidenceKind = 'ANALYSIS_RUN' | 'EXPERIMENT' | 'RETRIEVAL_COMPARISON'

interface EvidenceBundleResponse {
  schemaVersion: '1'
  kind: EvidenceKind
  subjectId: Id
  generatedAt: IsoDateTime
  correlationId: string
  analysisRun: { analysisRunId: Id; repositoryName: string; pullRequestNumber: number; headSha: string; projectVersionId: Id; snapshotRef: string /* referencia opaca; nunca una URL firmada */; targets: AnalysisSymbolResponse[]; createdAt: IsoDateTime } | null
  retrieval: { retrievalId: Id; mode: RetrievalMode; config: RetrievalModeResultResponse['config']; candidates: RetrievalCandidateResponse[] }[]
  context: { contextId: Id; selectedChunkIds: Id[]; discardedChunkIds: Id[]; tokenCounts: { selected: number; budget: number | null }; functionalRuleIds: Id[] }[]
  generation: { strategy: ExperimentStrategy | 'PRODUCT'; provider: string; model: string; modelVersion: string | null; reasoningEffort: string | null; inputTokens: number | null; outputTokens: number | null; durationMs: number; artifactHash: Sha256 }[]
  agentExploration: { toolCallCap: number; steps: { step: number; toolName: string; status: string }[]; filesInspected: number | null; contextTokenBudget: number }[]
  sandbox: { executionId: string; executionProfile: string; runnerHint: string; attempt: number; facts: Record<string, string | number | boolean | null> /* claves cerradas: executionProfile, runner, compiled, executed, passed, totalTests, passedTests, failedTests, skippedTests, testCasesTruncated, failureStage, failureCategory, failureCode, failureMessage; sin logs, evidencias ni URLs y con failureMessage saneado */; durationMs: number; requestId: string; correlationId: string }[]
  experimental: { experimentId: Id; strategy: ExperimentStrategy; repetition: number; pairId: Id; pairPosition: 1 | 2; attempt: number; randomizationSeed: string }[]
  publication: TracePublicationResponse | null
}
```

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

- `ProjectVersion` (§6.2) es una versión interna derivada del `AnalysisRun`; la comparación experimental (§6.5) conserva un flujo propio sobre el mismo snapshot.
- Las operaciones 6.8-6.13 son contrato aprobado para implementar; las de 6.15 y 6.16 (INTEROP-2.7) están definidas y pendientes de implementar. Su disponibilidad efectiva se declara por componente en las features y tareas correspondientes; Core construye progresivamente las capacidades PR-driven.
- Developer Console conserva únicamente mocks alineados a INTEROP-2.2 y separados de live; no constituyen evidencia ni sustituyen endpoints de Core.
- Test Execution Sandbox implementa actualmente el equivalente de `NODE_TYPESCRIPT` con Jest/Vitest. `PHP_LARAVEL_PHPUNIT`, `phase` y la evidencia ampliada quedan aprobados pero pendientes de implementación.
- La integración Core↔Sandbox actual continúa operativa bajo el subconjunto compatible de 1.6; la adopción completa de los campos 2.0 exige migración coordinada y contract tests en ambos backends.
- `DEC-GH-001`, `DEC-INT-001`, `DEC-AUTH-001`, `DEC-IDEMP-001`, `DEC-WEB-AUTH-001`, `DEC-ORG-001`, `DEC-ORG-002`, `DEC-EXP-002`, `DEC-CHUNK-001` y `DEC-EMB-001` están `APROBADO` y, desde `INTEROP-2.7`, `DEC-EXP-003`, `DEC-EXP-FK-001`, `DEC-FK-001`, `DEC-FK-002` y `DEC-ORG-003` (todas `APROBADO`).
- `DEC-INF-001` y `DEC-VAL-001` permanecen `PENDING` con blocks acotados. Mutation testing fue descartado para este alcance.

## 9. Reglas de implementación

- Organizar controllers, DTOs, servicios y adapters por feature en ambos backends.
- Validar todos los requests y serializar respuestas mediante DTOs explícitos.
- Centralizar correlación y `ErrorEnvelope` en interceptors/filtros; no formatear errores manualmente en cada controller.
- Usar tokens de inyección para `ObjectStorageService` en Core, el downloader HTTP del Sandbox, clientes HTTP y demás puertos reemplazables.
- No compartir paquetes de código entre repositorios como fuente oculta de verdad: cada implementación deriva de `INTEROP-2.2` y se verifica mediante contract tests/fixtures versionados.
- Todo cambio de contrato debe actualizar primero el documento canónico, después sus dos espejos y finalmente los adapters/tests afectados.
