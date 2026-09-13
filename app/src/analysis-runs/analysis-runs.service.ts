import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AnalysisRunsRepository,
  type CreateAnalysisRunInput,
} from './analysis-runs.repository.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { AnalysisRun, AnalysisRunStatus } from '../generated/prisma/client.js';
import type { Page } from '../common/dto/page.response.js';

export type AnalysisRunCompletionStatus =
  | 'SUCCESS'
  | 'BEHAVIORAL_MISMATCH'
  | 'TECHNICAL_GENERATION_FAILURE'
  | 'INFRASTRUCTURE_FAILURE'
  | 'BASELINE_FAILED'
  | 'NO_ADDITIONAL_TESTS_REQUIRED'
  | 'NO_TEST_RELEVANT_CHANGES';

export interface CompleteAnalysisRunPatch {
  resultSummary?: string;
  functionalBehaviorValidated?: boolean;
  generatedTestsCount?: number;
}

const DEFAULT_PAGE_LIMIT = 20;

/**
 * HU32: transiciones válidas del estado conceptual de un AnalysisRun
 * (`spec/contracts/system-contract.md`, "Estados conceptuales"). `OBSOLETE`
 * es alcanzable desde cualquier estado no terminal-obsoleto: un HEAD nuevo
 * invalida el Run vigente sin importar en qué status estuviera.
 */
const TRANSITIONS: Record<AnalysisRunStatus, AnalysisRunStatus[]> = {
  QUEUED: ['PROCESSING', 'OBSOLETE'],
  PROCESSING: [
    'ACTION_REQUIRED',
    'SUCCESS',
    'BEHAVIORAL_MISMATCH',
    'TECHNICAL_GENERATION_FAILURE',
    'INFRASTRUCTURE_FAILURE',
    'BASELINE_FAILED',
    'NO_ADDITIONAL_TESTS_REQUIRED',
    'NO_TEST_RELEVANT_CHANGES',
    'OBSOLETE',
  ],
  ACTION_REQUIRED: ['PROCESSING', 'OBSOLETE'],
  SUCCESS: ['OBSOLETE'],
  BEHAVIORAL_MISMATCH: ['OBSOLETE'],
  TECHNICAL_GENERATION_FAILURE: ['OBSOLETE'],
  INFRASTRUCTURE_FAILURE: ['OBSOLETE'],
  BASELINE_FAILED: ['OBSOLETE'],
  NO_ADDITIONAL_TESTS_REQUIRED: ['OBSOLETE'],
  NO_TEST_RELEVANT_CHANGES: ['OBSOLETE'],
  OBSOLETE: [],
};

@Injectable()
export class AnalysisRunsService {
  constructor(
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly projectsRepository: ProjectsRepository,
  ) {}

  /**
   * Crea el Run para un HEAD dado. Si ya existe un Run vigente para el mismo
   * PR con el mismo HEAD, lo devuelve sin duplicar (identidad lógica única
   * por Project/Repository/PR/HEAD). Si el HEAD difiere, obsoleta el Run
   * vigente anterior -sin importar su status- y crea uno nuevo.
   */
  async startRun(input: CreateAnalysisRunInput, ownerUserId: string): Promise<AnalysisRun> {
    await this.findProjectOrThrow(input.projectId, ownerUserId);

    const current = await this.analysisRunsRepository.findCurrentByPullRequest(
      input.projectId,
      input.repositoryId,
      input.prNumber,
    );

    if (current && current.headSha === input.headSha) {
      return current;
    }

    if (current) {
      await this.transitionTo(current, 'OBSOLETE', { current: false });
    }

    return this.analysisRunsRepository.create(input);
  }

  async requestContinuation(runId: string, ownerUserId: string): Promise<AnalysisRun> {
    const run = await this.findRunOrThrow(runId, ownerUserId);

    if (run.status !== 'ACTION_REQUIRED') {
      throw new AppException(
        ErrorCode.ANALYSIS_RUN_INVALID_TRANSITION,
        `El AnalysisRun "${run.id}" no puede continuar desde "${run.status}"; solo aplica desde ACTION_REQUIRED.`,
        HttpStatus.CONFLICT,
      );
    }

    return this.transitionTo(run, 'PROCESSING', { attemptCount: run.attemptCount + 1 });
  }

  async markActionRequired(runId: string, ownerUserId: string): Promise<AnalysisRun> {
    const run = await this.findRunOrThrow(runId, ownerUserId);
    return this.transitionTo(run, 'ACTION_REQUIRED', {
      actionRequiredCount: run.actionRequiredCount + 1,
    });
  }

  async completeRun(
    runId: string,
    status: AnalysisRunCompletionStatus,
    patch: CompleteAnalysisRunPatch,
    ownerUserId: string,
  ): Promise<AnalysisRun> {
    const run = await this.findRunOrThrow(runId, ownerUserId);
    return this.transitionTo(run, status, { ...patch, completedAt: new Date() });
  }

  async obsoleteRun(runId: string, ownerUserId: string): Promise<AnalysisRun> {
    const run = await this.findRunOrThrow(runId, ownerUserId);

    if (run.status === 'OBSOLETE') {
      return run;
    }

    return this.transitionTo(run, 'OBSOLETE', { current: false });
  }

  async getById(id: string, ownerUserId: string): Promise<AnalysisRun> {
    return this.findRunOrThrow(id, ownerUserId);
  }

  async listByProject(
    projectId: string,
    status: AnalysisRunStatus | undefined,
    limit: number | undefined,
    cursor: string | undefined,
    ownerUserId: string,
  ): Promise<Page<AnalysisRun>> {
    await this.findProjectOrThrow(projectId, ownerUserId);

    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const runs = await this.analysisRunsRepository.findByProjectForOwner(
      projectId,
      ownerUserId,
      take,
      status,
      cursor,
    );
    const hasMore = runs.length > take;
    const items = hasMore ? runs.slice(0, take) : runs;

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  private async transitionTo(
    run: AnalysisRun,
    status: AnalysisRunStatus,
    patch: Record<string, unknown>,
  ): Promise<AnalysisRun> {
    const allowed = TRANSITIONS[run.status];

    if (!allowed.includes(status)) {
      throw new AppException(
        ErrorCode.ANALYSIS_RUN_INVALID_TRANSITION,
        `El AnalysisRun "${run.id}" no puede pasar de "${run.status}" a "${status}".`,
        HttpStatus.CONFLICT,
      );
    }

    return this.analysisRunsRepository.update(run.id, { status, ...patch });
  }

  private async findProjectOrThrow(projectId: string, ownerUserId: string): Promise<void> {
    const project = await this.projectsRepository.findById(projectId, ownerUserId);

    if (!project) {
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `No existe un proyecto con id "${projectId}".`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async findRunOrThrow(id: string, ownerUserId: string): Promise<AnalysisRun> {
    const run = await this.analysisRunsRepository.findByIdForOwner(id, ownerUserId);

    if (!run) {
      throw new AppException(
        ErrorCode.ANALYSIS_RUN_NOT_FOUND,
        `No existe un AnalysisRun con id "${id}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return run;
  }
}
