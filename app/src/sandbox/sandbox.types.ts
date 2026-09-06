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
}

export interface RunnerFacts {
  runner: 'JEST' | 'VITEST';
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
}

export interface SandboxArtifactInput {
  artifactId: string;
  relativePath: string;
  artifactType: 'CREATED' | 'MODIFIED';
  content: Buffer;
}

export interface SandboxExecutionRequest {
  testRunId: string;
  projectVersionId: string;
  snapshotKey: string;
  snapshotBuffer: Buffer;
  artifacts: SandboxArtifactInput[];
  scope: 'TARGET' | 'BATCH';
  targetIds: string[];
  runnerHint: 'JEST' | 'VITEST';
}
