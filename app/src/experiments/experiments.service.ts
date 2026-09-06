import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { TestTargetsRepository } from '../project-versions/persistence/test-targets.repository.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { ProjectVersionStatus, ExperimentStatus as PrismaExperimentStatus } from '../generated/prisma/enums.js';
import { ExperimentRunsRepository } from './persistence/experiment-runs.repository.js';
import { EXPERIMENT_JOB_TYPE, type ExperimentJobPayload } from './experiment-job.handler.js';
import type { CreateExperimentDto } from './dto/create-experiment.dto.js';
import type {
  ExperimentAcceptedResponse,
  ExperimentResultsResponse,
  ExperimentStatusResponse,
  FailureType,
  StrategyMetricsResponse,
} from './dto/experiment.response.js';
import type { ExperimentRepetition } from '../generated/prisma/client.js';

const DEFAULT_POLL_AFTER_MS = 1500;
const TOTAL_REPETITIONS = 6;
const STRATEGIES = ['RAG', 'GENERALIST_AGENT'] as const;

function mean(values: Array<number | null>): number | null {
  const nonNull = values.filter((value): value is number => value !== null);
  return nonNull.length > 0 ? nonNull.reduce((sum, value) => sum + value, 0) / nonNull.length : null;
}

function rate(repetitions: ExperimentRepetition[], predicate: (r: ExperimentRepetition) => boolean): number {
  return repetitions.length > 0 ? repetitions.filter(predicate).length / repetitions.length : 0;
}

