import { describe, expect, it, vi } from 'vitest';
import { FunctionalContinuationJobHandler } from './functional-continuation-job.handler.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';
import { ANALYSIS_RUN_VALIDATION_JOB_TYPE } from '../validation/analysis-run-validation-job.handler.js';
import { AnalysisRunChecksService } from '../checks/analysis-run-checks.service.js';
import type { AnalysisRun } from '../generated/prisma/client.js';

function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    status: 'PROCESSING',
    ...overrides,
  } as AnalysisRun;
}

describe('FunctionalContinuationJobHandler', () => {
  function setup() {
    const jobsService = { registerHandler: vi.fn(), enqueue: vi.fn() };
    const analysisRunsRepository = { findById: vi.fn() };
    const analysisRunsService = {
      markActionRequiredFromSystem: vi.fn().mockImplementation(async (run: AnalysisRun) => ({
        ...run,
        status: 'ACTION_REQUIRED',
      })),
    };
    const functionalContextEvaluatorService = { evaluate: vi.fn() };
    const analysisRunChecksService = { publishForRun: vi.fn().mockResolvedValue(undefined) };

    const handler = new FunctionalContinuationJobHandler(
      jobsService as unknown as JobsService,
      analysisRunsRepository as unknown as AnalysisRunsRepository,
      analysisRunsService as unknown as AnalysisRunsService,
      functionalContextEvaluatorService as unknown as FunctionalContextEvaluatorService,
      analysisRunChecksService as unknown as AnalysisRunChecksService,
    );

    return {
      handler,
      jobsService,
      analysisRunsRepository,
      analysisRunsService,
      functionalContextEvaluatorService,
      analysisRunChecksService,
    };
  }

  it('registers itself as a job handler on module init', () => {
    const { handler, jobsService } = setup();
    handler.onModuleInit();
    expect(jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('is a no-op when the run does not exist', async () => {
    const { handler, analysisRunsRepository, functionalContextEvaluatorService } = setup();
    analysisRunsRepository.findById.mockResolvedValue(null);

    await handler.handle({ analysisRunId: 'missing' });

    expect(functionalContextEvaluatorService.evaluate).not.toHaveBeenCalled();
  });

  it('is a no-op when the run is not PROCESSING', async () => {
    const { handler, analysisRunsRepository, functionalContextEvaluatorService } = setup();
    analysisRunsRepository.findById.mockResolvedValue(buildRun({ status: 'ACTION_REQUIRED' }));

    await handler.handle({ analysisRunId: 'run-1' });

    expect(functionalContextEvaluatorService.evaluate).not.toHaveBeenCalled();
  });

  it('marks ACTION_REQUIRED again when the evaluator finds a new uncovered symbol', async () => {
    const { handler, analysisRunsRepository, analysisRunsService, functionalContextEvaluatorService, analysisRunChecksService } =
      setup();
    const run = buildRun();
    analysisRunsRepository.findById.mockResolvedValue(run);
    functionalContextEvaluatorService.evaluate.mockResolvedValue({ actionRequired: true });

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisRunsService.markActionRequiredFromSystem).toHaveBeenCalledWith(run);
    expect(analysisRunChecksService.publishForRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACTION_REQUIRED' }),
    );
  });

  it('enqueues the Validation job when there is enough functional context now', async () => {
    const { handler, analysisRunsRepository, analysisRunsService, functionalContextEvaluatorService, jobsService } =
      setup();
    analysisRunsRepository.findById.mockResolvedValue(buildRun());
    functionalContextEvaluatorService.evaluate.mockResolvedValue({ actionRequired: false });

    await handler.handle({ analysisRunId: 'run-1' });

    expect(analysisRunsService.markActionRequiredFromSystem).not.toHaveBeenCalled();
    expect(jobsService.enqueue).toHaveBeenCalledWith(ANALYSIS_RUN_VALIDATION_JOB_TYPE, { analysisRunId: 'run-1' });
  });
});
