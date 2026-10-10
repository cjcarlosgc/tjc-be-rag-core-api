export type SandboxStage =
  | 'PREPARING'
  | 'INSTALLING_DEPENDENCIES'
  | 'COMPILING'
  | 'RUNNING_TESTS'
  | 'FINALIZING';

export type SandboxExecutionStatus = 'PENDING' | SandboxStage | 'COMPLETED' | 'FAILED' | 'TIMED_OUT';

export interface TestCaseFact {
  suitePath: string | null;
  name: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'TODO';
  durationMs: number | null;
  errorMessage: string | null;
  /** DEC-PHP-GEN-002: ausente en Sandboxes anteriores; `ERROR` = fallo técnico (clase/método inexistente, excepción). */
  failureKind?: 'ASSERTION' | 'ERROR' | null;
}

export interface RunnerFacts {
  runner: 'JEST' | 'VITEST' | 'PHPUNIT';
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

export type SandboxFailureCategory =
  | 'COMPILATION'
  | 'TEST_ASSERTION'
  | 'TEST_RUNTIME'
  | 'DEPENDENCY'
  | 'CONFIGURATION'
  | 'INFRASTRUCTURE'
  | 'UNKNOWN';

export interface SandboxFailureFact {
  stage: SandboxStage;
  category: SandboxFailureCategory;
  code: string;
  message: string;
}

export interface StageDuration {
  stage: SandboxStage;
  durationMs: number;
}

export interface SandboxExecutionResult {
  status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT';
  facts: RunnerFacts | null;
  failure: SandboxFailureFact | null;
  stageDurations: StageDuration[];
  /** WI-CORE-026: identificador que devolvió el Sandbox al aceptar la ejecución (`POST /executions`). */
  executionId: string;
  /** Perfil con el que se ejecutó: el persistido en la petición o el derivado de `runnerHint`. */
  executionProfile: ExecutionProfile;
}

export interface SandboxArtifactInput {
  artifactId: string;
  relativePath: string;
  artifactType: 'CREATED' | 'MODIFIED';
  content: Buffer;
}

export type ExecutionProfile = 'NODE_TYPESCRIPT' | 'PHP_LARAVEL_PHPUNIT';

export interface SandboxExecutionRequest {
  requestId: string;
  testRunId: string;
  projectVersionId: string;
  snapshotKey: string;
  snapshotBuffer: Buffer;
  artifacts: SandboxArtifactInput[];
  scope: 'TARGET' | 'BATCH';
  targetIds: string[];
  runnerHint: 'JEST' | 'VITEST' | 'PHPUNIT';
  /** Perfil persistido al crear el experimento (WI-CORE-025); si se omite se deriva de runnerHint. */
  executionProfile?: ExecutionProfile;
}
