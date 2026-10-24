/* AUTO-GENERADO por scripts/generate-contract-types.mjs desde spec/contracts/schemas. No editar a mano. */

// ===== common.schema.json =====
/**
 * UUID.
 */
export type Id = string;
/**
 * ISO 8601 UTC.
 */
export type IsoDateTime = string;
/**
 * POSIX, relativo, normalizado y sin traversal (sin barra inicial, sin '..', sin '\').
 */
export type RelativePath = string;
/**
 * 64 caracteres hexadecimales minúsculos.
 */
export type Sha256 = string;
export type NonNegativeInteger = number;
export type ExecutionProfile = "NODE_TYPESCRIPT" | "PHP_LARAVEL_PHPUNIT";
export type TestRunner = "JEST" | "VITEST" | "PHPUNIT";

// ===== error-envelope.schema.json =====
/**
 * Forma única de todo error HTTP de la solución (INTEROP §4). Los consumidores ignoran campos desconocidos.
 */
export interface ErrorEnvelope {
  statusCode: number;
  /**
   * Código estable en UPPER_SNAKE_CASE. Abierto: un código explícito de la aplicación siempre prevalece; los códigos genéricos de INTEROP-2.18 §4 (UNAUTHORIZED, FORBIDDEN, NOT_FOUND, METHOD_NOT_ALLOWED, NOT_ACCEPTABLE, CONFLICT, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE, UNPROCESSABLE_ENTITY, TOO_MANY_REQUESTS, SERVICE_UNAVAILABLE, INTERNAL_ERROR, HTTP_ERROR) se emiten solo cuando el error no trae código propio.
   */
  code: string;
  /**
   * Mensaje neutral; no incluye tokens, secretos, URLs firmadas ni texto crudo de terceros. En los códigos genéricos de INTEROP-2.18 §4 es un mensaje fijo en español que no repite el texto de la excepción.
   */
  message: string;
  /**
   * Detalle estructurado (cualquier valor JSON) o null cuando no aplica.
   */
  details: {} | unknown[] | string | number | boolean | null;
  correlationId: string;
  /**
   * ISO 8601 UTC.
   */
  timestamp: string;
  path: string;
  /**
   * Opcional. Lo declaran los servicios cuyo contrato distingue reintentos: GitHub Integration (GH-INTEROP) en todos sus errores, y Core solo en los códigos genéricos de INTEROP-2.18 §4 (true en TOO_MANY_REQUESTS y SERVICE_UNAVAILABLE; false en el resto de genéricos). Ausente = el consumidor no debe asumir reintento.
   */
  retryable?: boolean;
}

// ===== github-webhook-event.schema.json =====
/**
 * Id numérico de GitHub serializado como cadena decimal sin ceros a la izquierda.
 */
export type GithubId = string;
export type NullableGithubId = GithubId | null;
export type NullableString = string | null;
export type WebhookDeliveryId = string;
export type WebhookEventName = string;
/**
 * Acción de GitHub (informativa). Core rechaza más de 100 unidades UTF-16; el esquema cuenta puntos de código.
 */
export type WebhookAction = string | null;
/**
 * Instante de recepción en Integration; en la práctica `toISOString()` (UTC con `Z`).
 */
export type WebhookReceivedAt = string;
/**
 * Fecha de creación del PR en UTC con `Z`, o null si no está verificada.
 */
export type WebhookCreatedAtUtc = string | null;
export type GithubRepositoryOwner = null | {
  id: GithubId;
  login: NullableString;
  type: NullableString;
};
export type GithubPullRequestNumber = number;
/**
 * Sobre normalizado. Exactamente una variante debe cumplirse: la del `eventName` y `data.kind` coherentes, o IGNORED.
 */
export type GithubWebhookEvent =
  | GithubWebhookPullRequestEvent
  | GithubWebhookInstallationEvent
  | GithubWebhookInstallationRepositoriesEvent
  | GithubWebhookRepositoryEvent
  | GithubWebhookMemberEvent
  | GithubWebhookMembershipEvent
  | GithubWebhookOrganizationEvent
  | GithubWebhookTeamEvent
  | GithubWebhookIgnoredEvent;

