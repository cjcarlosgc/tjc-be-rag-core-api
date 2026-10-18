import type {
  ExecutionProfile as ContractExecutionProfile,
  RunnerFacts as ContractRunnerFacts,
  SandboxExecutionStatus as ContractSandboxExecutionStatus,
  SandboxFailureFact as ContractSandboxFailureFact,
  SandboxStage as ContractSandboxStage,
  StageDuration as ContractStageDuration,
  TestCaseFact as ContractTestCaseFact,
} from '../contracts/generated/contract-types.js';

// Tipos de cable: se derivan del contrato generado (spec/contracts/schemas); no se redefinen a mano.
export type SandboxStage = ContractSandboxStage;
export type SandboxExecutionStatus = ContractSandboxExecutionStatus;
export type TestCaseFact = ContractTestCaseFact;
export type RunnerFacts = ContractRunnerFacts;
export type SandboxFailureFact = ContractSandboxFailureFact;
export type StageDuration = ContractStageDuration;
export type SandboxFailureCategory = SandboxFailureFact['category'];

/** Tipo de evidencia acotada que devuelve el Sandbox (contrato: `ExecutionEvidenceKind`). */
export type SandboxExecutionEvidenceKind =
  | 'COMPILER_STDOUT'
  | 'COMPILER_STDERR'
  | 'TEST_STDOUT'
  | 'TEST_STDERR'
  | 'RUNNER_REPORT';

/** Hecho de evidencia acotada (contrato: `ExecutionEvidenceFact`). Interno: no se expone en DTO ni INTEROP. */
export interface SandboxExecutionEvidenceFact {
  kind: SandboxExecutionEvidenceKind;
  stage: string | null;
  content: string;
  truncated: boolean;
  originalBytes: number | null;
}

export interface SandboxExecutionResult {
  status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT';
  facts: RunnerFacts | null;
  failure: SandboxFailureFact | null;
  stageDurations: StageDuration[];
  /** WI-CORE-060: evidencia acotada del Sandbox; opcional para mocks y Sandboxes anteriores. */
  evidence?: SandboxExecutionEvidenceFact[];
  /** WI-CORE-060: inicio del procesamiento en el Sandbox (ISO 8601), o null si no se informa. */
  startedAt?: string | null;
  /** WI-CORE-060: fin del procesamiento en el Sandbox (ISO 8601), o null si no se informa. */
  completedAt?: string | null;
  /** WI-CORE-026: identificador que devolvió el Sandbox al aceptar la ejecución (`POST /executions`). */
  executionId: string;
  /** Perfil con el que se ejecutó: el persistido en la petición o el derivado de `runnerHint`. */
  executionProfile: ExecutionProfile;
  /** WI-CORE-027: `requestId` de la petición aceptada (el mismo que se envió al Sandbox). */
  requestId: string;
  /** WI-CORE-027: `x-correlation-id` enviado en las llamadas de esta ejecución. */
  correlationId: string;
  /** WI-CORE-027: milisegundos desde el envío de `POST /executions` hasta el resultado obtenido. */
  durationMs: number;
}

export interface SandboxArtifactInput {
  artifactId: string;
  relativePath: string;
  artifactType: 'CREATED' | 'MODIFIED';
  content: Buffer;
}

export type ExecutionProfile = ContractExecutionProfile;

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
  /** INTEROP-2.8: raíz PHP congelada para esta ProjectVersion; omitida en ejecuciones legacy/Node. */
  projectRoot?: string;
  /** Perfil persistido al crear el experimento (WI-CORE-025); si se omite se deriva de runnerHint. */
  executionProfile?: ExecutionProfile;
}
