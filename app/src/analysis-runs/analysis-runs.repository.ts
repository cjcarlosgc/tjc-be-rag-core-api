import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AnalysisRun, AnalysisRunStatus, Prisma } from '../generated/prisma/client.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';

export interface CreateAnalysisRunInput {
  projectId: string;
  repositoryId: string;
  repositoryName: string;
  prNumber: number;
  prTitle: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  draft: boolean;
  actorLogin: string | null;
}

@Injectable()
export class AnalysisRunsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateAnalysisRunInput): Promise<AnalysisRun> {
    return this.prisma.analysisRun.create({
      data: {
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        repositoryName: input.repositoryName,
        prNumber: input.prNumber,
        prTitle: input.prTitle,
        baseRef: input.baseRef,
        headRef: input.headRef,
        baseSha: input.baseSha,
        headSha: input.headSha,
        draft: input.draft,
        actorLogin: input.actorLogin,
        changesetBaseSha: input.baseSha,
        changesetHeadSha: input.headSha,
      },
    });
  }

  findCurrentByPullRequest(
    projectId: string,
    repositoryId: string,
    prNumber: number,
  ): Promise<AnalysisRun | null> {
    return this.prisma.analysisRun.findFirst({
      where: { projectId, repositoryId, prNumber, current: true },
    });
  }

  findByIdForOwner(id: string, userId: string): Promise<AnalysisRun | null> {
    return this.prisma.analysisRun.findFirst({ where: { id, project: accessibleProject(userId) } });
  }

  /**
   * Sin scoping por propietario: uso exclusivo de job handlers en segundo
   * plano (mismo patrón que `ProjectVersionsRepository.findById`).
   */
  findById(id: string): Promise<AnalysisRun | null> {
    return this.prisma.analysisRun.findUnique({ where: { id } });
  }

  update(id: string, data: Prisma.AnalysisRunUpdateInput): Promise<AnalysisRun> {
    return this.prisma.analysisRun.update({ where: { id }, data });
  }

  /** HU55: Runs de todos los Projects visibles para el usuario, más recientes primero. */
  findVisibleForUser(
    userId: string,
    take: number,
    status: AnalysisRunStatus | undefined,
    cursor: string | undefined,
  ): Promise<AnalysisRun[]> {
    return this.prisma.analysisRun.findMany({
      where: { project: accessibleProject(userId), ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  findByProjectForOwner(
    projectId: string,
    userId: string,
    take: number,
    status: AnalysisRunStatus | undefined,
    cursor: string | undefined,
  ): Promise<AnalysisRun[]> {
    return this.prisma.analysisRun.findMany({
      where: { projectId, project: accessibleProject(userId), ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
