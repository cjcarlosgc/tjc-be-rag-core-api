import type { ExperimentRun } from '../generated/prisma/client.js';
import type {
  ExperimentBudgetResponse,
  ExperimentModelConfigResponse,
  ExperimentStatusResponse,
} from './dto/experiment.response.js';

/**
 * Presentador único del estado de un experimento (`GET /experiments/{id}`, `INTEROP-2.18` §6.6 `experiment:update`):
 * el evento de tiempo real y la respuesta HTTP usan EXACTAMENTE este mapeo, sin campos fuera del DTO.
 */
export function toExperimentStatusResponse(run: ExperimentRun): ExperimentStatusResponse {
  return {
    id: run.id,
    projectId: run.projectId,
    projectVersionId: run.projectVersionId,
    targetId: run.targetId,
    status: run.status,
    completedRepetitions: run.completedRepetitions,
    totalRepetitions: run.totalRepetitions,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    model: toModelConfigResponse(run.modelConfig),
    budget: toBudgetResponse(run.budget),
    executionProfile: run.executionProfile,
    runnerHint: run.runnerHint,
    randomizationSeed: run.randomizationSeed,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Filas previas a WI-CORE-023 no tienen modelConfig: se devuelve null, nunca valores inventados. */
export function toModelConfigResponse(raw: unknown): ExperimentModelConfigResponse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const provider = asString(record.provider);
  const model = asString(record.model);
  if (provider === null || model === null) return null;

  return {
    provider,
    model,
    modelVersion: asString(record.modelVersion),
    reasoningEffort: asString(record.reasoningEffort),
    temperature: asFiniteNumber(record.temperature),
    maxOutputTokens: asFiniteNumber(record.maxOutputTokens),
  };
}

/** Presupuesto persistido al crear; null en corridas previas. */
function toBudgetResponse(raw: unknown): ExperimentBudgetResponse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const toolCallCap = asFiniteNumber(record.toolCallCap);
  const contextTokenBudget = asFiniteNumber(record.contextTokenBudget);
  const maxDurationMs = asFiniteNumber(record.maxDurationMs);
  if (toolCallCap === null || contextTokenBudget === null || maxDurationMs === null) return null;

  return { toolCallCap, contextTokenBudget, maxDurationMs };
}

