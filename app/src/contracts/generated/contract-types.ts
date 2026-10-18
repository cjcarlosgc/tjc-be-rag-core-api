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
   * Código estable en UPPER_SNAKE_CASE.
   */
  code: string;
  /**
   * Mensaje neutral; no incluye tokens, secretos, URLs firmadas ni texto crudo de terceros.
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
   * Opcional. Lo declaran los servicios cuyo contrato distingue reintentos (p. ej. GitHub Integration, GH-INTEROP). Ausente = el consumidor no debe asumir reintento.
   */
  retryable?: boolean;
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