@Injectable()
export class ExperimentsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly testTargetsRepository: TestTargetsRepository,
    private readonly experimentRunsRepository: ExperimentRunsRepository,
    private readonly jobsService: JobsService,
    private readonly configService: ConfigService,
  ) {}

  async createRun(dto: CreateExperimentDto): Promise<ExperimentAcceptedResponse> {
    const project = await this.projectsRepository.findById(dto.projectId);

    if (!project) {
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `No existe el proyecto ${dto.projectId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (await this.projectVersionsRepository.hasActiveVersion(dto.projectId)) {
      throw new AppException(
        ErrorCode.PROJECT_INDEXING_IN_PROGRESS,
        'El proyecto tiene una indexación en curso; espera a que termine antes de experimentar.',
        HttpStatus.CONFLICT,
      );
    }

    if (!project.currentVersionId) {
      throw new AppException(
        ErrorCode.PROJECT_NOT_READY,
        'El proyecto todavía no tiene una versión indexada exitosamente.',
        HttpStatus.CONFLICT,
      );
    }

    const version = await this.projectVersionsRepository.findById(project.currentVersionId);

    if (!version || version.status !== ProjectVersionStatus.COMPLETED) {
      throw new AppException(
        ErrorCode.ANALYSIS_NOT_FINISHED,
        'La versión actual del proyecto no terminó de analizarse.',
        HttpStatus.CONFLICT,
      );
    }

    const target = await this.testTargetsRepository.findById(dto.targetId);

    if (!target) {
      throw new AppException(
        ErrorCode.UNRESOLVABLE_TARGET,
        `No existe el target ${dto.targetId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (target.targetType === 'CLASS') {
      throw new AppException(
        ErrorCode.INVALID_GENERATION_TARGET,
        'El experimento requiere un target METHOD o FUNCTION.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const projectVersionId = project.currentVersionId;
    const run = await this.experimentRunsRepository.create({
      projectId: dto.projectId,
      projectVersionId,
      targetId: dto.targetId,
      totalRepetitions: TOTAL_REPETITIONS,
    });

    const payload: ExperimentJobPayload = {
      experimentId: run.id,
      projectId: dto.projectId,
      projectVersionId,
      targetId: dto.targetId,
    };

    await this.jobsService.enqueue(EXPERIMENT_JOB_TYPE, { ...payload });

    return {
      experimentId: run.id,
      projectVersionId,
      status: 'PENDING',
      pollAfterMs: this.configService.get<number>('INDEXING_POLL_AFTER_MS', DEFAULT_POLL_AFTER_MS),
    };
  }

  async getStatus(experimentId: string): Promise<ExperimentStatusResponse> {
    const run = await this.requireRun(experimentId);

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
    };
  }

  async getResults(experimentId: string): Promise<ExperimentResultsResponse> {
    const run = await this.requireRun(experimentId);

    if (run.status !== PrismaExperimentStatus.COMPLETED && run.status !== PrismaExperimentStatus.FAILED) {
      throw new AppException(
        ErrorCode.EXPERIMENT_NOT_FINISHED,
        'El experimento todavía no terminó.',
        HttpStatus.CONFLICT,
      );
    }

    const repetitions = await this.experimentRunsRepository.findRepetitions(experimentId);

    return {
      experimentId: run.id,
      projectVersionId: run.projectVersionId,
      targetId: run.targetId,
      repetitionsPerStrategy: 3,
      strategies: STRATEGIES.map((strategy) =>
        this.aggregateStrategy(
          strategy,
          repetitions.filter((repetition) => repetition.strategy === strategy),
        ),
      ),
      repetitions: repetitions.map((repetition) => ({
        repetition: repetition.repetition as 1 | 2 | 3,
        strategy: repetition.strategy,
        valid: repetition.valid ?? false,
        failureType: (repetition.failureType ?? 'UNKNOWN') as FailureType,
        generationDurationMs: repetition.generationDurationMs ?? 0,
        executionDurationMs: repetition.executionDurationMs ?? 0,
        totalDurationMs: repetition.totalDurationMs ?? 0,
        inputTokens: repetition.inputTokens,
        outputTokens: repetition.outputTokens,
        totalTokens: repetition.totalTokens,
        estimatedCost: repetition.estimatedCost,
      })),
      completedAt: (run.completedAt ?? new Date()).toISOString(),
    };
  }

  private aggregateStrategy(
    strategy: 'RAG' | 'GENERALIST_AGENT',
    repetitions: ExperimentRepetition[],
  ): StrategyMetricsResponse {
    const failures: Partial<Record<FailureType, number>> = {};

    for (const repetition of repetitions) {
      if (repetition.failureType) {
        const key = repetition.failureType as FailureType;
        failures[key] = (failures[key] ?? 0) + 1;
      }
    }

    return {
      strategy,
      validRate: rate(repetitions, (r) => r.valid === true),
      compilationRate: rate(repetitions, (r) => r.compiled === true),
      executionRate: rate(repetitions, (r) => r.executed === true),
      passedRate: rate(repetitions, (r) => r.passed === true),
      generationDurationMs: Math.round(mean(repetitions.map((r) => r.generationDurationMs)) ?? 0),
      executionDurationMs: Math.round(mean(repetitions.map((r) => r.executionDurationMs)) ?? 0),
      totalDurationMs: Math.round(mean(repetitions.map((r) => r.totalDurationMs)) ?? 0),
      inputTokens: roundOrNull(mean(repetitions.map((r) => r.inputTokens))),
      outputTokens: roundOrNull(mean(repetitions.map((r) => r.outputTokens))),
      totalTokens: roundOrNull(mean(repetitions.map((r) => r.totalTokens))),
      estimatedCost: mean(repetitions.map((r) => r.estimatedCost)),
      retrievedChunks: roundOrNull(mean(repetitions.map((r) => r.retrievedChunks))),
      selectedChunks: roundOrNull(mean(repetitions.map((r) => r.selectedChunks))),
      contextTokens: roundOrNull(mean(repetitions.map((r) => r.contextTokens))),
      toolCalls: roundOrNull(mean(repetitions.map((r) => r.toolCalls))),
      filesInspected: roundOrNull(mean(repetitions.map((r) => r.filesInspected))),
      failures,
    };
  }

  private async requireRun(experimentId: string) {
    const run = await this.experimentRunsRepository.findById(experimentId);

    if (!run) {
      throw new AppException(
        ErrorCode.EXPERIMENT_NOT_FOUND,
        `No existe el experimento ${experimentId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    return run;
  }
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}