export interface GithubRepositoryRef {
  id: GithubId;
  fullName: string;
}
export interface GithubRepositoryWithOwner {
  id: GithubId;
  fullName: string;
  owner: GithubRepositoryOwner;
}
export interface GithubRefAndSha {
  ref: string;
  sha: string;
}
export interface GithubPullRequest {
  title: string;
  draft: boolean;
  merged: boolean;
  createdAt: WebhookCreatedAtUtc;
  base: GithubRefAndSha;
  head: GithubRefAndSha;
  userLogin: NullableString;
}
export interface GithubAccount {
  id: NullableGithubId;
  type: NullableString;
}
export interface GithubWebhookPullRequestData {
  kind: "PULL_REQUEST";
  repository: GithubRepositoryRef;
  installationId: NullableGithubId;
  pullRequestNumber: GithubPullRequestNumber;
  pullRequest: GithubPullRequest;
}
export interface GithubWebhookInstallationData {
  kind: "INSTALLATION";
  installationId: GithubId;
  account: GithubAccount;
}
export interface GithubWebhookInstallationRepositoriesData {
  kind: "INSTALLATION_REPOSITORIES";
  installationId: GithubId;
  added: GithubRepositoryRef[];
  removed: GithubRepositoryRef[];
}
export interface GithubWebhookRepositoryData {
  kind: "REPOSITORY";
  repository: GithubRepositoryWithOwner;
  installationId: NullableGithubId;
}
export interface GithubWebhookMemberData {
  kind: "MEMBER";
  memberId: NullableGithubId;
  repositoryId: NullableGithubId;
}
export interface GithubWebhookMembershipData {
  kind: "MEMBERSHIP";
  memberId: NullableGithubId;
  organizationId: NullableGithubId;
}
export interface GithubWebhookOrganizationData {
  kind: "ORGANIZATION";
  organizationId: NullableGithubId;
  organizationLogin: NullableString;
  membershipUserId: NullableGithubId;
}
export interface GithubWebhookTeamData {
  kind: "TEAM";
  repositoryId: NullableGithubId;
  organizationId: NullableGithubId;
}
export interface GithubWebhookIgnoredData {
  kind: "IGNORED";
}
export interface GithubWebhookPullRequestEvent {
  schemaVersion: 1;
  deliveryId: WebhookDeliveryId;
  eventName: "pull_request";
  action: WebhookAction;
  receivedAt: WebhookReceivedAt;
  data: GithubWebhookPullRequestData;
}
export interface GithubWebhookInstallationEvent {
  schemaVersion: 1;
  deliveryId: WebhookDeliveryId;
  eventName: "installation";
  action: WebhookAction;
  receivedAt: WebhookReceivedAt;
  data: GithubWebhookInstallationData;
}
export interface GithubWebhookInstallationRepositoriesEvent {
  schemaVersion: 1;
  deliveryId: WebhookDeliveryId;
  eventName: "installation_repositories";
  action: WebhookAction;
  receivedAt: WebhookReceivedAt;
  data: GithubWebhookInstallationRepositoriesData;
}
export interface GithubWebhookRepositoryEvent {
  schemaVersion: 1;
  deliveryId: WebhookDeliveryId;
  eventName: "repository";
  action: WebhookAction;
  receivedAt: WebhookReceivedAt;
  data: GithubWebhookRepositoryData;
}
export interface GithubWebhookMemberEvent {
  schemaVersion: 1;
  deliveryId: WebhookDeliveryId;
  eventName: "member";
  action: WebhookAction;
  receivedAt: WebhookReceivedAt;
  data: GithubWebhookMemberData;
}
export interface GithubWebhookMembershipEvent {
  schemaVersion: 1;
  deliveryId: WebhookDeliveryId;
  eventName: "membership";
  action: WebhookAction;
  receivedAt: WebhookReceivedAt;
  data: GithubWebhookMembershipData;
}
export interface GithubWebhookOrganizationEvent {
  schemaVersion: 1;
  deliveryId: WebhookDeliveryId;
  eventName: "organization";
  action: WebhookAction;
  receivedAt: WebhookReceivedAt;
  data: GithubWebhookOrganizationData;
}
export interface GithubWebhookTeamEvent {
  schemaVersion: 1;
  deliveryId: WebhookDeliveryId;
  eventName: "team";
  action: WebhookAction;
  receivedAt: WebhookReceivedAt;
  data: GithubWebhookTeamData;
}
export interface GithubWebhookIgnoredEvent {
  schemaVersion: 1;
  deliveryId: WebhookDeliveryId;
  /**
   * Cualquier nombre de evento fuera de los ocho que tienen variante propia.
   */
  eventName: string;
  action: WebhookAction;
  receivedAt: WebhookReceivedAt;
  data: GithubWebhookIgnoredData;
}
export interface GitHubWebhookAcceptedResponse {
  deliveryId: WebhookDeliveryId;
  accepted: true;
  duplicate: boolean;
  analysisRunId: string | null;
}

