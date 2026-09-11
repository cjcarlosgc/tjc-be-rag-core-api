export type ExperimentStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ExperimentStrategy = 'RAG' | 'GENERALIST_AGENT';

export type FailureType =
  | 'NONE'
  | 'COMPILATION'
  | 'TEST_ASSERTION'
  | 'TEST_RUNTIME'
  | 'DEPENDENCY'
  | 'CONFIGURATION'
  | 'INFRASTRUCTURE'
  | 'UNKNOWN';

export interface ExperimentAcceptedResponse {
  experimentId: string;
  projectVersionId: string;
  status: 'PENDING';
  pollAfterMs: number;
}

export interface ExperimentStatusResponse {
  id: string;
  projectId: string;
  projectVersionId: string;
  targetId: string;
  status: ExperimentStatus;
  completedRepetitions: number;
  totalRepetitions: number;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StrategyMetricsResponse {
  strategy: ExperimentStrategy;
  validRate: number;
  compilationRate: number;
  executionRate: number;
  passedRate: number;
  generationDurationMs: number;
  executionDurationMs: number;
  totalDurationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  retrievedChunks: number | null;
  selectedChunks: number | null;
  contextTokens: number | null;
  toolCalls: number | null;
  filesInspected: number | null;
  failures: Partial<Record<FailureType, number>>;
}

export interface ExperimentRepetitionResponse {
  repetition: 1 | 2 | 3;
  strategy: ExperimentStrategy;
  valid: boolean;
  failureType: FailureType;
  errorSummary: string | null;
  generationDurationMs: number;
  executionDurationMs: number;
  totalDurationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
}

export interface ExperimentResultsResponse {
  experimentId: string;
  projectVersionId: string;
  targetId: string;
  repetitionsPerStrategy: 3;
  strategies: StrategyMetricsResponse[];
  repetitions: ExperimentRepetitionResponse[];
  completedAt: string;
}
