import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AnalysisRun, AnalysisRunStatus, Prisma } from '../generated/prisma/client.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';

export interface CreateAnalysisRunInput {
  projectId: string;
  repositoryId: string;
  repositoryName: string;
  prNumber: number;
  pullRequestCreatedAt?: Date | null;
  repositoryBindingEligible?: boolean | null;
  prTitle: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  draft: boolean;
  actorLogin: string | null;
}

export interface PullRequestRunGroup {
  repositoryId: string;
  prNumber: number;
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
        pullRequestCreatedAt: input.pullRequestCreatedAt ?? null,
        repositoryBindingEligible: input.repositoryBindingEligible ?? null,
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
    return this.prisma.analysisRun.findFirst({
      where: {
        id,
        pullRequestCreatedAt: { not: null },
        repositoryBindingEligible: true,
        project: accessibleProject(userId),
      },
    });
  }

  /**
   * Sin scoping por propietario: uso exclusivo de job handlers en segundo
   * plano (mismo patrón que `ProjectVersionsRepository.findById`).
   */
  findById(id: string): Promise<AnalysisRun | null> {
    return this.prisma.analysisRun.findFirst({
      where: {
        id,
        pullRequestCreatedAt: { not: null },
        repositoryBindingEligible: true,
      },
    });
  }

  /** WI-CORE-026 (corte D): guarda el id del Check publicado en GitHub para el Run. */
  setCheckId(id: string, checkId: string): Promise<AnalysisRun> {
    return this.prisma.analysisRun.update({ where: { id }, data: { checkId } });
  }

  update(id: string, data: Prisma.AnalysisRunUpdateInput): Promise<AnalysisRun> {
    if (data.current === false || data.status === 'OBSOLETE') {
      return this.prisma.$transaction(async (tx) => {
        const run = await tx.analysisRun.update({ where: { id }, data });
        await tx.functionalQuestion.updateMany({
          where: { analysisRunId: id, status: 'PENDING' },
          data: { status: 'OBSOLETE' },
        });
        return run;
      });
    }

    return this.prisma.analysisRun.update({ where: { id }, data });
  }

  /** Compare-and-set a transition only while this is still the current Run. */
  async transitionCurrent(
    id: string,
    expectedStatus: AnalysisRunStatus,
    status: AnalysisRunStatus,
    data: Prisma.AnalysisRunUpdateInput,
  ): Promise<AnalysisRun | null> {
    return this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.analysisRun.updateMany({
        where: { id, status: expectedStatus, current: true },
        data: { ...data, status },
      });

      if (transitioned.count === 0) {
        return null;
      }

      if (status === 'OBSOLETE' || data.current === false) {
        await tx.functionalQuestion.updateMany({
          where: { analysisRunId: id, status: 'PENDING' },
          data: { status: 'OBSOLETE' },
        });
      }

      return tx.analysisRun.findUniqueOrThrow({ where: { id } });
    });
  }

  /** HU55: Runs de todos los Projects visibles para el usuario, más recientes primero. */
  findVisibleForUser(
    userId: string,
    take: number,
    status: AnalysisRunStatus | undefined,
    cursor: string | undefined,
  ): Promise<AnalysisRun[]> {
    return this.prisma.analysisRun.findMany({
      where: {
        pullRequestCreatedAt: { not: null },
        repositoryBindingEligible: true,
        project: accessibleProject(userId),
        ...(status ? { status } : {}),
      },
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
      where: {
        projectId,
        pullRequestCreatedAt: { not: null },
        repositoryBindingEligible: true,
        project: accessibleProject(userId),
        ...(status ? { status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  /** Identidades PR con Runs sin clasificar, para sembrar de nuevo jobs tras reinicios. */
  findUnclassifiedPullRequestGroups(): Promise<PullRequestRunGroup[]> {
    return this.prisma.analysisRun.findMany({
      where: {
        OR: [{ pullRequestCreatedAt: null }, { repositoryBindingEligible: null }],
      },
      select: { repositoryId: true, prNumber: true },
      distinct: ['repositoryId', 'prNumber'],
      orderBy: [{ repositoryId: 'asc' }, { prNumber: 'asc' }],
    });
  }

  hasUnclassifiedPullRequest(repositoryId: string, prNumber: number): Promise<boolean> {
    return this.prisma.analysisRun.findFirst({
      where: {
        repositoryId,
        prNumber,
        OR: [{ pullRequestCreatedAt: null }, { repositoryBindingEligible: null }],
      },
      select: { id: true },
    }).then((run) => run !== null);
  }

  /**
   * Clasifica idempotentemente todos los Runs históricos de un PR respecto del
   * binding actual. Los pre-binding quedan OBSOLETE y sus preguntas pendientes
   * se obsoletan en la misma transacción.
   */
  async classifyPullRequest(
    repositoryId: string,
    prNumber: number,
    pullRequestCreatedAt: Date | null,
    bindingCreatedAt: Date,
  ): Promise<{ classifiedCount: number; eligible: boolean }> {
    if (pullRequestCreatedAt === null) {
      return { classifiedCount: 0, eligible: false };
    }

    if (!Number.isFinite(pullRequestCreatedAt.getTime())) {
      throw new RangeError('pullRequestCreatedAt debe ser una fecha válida.');
    }

    const eligible = pullRequestCreatedAt.getTime() >= bindingCreatedAt.getTime();

    const classifiedCount = await this.prisma.$transaction(async (tx) => {
      const result = await tx.analysisRun.updateMany({
        where: {
          repositoryId,
          prNumber,
          OR: [{ pullRequestCreatedAt: null }, { repositoryBindingEligible: null }],
        },
        data: {
          pullRequestCreatedAt,
          repositoryBindingEligible: eligible,
          ...(eligible ? {} : { status: 'OBSOLETE', current: false }),
        },
      });

      if (!eligible) {
        await tx.functionalQuestion.updateMany({
          where: { status: 'PENDING', analysisRun: { repositoryId, prNumber } },
          data: { status: 'OBSOLETE' },
        });
      }

      return result.count;
    });

    return { classifiedCount, eligible };
  }
}
