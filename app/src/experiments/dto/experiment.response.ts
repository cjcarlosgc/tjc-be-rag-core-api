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

/** INTEROP-2.7 §6.5.1: configuración efectiva del modelo, común a ambos brazos. */
export interface ExperimentModelConfigResponse {
  provider: string;
  model: string;
  modelVersion: string | null;
  reasoningEffort: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
}

/** INTEROP-2.7 §6.5.1: presupuesto resuelto al crear el experimento. */
export interface ExperimentBudgetResponse {
  toolCallCap: number;
  contextTokenBudget: number;
  maxDurationMs: number;
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
  /** null en corridas previas a WI-CORE-023/025. */
  model: ExperimentModelConfigResponse | null;
  budget: ExperimentBudgetResponse | null;
  executionProfile: string | null;
  runnerHint: string | null;
  randomizationSeed: string | null;
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
  /** Campos de modelo desde modelConfig del experimento; null en corridas previas. */
  modelVersion: string | null;
  reasoningEffort: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
}

export interface ExperimentRepetitionResponse {
  repetition: 1 | 2 | 3;
  strategy: ExperimentStrategy;
  valid: boolean;
  failureType: FailureType;
  errorSummary: string | null;
  generationDurationMs: number;
  /** null cuando el Sandbox no ejecutó o en corridas previas; nunca 0 inventado. */
  executionDurationMs: number | null;
  totalDurationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  /** null en filas previas a WI-CORE-025. */
  pairId: string | null;
  pairPosition: 1 | 2 | null;
  /** Intento vigente del slot lógico: 1 o 2. */
  attempt: number;
  technicallyEvaluable: boolean;
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
