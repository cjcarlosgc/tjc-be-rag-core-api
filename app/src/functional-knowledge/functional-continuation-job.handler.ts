import { Injectable, OnModuleInit } from '@nestjs/common';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';
import { ANALYSIS_RUN_VALIDATION_JOB_TYPE } from '../validation/analysis-run-validation-job.handler.js';
import { AnalysisRunChecksService } from '../checks/analysis-run-checks.service.js';

export interface FunctionalContinuationJobPayload {
  analysisRunId: string;
}

export const FUNCTIONAL_CONTINUATION_JOB_TYPE = 'functional-continuation';

/**
 * HU36: reevalúa la cobertura de conocimiento funcional de un Run tras
 * `requestContinuation` (ACTION_REQUIRED -> PROCESSING), reutilizando los
 * símbolos ya persistidos -no re-materializa el snapshot-. Si vuelve a
 * faltar contexto, regresa a ACTION_REQUIRED con la siguiente pregunta.
 *
 * Si ya hay contexto suficiente, encola el job de Validation (plan.md #6:
 * generación+Sandbox+clasificación) para que el Run avance de verdad.
 */
@Injectable()
export class FunctionalContinuationJobHandler implements JobHandler<FunctionalContinuationJobPayload>, OnModuleInit {
  readonly type = FUNCTIONAL_CONTINUATION_JOB_TYPE;

  constructor(
    private readonly jobsService: JobsService,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly functionalContextEvaluatorService: FunctionalContextEvaluatorService,
    private readonly analysisRunChecksService: AnalysisRunChecksService,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: FunctionalContinuationJobPayload): Promise<void> {
    const run = await this.analysisRunsRepository.findById(payload.analysisRunId);

    if (!run || run.status !== 'PROCESSING') {
      return;
    }

    const evaluation = await this.functionalContextEvaluatorService.evaluate(run);

    if (evaluation.actionRequired) {
      const actionRequired = await this.analysisRunsService.markActionRequiredFromSystem(run);
      await this.analysisRunChecksService.publishForRun(actionRequired);
      return;
    }

    await this.jobsService.enqueue(ANALYSIS_RUN_VALIDATION_JOB_TYPE, { analysisRunId: run.id });
  }
}