// ===== realtime-events.schema.json =====
/**
 * Acknowledgment de 'subscribe:*' con exactamente tres resultados: suscrito; verificación no disponible (reintentable); sin visibilidad o id inexistente (sin distinguirlos).
 */
export type SubscribeAck = {
  subscribed: boolean;
  code: "GITHUB_VERIFICATION_UNAVAILABLE" | null;
  retryable: boolean;
} & SubscribeAck1;
export type SubscribeAck1 =
  | {
      subscribed?: true;
      code?: null;
      retryable?: false;
    }
  | {
      subscribed?: false;
      code?: "GITHUB_VERIFICATION_UNAVAILABLE";
      retryable?: true;
    }
  | {
      subscribed?: false;
      code?: null;
      retryable?: false;
    };
export type AnalysisRunStatus =
  | "QUEUED"
  | "PROCESSING"
  | "ACTION_REQUIRED"
  | "SUCCESS"
  | "BEHAVIORAL_MISMATCH"
  | "TECHNICAL_GENERATION_FAILURE"
  | "INFRASTRUCTURE_FAILURE"
  | "BASELINE_FAILED"
  | "NO_ADDITIONAL_TESTS_REQUIRED"
  | "NO_TEST_RELEVANT_CHANGES"
  | "OBSOLETE";

/**
 * Body de 'subscribe:project-version' y 'unsubscribe:project-version'.
 */
export interface SubscribeProjectVersionPayload {
  /**
   * UUID.
   */
  projectVersionId: string;
}
/**
 * Body de 'subscribe:analysis-run' y 'unsubscribe:analysis-run'.
 */
export interface SubscribeAnalysisRunPayload {
  /**
   * UUID.
   */
  analysisRunId: string;
}
/**
 * Body de 'subscribe:experiment' y 'unsubscribe:experiment'.
 */
export interface SubscribeExperimentPayload {
  /**
   * UUID.
   */
  experimentId: string;
}
export interface PullRequestRefResponse {
  repositoryId: string;
  repositoryName: string;
  number: number;
  title: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  draft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  actorLogin: string | null;
}
export interface AnalysisSymbolResponse {
  language: "TYPESCRIPT" | "PHP";
  kind: "CLASS" | "METHOD" | "FUNCTION" | "INTERFACE" | "TYPE" | "TRAIT" | "ENUM";
  qualifiedName: string;
  /**
   * POSIX, relativo, normalizado y sin traversal (sin barra inicial, sin '..', sin '\').
   */
  filePath: string;
  changeKind: "DIRECTLY_CHANGED" | "POTENTIALLY_IMPACTED";
}
/**
 * Payload de 'analysis-run:update'. Mismo DTO que GET /analysis-runs/{id} (INTEROP §6.10).
 */
