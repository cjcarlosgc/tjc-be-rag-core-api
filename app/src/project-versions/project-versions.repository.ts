import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ProjectVersion } from '../generated/prisma/client.js';
import { ProjectVersionStatus, type TestFramework } from '../generated/prisma/enums.js';

export interface CreatePendingVersionInput {
  projectId: string;
  commitSha: string;
}

@Injectable()
export class ProjectVersionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPending(input: CreatePendingVersionInput): Promise<ProjectVersion> {
    return this.prisma.projectVersion.create({
      data: {
        projectId: input.projectId,
        commitSha: input.commitSha,
        status: ProjectVersionStatus.PENDING,
      },
    });
  }

  /**
   * Sin scoping por propietario: uso exclusivo de job handlers en segundo
   * plano, que procesan un `projectVersionId` ya autorizado por la request
   * HTTP que encoló el job y no tienen identidad de usuario en su contexto.
   */
  findById(id: string): Promise<ProjectVersion | null> {
    return this.prisma.projectVersion.findUnique({ where: { id } });
  }

  /**
   * Variante para rutas HTTP: filtra por propietario en la misma consulta
   * (HU29) en vez de cargar y comprobar después.
   */
  findByIdForOwner(id: string, ownerUserId: string): Promise<ProjectVersion | null> {
    return this.prisma.projectVersion.findFirst({ where: { id, project: { ownerUserId } } });
  }

  /**
   * HU25: página de versiones de un proyecto, más recientes primero. Se
   * pide `take + 1` para saber si hay una página siguiente sin una segunda
   * consulta; el cursor es el id de la última versión devuelta.
   */
  findByProject(projectId: string, take: number, cursor?: string): Promise<ProjectVersion[]> {
    return this.prisma.projectVersion.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
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

  /**
   * HU33: resuelve bootstrap (null, no hay snapshot previo) vs incremental
   * (existe) para un Project. Un Project tiene a lo sumo un RepositoryBinding
   * (HU30), así que el projectId ya identifica el repositorio sin join extra.
   */
  findLatestCompletedByProject(projectId: string): Promise<ProjectVersion | null> {
    return this.prisma.projectVersion.findFirst({
      where: { projectId, status: ProjectVersionStatus.COMPLETED },
      orderBy: { createdAt: 'desc' },
    });
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
