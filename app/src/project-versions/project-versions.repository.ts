import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ProjectVersion } from '../generated/prisma/client.js';
import { ProjectVersionStatus, type TestFramework } from '../generated/prisma/enums.js';

export interface CreatePendingVersionInput {
  projectId: string;
  originalFileName: string;
  sizeBytes: number;
}

@Injectable()
export class ProjectVersionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPending(input: CreatePendingVersionInput): Promise<ProjectVersion> {
    return this.prisma.projectVersion.create({
      data: {
        projectId: input.projectId,
        originalFileName: input.originalFileName,
        sizeBytes: input.sizeBytes,
        status: ProjectVersionStatus.PENDING,
      },
    });
  }

  findById(id: string): Promise<ProjectVersion | null> {
    return this.prisma.projectVersion.findUnique({ where: { id } });
  }

  async hasActiveVersion(projectId: string): Promise<boolean> {
    const active = await this.prisma.projectVersion.findFirst({
      where: {
        projectId,
        status: { notIn: [ProjectVersionStatus.COMPLETED, ProjectVersionStatus.FAILED] },
      },
      select: { id: true },
    });

    return active !== null;
  }

  async setSnapshot(id: string, snapshotKey: string): Promise<void> {
    await this.prisma.projectVersion.update({ where: { id }, data: { snapshotKey } });
  }

  async setStatus(id: string, status: ProjectVersionStatus): Promise<void> {
    await this.prisma.projectVersion.update({ where: { id }, data: { status } });
  }

  async markStarted(id: string): Promise<void> {
    await this.prisma.projectVersion.update({
      where: { id },
      data: { status: ProjectVersionStatus.EXTRACTING, startedAt: new Date() },
    });
  }

  async markFailed(id: string, failureReason: string): Promise<void> {
    await this.prisma.projectVersion.update({
      where: { id },
      data: { status: ProjectVersionStatus.FAILED, failureReason: failureReason.slice(0, 2000) },
    });
  }

  async completeAndPromote(
    projectId: string,
    versionId: string,
    result: {
      filesProcessed: number;
      chunksCount: number;
      detectedFramework: TestFramework | null;
      targetsTotal: number;
      targetsWithTest: number;
    },
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.projectVersion.update({
        where: { id: versionId },
        data: {
          status: ProjectVersionStatus.COMPLETED,
          filesProcessed: result.filesProcessed,
          chunksCount: result.chunksCount,
          detectedFramework: result.detectedFramework,
          targetsTotal: result.targetsTotal,
          targetsWithTest: result.targetsWithTest,
          completedAt: new Date(),
        },
      }),
      this.prisma.project.update({
        where: { id: projectId },
        data: { currentVersionId: versionId },
      }),
    ]);
  }
}