export interface AnalysisRunDetailResponse {
  /**
   * UUID.
   */
  id: string;
  /**
   * UUID.
   */
  projectId: string;
  pullRequest: PullRequestRefResponse;
  status: AnalysisRunStatus;
  current: boolean;
  actionRequiredCount: number;
  generatedTestsCount: number;
  /**
   * ISO 8601 UTC.
   */
  createdAt: string;
  /**
   * ISO 8601 UTC.
   */
  updatedAt: string;
  completedAt: string | null;
  attemptCount: number;
  indexMode: "BOOTSTRAP" | "INCREMENTAL";
  changesetBaseSha: string;
  changesetHeadSha: string;
  indexDeltaBaseSha: string | null;
  symbols: AnalysisSymbolResponse[];
  functionalBehaviorValidated: boolean;
  resultSummary: string | null;
  detailsUrl: string;
}
export interface ExperimentModelConfigResponse {
  provider: string;
  model: string;
  modelVersion: string | null;
  reasoningEffort: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
}
export interface ExperimentBudgetResponse {
  toolCallCap: number;
  contextTokenBudget: number;
  maxDurationMs: number;
}
/**
 * Payload de 'experiment:update'. Mismo DTO que GET /experiments/{id} (INTEROP §6.5, presentador único experiment-status.presenter).
 */
export interface ExperimentStatusResponse {
  /**
   * UUID.
   */
  id: string;
  /**
   * UUID.
   */
  projectId: string;
  /**
   * UUID.
   */
  projectVersionId: string;
  /**
   * UUID.
   */
  targetId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  completedRepetitions: number;
  totalRepetitions: number;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  model: ExperimentModelConfigResponse | null;
  budget: ExperimentBudgetResponse | null;
  executionProfile: string | null;
  runnerHint: string | null;
  randomizationSeed: string | null;
}

// ===== sandbox-execution.schema.json =====
export type SandboxStage = "PREPARING" | "INSTALLING_DEPENDENCIES" | "COMPILING" | "RUNNING_TESTS" | "FINALIZING";
export type SandboxExecutionStatus =
  | "PENDING"
  | "PREPARING"
  | "INSTALLING_DEPENDENCIES"
  | "COMPILING"
  | "RUNNING_TESTS"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED"
  | "TIMED_OUT";
export type TerminalStatus = "COMPLETED" | "FAILED" | "TIMED_OUT";
export type ExecutionScope = "TARGET" | "BATCH";
export type ExecutionPhase = "BASELINE" | "GENERATED_TESTS";
export type ExecutionInputRole = "PROJECT_SNAPSHOT" | "GENERATED_ARTIFACT";
export type ArtifactType = "CREATED" | "MODIFIED";

export interface EphemeralDownloadRef {
  role: ExecutionInputRole;
  /**
   * URL HTTPS firmada; capacidad temporal y sensible.
   */
  url: string;
  /**
   * ISO 8601 UTC.
   */
  expiresAt: string;
  /**
   * 64 caracteres hexadecimales minúsculos.
   */
  sha256: string;
  sizeBytes: number;
}
export interface ExecutionArtifactInput {
  /**
   * UUID.
   */
  artifactId: string;
  /**
   * POSIX, relativo, normalizado y sin traversal (sin barra inicial, sin '..', sin '\').
   */
  relativePath: string;
  artifactType: ArtifactType;
  download: EphemeralDownloadRef1;
}
/**
 * role GENERATED_ARTIFACT.
 */
export interface EphemeralDownloadRef1 {
  role: ExecutionInputRole;
  /**
   * URL HTTPS firmada; capacidad temporal y sensible.
   */
  url: string;
  /**
   * ISO 8601 UTC.
   */
  expiresAt: string;
  /**
   * 64 caracteres hexadecimales minúsculos.
   */
  sha256: string;
  sizeBytes: number;
}
export interface CreateSandboxExecutionRequest {
  /**
   * UUID.
   */
  requestId: string;
  /**
   * UUID.
   */
  testRunId: string;
  /**
   * UUID.
   */
  projectVersionId: string;
  snapshot: EphemeralDownloadRef2;
  /**
   * POSIX, relativo, normalizado y sin traversal (sin barra inicial, sin '..', sin '\').
   */
  projectRoot?: string;
  artifacts: ExecutionArtifactInput[];
  scope: ExecutionScope;
  /**
   * Items: UUID.
   */
  targetIds: string[];
  executionProfile: "NODE_TYPESCRIPT" | "PHP_LARAVEL_PHPUNIT";
  runnerHint: "JEST" | "VITEST" | "PHPUNIT";
  /**
   * Tolerancia transitoria (INTEROP-2.17 §7.2): puede omitirse y equivale a GENERATED_TESTS. Core aún no lo envía (brecha documentada en la feature 013, OC09) y un Sandbox anterior rechazaría el campo.
   */
  phase?: "BASELINE" | "GENERATED_TESTS";
}
/**
 * role PROJECT_SNAPSHOT.
 */
