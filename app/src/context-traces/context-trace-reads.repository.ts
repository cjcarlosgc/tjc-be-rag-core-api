import { Injectable } from '@nestjs/common';
import type {
  ContextTrace,
  DiscoveredFile,
  Prisma,
} from '../generated/prisma/client.js';
import {
  ExperimentStatus,
  ExperimentStrategy,
} from '../generated/prisma/enums.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ListContextTracesInput {
  experimentId: string;
  userId: string;
  strategy?: ExperimentStrategy;
  repetition?: number;
  includeSuperseded: boolean;
  cursor?: string;
  take: number;
}

export type ContextTraceForDetail = Prisma.ContextTraceGetPayload<{
  include: {
    projectVersion: { select: { snapshotKey: true } };
    target: {
      select: {
        filePath: true;
        symbolName: true;
        methodName: true;
        startLine: true;
        endLine: true;
      };
    };
    experiment: { select: { status: true } };
  };
}>;

@Injectable()
export class ContextTraceReadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findExperimentForOwner(
    experimentId: string,
    userId: string,
  ): Promise<{ id: string; status: ExperimentStatus } | null> {
    return this.prisma.experimentRun.findFirst({
      where: { id: experimentId, project: accessibleProject(userId) },
      select: { id: true, status: true },
    });
  }

  listForExperiment(input: ListContextTracesInput): Promise<ContextTrace[]> {
    return this.prisma.contextTrace.findMany({
      where: {
        experimentId: input.experimentId,
        experiment: { project: accessibleProject(input.userId) },
        ...(input.includeSuperseded ? {} : { current: true }),
        ...(input.strategy ? { strategy: input.strategy } : {}),
        ...(input.repetition ? { repetition: input.repetition } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.take + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
  }

  findForOwner(
    traceId: string,
    userId: string,
  ): Promise<ContextTraceForDetail | null> {
    return this.prisma.contextTrace.findFirst({
      where: {
        id: traceId,
        experiment: { project: accessibleProject(userId) },
      },
      include: {
        projectVersion: { select: { snapshotKey: true } },
        target: {
          select: {
            filePath: true,
            symbolName: true,
            methodName: true,
            startLine: true,
            endLine: true,
          },
        },
        experiment: { select: { status: true } },
      },
    });
  }

  listDiscoveredFilesForOwner(
    traceId: string,
    userId: string,
    step: number | undefined,
    cursor: string | undefined,
    take: number,
  ): Promise<Array<Pick<DiscoveredFile, 'id' | 'filePath' | 'step'>>> {
    return this.prisma.discoveredFile.findMany({
      where: {
        contextTraceId: traceId,
        contextTrace: { experiment: { project: accessibleProject(userId) } },
        ...(step === undefined ? {} : { step }),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: take + 1,
      select: { id: true, filePath: true, step: true },
    });
  }
}
