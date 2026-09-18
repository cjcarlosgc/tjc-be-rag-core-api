import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';

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
 * Si ya hay contexto suficiente, el Run queda en PROCESSING: la generación
 * técnica (retrieval->generate->Sandbox->classify, HU37+) todavía no existe
 * -mismo hueco preexistente de HU33/34 cuando el CHANGESET sí toca fuente-,
 * no se inventa un status de cierre falso.
 */
@Injectable()
export class FunctionalContinuationJobHandler implements JobHandler<FunctionalContinuationJobPayload>, OnModuleInit {
  readonly type = FUNCTIONAL_CONTINUATION_JOB_TYPE;
  private readonly logger = new Logger(FunctionalContinuationJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly functionalContextEvaluatorService: FunctionalContextEvaluatorService,
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
      await this.analysisRunsService.markActionRequiredFromSystem(run);
      return;
    }

    this.logger.debug(
      `AnalysisRun ${run.id} tiene contexto funcional suficiente; sin pipeline de generación todavía, queda en PROCESSING.`,
    );
  }
}
