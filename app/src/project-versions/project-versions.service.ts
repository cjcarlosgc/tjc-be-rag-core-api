import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { ProjectVersionsRepository } from './project-versions.repository.js';
import { TestTargetsRepository } from './persistence/test-targets.repository.js';
import { ZipValidationService } from './zip/zip-validation.service.js';
import { assertCompatibleProject, listSafeZipEntries } from './zip/zip-entries.util.js';
import { JobsService } from '../jobs/jobs.service.js';
import { INDEXING_JOB_TYPE } from './indexing.constants.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { IndexProjectDto } from './dto/index-project.dto.js';
import type { IndexAcceptedResponse } from './dto/index-accepted.response.js';
import type { ProjectVersionResponse } from './dto/project-version.response.js';
import type { ProjectVersionResultsResponse } from './dto/project-version-results.response.js';
import type { TestInventoryResponse } from './dto/test-target.response.js';
import type { Project, ProjectVersion } from '../generated/prisma/client.js';
import { ProjectVersionStatus } from '../generated/prisma/enums.js';

@Injectable()
export class ProjectVersionsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly testTargetsRepository: TestTargetsRepository,
    private readonly zipValidationService: ZipValidationService,
    private readonly jobsService: JobsService,
    private readonly configService: ConfigService,
    private readonly objectStorageService: ObjectStorageService,
  ) {}

  async startIndexing(
    file: Express.Multer.File | undefined,
    dto: IndexProjectDto,
  ): Promise<IndexAcceptedResponse> {
    this.zipValidationService.assertValidUpload(file);

    const entries = listSafeZipEntries(file.buffer);
    assertCompatibleProject(entries);

    const project = await this.resolveProject(dto);

    if (await this.projectVersionsRepository.hasActiveVersion(project.id)) {
      throw new AppException(
        ErrorCode.PROJECT_INDEXING_IN_PROGRESS,
        `El proyecto "${project.id}" ya tiene una indexación en curso.`,
        HttpStatus.CONFLICT,
      );
    }

    const version = await this.projectVersionsRepository.createPending({
      projectId: project.id,
      originalFileName: file.originalname,
      sizeBytes: file.size,
    });

    const snapshotKey = `repositories/${project.id}/versions/${version.id}/original.zip`;

    try {
      await this.objectStorageService.put(snapshotKey, file.buffer, 'application/zip');
      await this.projectVersionsRepository.setSnapshot(version.id, snapshotKey);

      await this.jobsService.enqueue(INDEXING_JOB_TYPE, {
        projectVersionId: version.id,
        projectId: project.id,
        snapshotKey,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo iniciar la indexación.';
      await this.projectVersionsRepository.markFailed(version.id, message);
      throw error;
    }

    return {
      projectId: project.id,
      projectVersionId: version.id,
      status: 'PENDING',
      pollAfterMs: this.configService.get<number>('INDEXING_POLL_AFTER_MS', 1500),
    };
  }

  async getStatus(id: string): Promise<ProjectVersionResponse> {
    return this.toResponse(await this.findVersionOrThrow(id));
  }

  async getResults(id: string): Promise<ProjectVersionResultsResponse> {
    const version = await this.findVersionOrThrow(id);

    if (version.status !== ProjectVersionStatus.COMPLETED) {
      throw new AppException(
        ErrorCode.ANALYSIS_NOT_FINISHED,
        `La versión "${id}" no ha finalizado su análisis (estado actual: ${version.status}).`,
        HttpStatus.CONFLICT,
        { status: version.status, failureReason: version.failureReason },
      );
    }

    const targetsTotal = version.targetsTotal ?? 0;
    const targetsWithTest = version.targetsWithTest ?? 0;

    return {
      id: version.id,
      projectId: version.projectId,
      status: version.status,
      filesProcessed: version.filesProcessed ?? 0,
      chunksCount: version.chunksCount ?? 0,
      detectedFramework: version.detectedFramework,
      targetsTotal,
      targetsWithTest,
      targetsMissingTest: targetsTotal - targetsWithTest,
      completedAt: version.completedAt?.toISOString() ?? null,
    };
  }

  async getTestInventory(id: string): Promise<TestInventoryResponse> {
    const version = await this.findVersionOrThrow(id);

    if (version.status !== ProjectVersionStatus.COMPLETED) {
      throw new AppException(
        ErrorCode.ANALYSIS_NOT_FINISHED,
        `La versión "${id}" no ha finalizado su análisis (estado actual: ${version.status}).`,
        HttpStatus.CONFLICT,
        { status: version.status, failureReason: version.failureReason },
      );
    }

    const targets = await this.testTargetsRepository.findByProjectVersion(id);
    const targetsTotal = version.targetsTotal ?? targets.length;
    const targetsWithTest = version.targetsWithTest ?? targets.filter((t) => t.hasTest).length;

    return {
      projectVersionId: version.id,
      detectedFramework: version.detectedFramework,
      targetsTotal,
      targetsWithTest,
      targetsMissingTest: targetsTotal - targetsWithTest,
      targets: targets.map((target) => ({
        id: target.id,
        filePath: target.filePath,
        symbolName: target.symbolName,
        methodName: target.methodName,
        targetType: target.targetType,
        hasTest: target.hasTest,
        testFilePaths: target.testFilePaths,
      })),
    };
  }

  private async findVersionOrThrow(id: string): Promise<ProjectVersion> {
    const version = await this.projectVersionsRepository.findById(id);

    if (!version) {
      throw new AppException(
        ErrorCode.PROJECT_VERSION_NOT_FOUND,
        `No existe una versión de proyecto con id "${id}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return version;
  }

  private async resolveProject(dto: IndexProjectDto): Promise<Project> {
    if (dto.projectId) {
      const project = await this.projectsRepository.findById(dto.projectId);

      if (!project) {
        throw new AppException(
          ErrorCode.PROJECT_NOT_FOUND,
          `No existe un proyecto con id "${dto.projectId}".`,
          HttpStatus.NOT_FOUND,
        );
      }

      return project;
    }

    return this.projectsRepository.create(dto.name?.trim() || 'Proyecto sin nombre');
  }

  private toResponse(version: ProjectVersion): ProjectVersionResponse {
    return {
      id: version.id,
      projectId: version.projectId,
      status: version.status,
      originalFileName: version.originalFileName,
      sizeBytes: version.sizeBytes,
      filesProcessed: version.filesProcessed,
      chunksCount: version.chunksCount,
      failureReason: version.failureReason,
      startedAt: version.startedAt?.toISOString() ?? null,
      completedAt: version.completedAt?.toISOString() ?? null,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
    };
  }
}