export interface EphemeralDownloadRef2 {
  role: ExecutionInputRole;
  /**
   * URL HTTPS firmada; capacidad temporal y sensible.
   */
  url: string;
  /**
   * ISO 8601 UTC.
   */
  expiresAt: string;
  /**
   * 64 caracteres hexadecimales minúsculos.
   */
  sha256: string;
  sizeBytes: number;
}
export interface SandboxExecutionAcceptedResponse {
  status: "PENDING";
  pollAfterMs: number;
  /**
   * UUID.
   */
  executionId: string;
  /**
   * UUID.
   */
  requestId: string;
  /**
   * UUID.
   */
  projectVersionId: string;
}
export interface SandboxExecutionStatusResponse {
  /**
   * UUID.
   */
  executionId: string;
  /**
   * UUID.
   */
  requestId: string;
  /**
   * UUID.
   */
  projectVersionId: string;
  status: SandboxExecutionStatus;
  stage: SandboxStage | null;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * ISO 8601 UTC.
   */
  createdAt: string;
  /**
   * ISO 8601 UTC.
   */
  updatedAt: string;
}
export interface TestCaseFact {
  suitePath: string | null;
  name: string;
  status: "PASSED" | "FAILED" | "SKIPPED" | "TODO";
  durationMs: number | null;
  errorMessage: string | null;
  /**
   * Aditivo 2026-10-09; null si el caso no falló. Un Sandbox anterior puede omitirlo.
   */
  failureKind?: ("ASSERTION" | "ERROR") | null;
}
export interface RunnerFacts {
  executionProfile: "NODE_TYPESCRIPT" | "PHP_LARAVEL_PHPUNIT";
  runner: "JEST" | "VITEST" | "PHPUNIT";
  compiled: boolean;
  executed: boolean;
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  testCases: TestCaseFact[];
  testCasesTruncated: boolean;
}
export interface StageDuration {
  stage: SandboxStage;
  durationMs: number;
  /**
   * ISO 8601 UTC.
   */
  startedAt?: string;
  /**
   * ISO 8601 UTC.
   */
  completedAt?: string;
}
export interface SandboxFailureFact {
  stage: SandboxStage;
  category:
    "COMPILATION" | "TEST_ASSERTION" | "TEST_RUNTIME" | "DEPENDENCY" | "CONFIGURATION" | "INFRASTRUCTURE" | "UNKNOWN";
  code: string;
  message: string;
}
export interface ExecutionEvidenceFact {
  kind: "COMPILER_STDOUT" | "COMPILER_STDERR" | "TEST_STDOUT" | "TEST_STDERR" | "RUNNER_REPORT";
  stage: SandboxStage;
  content: string;
  truncated: boolean;
  originalBytes: number | null;
}
export interface SandboxExecutionResultResponse {
  /**
   * UUID.
   */
  executionId: string;
  /**
   * UUID.
   */
  requestId: string;
  /**
   * UUID.
   */
  testRunId: string;
  /**
   * UUID.
   */
  projectVersionId: string;
  status: TerminalStatus;
  facts: RunnerFacts | null;
  failure: SandboxFailureFact | null;
  stageDurations: StageDuration[];
  /**
   * Items: UUID.
   */
  appliedArtifactIds: string[];
  evidence: ExecutionEvidenceFact[];
  /**
   * ISO 8601 UTC.
   */
  startedAt: string;
  /**
   * ISO 8601 UTC.
   */
  completedAt: string;
}
