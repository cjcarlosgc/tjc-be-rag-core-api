import type { GenerationMode } from './generation-mode.js';

export interface TestRunAcceptedResponse {
  runId: string;
  projectId: string;
  projectVersionId: string;
  status: 'PENDING';
  pollAfterMs: number;
}

export type TestRunStatus =
  | 'PENDING'
  | 'RESOLVING_TARGETS'
  | 'PROCESSING_TARGETS'
  | 'BATCH_VALIDATING'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED';

export interface TestRunStatusResponse {
  id: string;
  projectId: string;
  projectVersionId: string;
  mode: GenerationMode;
  status: TestRunStatus;
  totalTargets: number | null;
  processedTargets: number;
  validTargets: number;
  invalidTargets: number;
  failedTargets: number;
  reason: 'NO_MISSING_TARGETS' | null;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FailureType =
  | 'NONE'
  | 'COMPILATION'
  | 'TEST_ASSERTION'
  | 'TEST_RUNTIME'
  | 'DEPENDENCY'
  | 'CONFIGURATION'
  | 'INFRASTRUCTURE'
  | 'UNKNOWN';

export interface ValidationResponse {
  compiled: boolean;
  executed: boolean;
  passed: boolean;
  valid: boolean;
  failureType: FailureType;
  errorSummary: string | null;
  evidenceIds: string[];
}

export interface TargetRunResultResponse {
  targetId: string;
  filePath: string;
  symbolName: string;
  methodName: string | null;
  targetType: 'CLASS' | 'METHOD' | 'FUNCTION';
  status: 'VALID' | 'INVALID' | 'FAILED' | 'SKIPPED';
  artifactIds: string[];
  validation: ValidationResponse | null;
}

export interface TestRunResultsResponse {
  id: string;
  projectId: string;
  projectVersionId: string;
  mode: GenerationMode;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  reason: 'NO_MISSING_TARGETS' | null;
  totalTargets: number;
  validTargets: number;
  invalidTargets: number;
  failedTargets: number;
  targets: TargetRunResultResponse[];
  completedAt: string | null;
}
