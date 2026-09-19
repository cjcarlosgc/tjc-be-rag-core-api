import { HttpStatus, Injectable } from '@nestjs/common';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { ProjectVersionsRepository } from './project-versions.repository.js';
import { TestTargetsRepository } from './persistence/test-targets.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import {
  toProjectVersionResponse,
  toProjectVersionSummaryResponse,
  type ProjectVersionResponse,
  type ProjectVersionSummaryResponse,
} from './dto/project-version.response.js';
import type { ProjectVersionResultsResponse } from './dto/project-version-results.response.js';
import type { TestInventoryResponse } from './dto/test-target.response.js';
import type { ProjectVersion } from '../generated/prisma/client.js';
import { ProjectVersionStatus } from '../generated/prisma/enums.js';
import type { Page } from '../common/dto/page.response.js';

const DEFAULT_PAGE_LIMIT = 20;

@Injectable()
export class ProjectVersionsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly testTargetsRepository: TestTargetsRepository,
  ) {}

  async getStatus(id: string, ownerUserId: string): Promise<ProjectVersionResponse> {
    return toProjectVersionResponse(await this.findVersionOrThrow(id, ownerUserId));
  }

  async getResults(id: string, ownerUserId: string): Promise<ProjectVersionResultsResponse> {
    const version = await this.findVersionOrThrow(id, ownerUserId);

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

  async getTestInventory(id: string, ownerUserId: string): Promise<TestInventoryResponse> {
    const version = await this.findVersionOrThrow(id, ownerUserId);

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

  async listVersions(
    projectId: string,
    limit: number | undefined,
    cursor: string | undefined,
    ownerUserId: string,
  ): Promise<Page<ProjectVersionSummaryResponse>> {
    const project = await this.projectsRepository.findById(projectId, ownerUserId);

    if (!project) {
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `No existe un proyecto con id "${projectId}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const versions = await this.projectVersionsRepository.findByProject(projectId, take, cursor);
    const hasMore = versions.length > take;
    const items = (hasMore ? versions.slice(0, take) : versions).map((version) =>
      toProjectVersionSummaryResponse(version, project.currentVersionId),
    );

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  private async findVersionOrThrow(id: string, ownerUserId: string): Promise<ProjectVersion> {
    const version = await this.projectVersionsRepository.findByIdForOwner(id, ownerUserId);

    if (!version) {
      throw new AppException(
        ErrorCode.PROJECT_VERSION_NOT_FOUND,
        `No existe una versión de proyecto con id "${id}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return version;
  }
}
