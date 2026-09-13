import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { JobsService } from '../jobs/jobs.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { ProjectVersionStatus, TestRunStatus } from '../generated/prisma/enums.js';
import { TestGenerationRunsRepository } from './persistence/test-generation-runs.repository.js';
import { TEST_GENERATION_JOB_TYPE } from './test-generation-job.handler.js';
import { RETRY_TARGET_JOB_TYPE } from './retry-target-job.handler.js';
import type { CreateTestRunDto } from './dto/create-test-run.dto.js';
import {
  toTestRunStatusResponse,
  type TargetRetryAcceptedResponse,
  type TargetRunResultResponse,
  type TestRunAcceptedResponse,
  type TestRunResultsResponse,
  type TestRunStatusResponse,
  type TestRunSummaryResponse,
} from './dto/test-run.response.js';
import type { Page } from '../common/dto/page.response.js';

const DEFAULT_POLL_AFTER_MS = 1500;
const DEFAULT_PAGE_LIMIT = 20;

@Injectable()
export class TestGenerationService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly testGenerationRunsRepository: TestGenerationRunsRepository,
    private readonly jobsService: JobsService,
    private readonly configService: ConfigService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async createRun(
    dto: CreateTestRunDto,
    idempotencyKey: string | undefined,
    ownerUserId: string,
  ): Promise<TestRunAcceptedResponse> {
    this.assertModeTargetIdShape(dto.mode, dto.targetId);

    const project = await this.projectsRepository.findById(dto.projectId, ownerUserId);

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
        'El proyecto tiene una indexación en curso; espera a que termine antes de generar pruebas.',
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

    const projectVersionId = project.currentVersionId;

    return this.idempotencyService.run({
      scope: 'TEST_RUN_CREATE',
      key: idempotencyKey,
      fingerprintInput: dto,
      create: async (tx) => {
        const run = await this.testGenerationRunsRepository.create(
          {
            projectId: dto.projectId,
            projectVersionId,
            mode: dto.mode,
            targetId: dto.targetId ?? null,
          },
          tx,
        );

        await this.jobsService.enqueue(
          TEST_GENERATION_JOB_TYPE,
          {
            testRunId: run.id,
            projectId: dto.projectId,
            projectVersionId,
            mode: dto.mode,
            targetId: dto.targetId ?? null,
          },
          tx,
        );

        return {
          operationId: run.id,
          response: {
            runId: run.id,
            projectId: dto.projectId,
            projectVersionId,
            status: 'PENDING' as const,
            pollAfterMs: this.configService.get<number>('INDEXING_POLL_AFTER_MS', DEFAULT_POLL_AFTER_MS),
          },
        };
      },
      rebuildResponse: async (operationId) => {
        const run = await this.testGenerationRunsRepository.findById(operationId);

        if (!run) {
          throw new AppException(
            ErrorCode.TEST_RUN_NOT_FOUND,
            `No existe el test run ${operationId}.`,
            HttpStatus.NOT_FOUND,
          );
        }

        return {
          runId: run.id,
          projectId: run.projectId,
          projectVersionId: run.projectVersionId,
          status: 'PENDING' as const,
          pollAfterMs: this.configService.get<number>('INDEXING_POLL_AFTER_MS', DEFAULT_POLL_AFTER_MS),
        };
      },
    });
  }

  async getStatus(runId: string, ownerUserId: string): Promise<TestRunStatusResponse> {
    return toTestRunStatusResponse(await this.requireRun(runId, ownerUserId));
  }

  async getResults(runId: string, ownerUserId: string): Promise<TestRunResultsResponse> {
    const run = await this.requireRun(runId, ownerUserId);

    if (
      run.status !== TestRunStatus.COMPLETED &&
      run.status !== TestRunStatus.PARTIAL &&
      run.status !== TestRunStatus.FAILED
    ) {
      throw new AppException(
        ErrorCode.TEST_RUN_NOT_FINISHED,
        'La generación todavía no terminó.',
        HttpStatus.CONFLICT,
      );
    }

    const targetResults = await this.testGenerationRunsRepository.findTargetResults(runId);
    const targets: TargetRunResultResponse[] = targetResults.map((result) => ({
      targetId: result.targetId,
      filePath: result.filePath,
      symbolName: result.symbolName,
      methodName: result.methodName,
      targetType: result.targetType,
      status: result.status,
      artifactIds: [],
      validation:
        result.status === 'SKIPPED'
          ? null
          : {
              compiled: result.compiled ?? false,
              executed: result.executed ?? false,
              passed: result.passed ?? false,
              valid: result.valid ?? false,
              failureType: (result.failureType ?? 'UNKNOWN') as ValidationFailureType,
              errorSummary: result.errorSummary,
              evidenceIds: [],
            },
    }));

    return {
      id: run.id,
      projectId: run.projectId,
      projectVersionId: run.projectVersionId,
      mode: run.mode,
      status: run.status as 'COMPLETED' | 'PARTIAL' | 'FAILED',
      reason: run.reason as 'NO_MISSING_TARGETS' | null,
      totalTargets: run.totalTargets ?? 0,
      validTargets: run.validTargets,
      invalidTargets: run.invalidTargets,
      failedTargets: run.failedTargets,
      targets,
      completedAt: run.completedAt?.toISOString() ?? null,
    };
  }

  async retryTarget(
    testRunId: string,
    targetId: string,
    idempotencyKey: string | undefined,
    ownerUserId: string,
  ): Promise<TargetRetryAcceptedResponse> {
    const run = await this.requireRun(testRunId, ownerUserId);

    if (
      run.status !== TestRunStatus.COMPLETED &&
      run.status !== TestRunStatus.PARTIAL &&
      run.status !== TestRunStatus.FAILED
    ) {
      throw new AppException(
        ErrorCode.TEST_RUN_NOT_FINISHED,
        'No se puede reintentar un target mientras la generación todavía no terminó.',
        HttpStatus.CONFLICT,
      );
    }

    const targetResult = await this.testGenerationRunsRepository.findTargetResult(testRunId, targetId);

    if (!targetResult) {
      throw new AppException(
        ErrorCode.TARGET_RESULT_NOT_FOUND,
        `No existe un resultado para el target ${targetId} en el run ${testRunId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (targetResult.status !== 'INVALID' && targetResult.status !== 'FAILED') {
      throw new AppException(
        ErrorCode.TARGET_RETRY_NOT_ALLOWED,
        `El target ${targetId} está en estado ${targetResult.status}; solo se puede reintentar INVALID o FAILED.`,
        HttpStatus.CONFLICT,
      );
    }

    return this.idempotencyService.run({
      scope: 'TARGET_RETRY',
      key: idempotencyKey,
      fingerprintInput: { testRunId, targetId },
      create: async (tx) => {
        const retryJobId = await this.jobsService.enqueue(
          RETRY_TARGET_JOB_TYPE,
          { testRunId, targetId },
          tx,
        );

        return {
          operationId: retryJobId,
          response: {
            testRunId,
            targetId,
            status: 'PENDING' as const,
            pollAfterMs: this.configService.get<number>('INDEXING_POLL_AFTER_MS', DEFAULT_POLL_AFTER_MS),
          },
        };
      },
      rebuildResponse: async () => ({
        testRunId,
        targetId,
        status: 'PENDING' as const,
        pollAfterMs: this.configService.get<number>('INDEXING_POLL_AFTER_MS', DEFAULT_POLL_AFTER_MS),
      }),
    });
  }

  async getHistory(
    projectVersionId: string,
    limit: number | undefined,
    cursor: string | undefined,
    ownerUserId: string,
  ): Promise<Page<TestRunSummaryResponse>> {
    const version = await this.projectVersionsRepository.findByIdForOwner(projectVersionId, ownerUserId);

    if (!version) {
      throw new AppException(
        ErrorCode.PROJECT_VERSION_NOT_FOUND,
        `No existe la versión ${projectVersionId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const runs = await this.testGenerationRunsRepository.findByProjectVersion(
      projectVersionId,
      take,
      cursor,
    );
    const hasMore = runs.length > take;
    const items = (hasMore ? runs.slice(0, take) : runs).map(
      (run): TestRunSummaryResponse => ({
        id: run.id,
        mode: run.mode,
        status: run.status,
        totalTargets: run.totalTargets,
        validTargets: run.validTargets,
        invalidTargets: run.invalidTargets,
        failedTargets: run.failedTargets,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      }),
    );

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  private assertModeTargetIdShape(mode: string, targetId: string | undefined): void {
    const requiresTargetId = mode === 'TARGET' || mode === 'CLASS_ALL' || mode === 'CLASS_MISSING';
    const forbidsTargetId = mode === 'PROJECT_MISSING' || mode === 'PROJECT_ALL';

    if (requiresTargetId && !targetId) {
      throw new AppException(
        ErrorCode.INVALID_GENERATION_TARGET,
        `El modo ${mode} requiere targetId.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (forbidsTargetId && targetId) {
      throw new AppException(
        ErrorCode.INVALID_GENERATION_TARGET,
        `El modo ${mode} no acepta targetId.`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async requireRun(runId: string, ownerUserId: string) {
    const run = await this.testGenerationRunsRepository.findByIdForOwner(runId, ownerUserId);

    if (!run) {
      throw new AppException(
        ErrorCode.TEST_RUN_NOT_FOUND,
        `No existe el test run ${runId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    return run;
  }
}

type ValidationFailureType =
  | 'NONE'
  | 'COMPILATION'
  | 'TEST_ASSERTION'
  | 'TEST_RUNTIME'
  | 'DEPENDENCY'
  | 'CONFIGURATION'
  | 'INFRASTRUCTURE'
  | 'UNKNOWN';
