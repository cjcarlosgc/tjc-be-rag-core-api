import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ExperimentRepetition, ExperimentRun, Prisma } from '../../generated/prisma/client.js';
import { ExperimentStatus } from '../../generated/prisma/enums.js';
import type { FailureTypeValue } from '../../sandbox/map-sandbox-result.js';

export interface CreateExperimentRunInput {
  projectId: string;
  projectVersionId: string;
  targetId: string;
  totalRepetitions: number;
}

export interface ExperimentRepetitionInput {
  repetition: number;
  strategy: 'RAG' | 'GENERALIST_AGENT';
  compiled: boolean | null;
  executed: boolean | null;
  passed: boolean | null;
  valid: boolean | null;
  failureType: FailureTypeValue | null;
  generationDurationMs: number;
  executionDurationMs: number | null;
  totalDurationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  retrievedChunks: number | null;
  selectedChunks: number | null;
  contextTokens: number | null;
  toolCalls: number | null;
  filesInspected: number | null;
  trajectory: Prisma.InputJsonValue | undefined;
}

@Injectable()
export class ExperimentRunsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateExperimentRunInput): Promise<ExperimentRun> {
    return this.prisma.experimentRun.create({ data: input });
  }

  findById(id: string): Promise<ExperimentRun | null> {
    return this.prisma.experimentRun.findUnique({ where: { id } });
  }

  markStarted(id: string): Promise<ExperimentRun> {
    return this.prisma.experimentRun.update({
      where: { id },
      data: { status: ExperimentStatus.RUNNING, startedAt: new Date() },
    });
  }

  incrementCompletedRepetitions(id: string): Promise<ExperimentRun> {
    return this.prisma.experimentRun.update({
      where: { id },
      data: { completedRepetitions: { increment: 1 } },
    });
  }

  complete(id: string): Promise<ExperimentRun> {
    return this.prisma.experimentRun.update({
      where: { id },
      data: { status: ExperimentStatus.COMPLETED, completedAt: new Date() },
    });
  }

  markFailed(id: string, failureCode: string, failureMessage: string): Promise<ExperimentRun> {
    return this.prisma.experimentRun.update({
      where: { id },
      data: {
        status: ExperimentStatus.FAILED,
        failureCode,
        failureMessage,
        completedAt: new Date(),
      },
    });
  }

  insertRepetition(
    experimentId: string,
    repetition: ExperimentRepetitionInput,
  ): Promise<ExperimentRepetition> {
    return this.prisma.experimentRepetition.create({ data: { experimentId, ...repetition } });
  }

  findRepetitions(experimentId: string): Promise<ExperimentRepetition[]> {
    return this.prisma.experimentRepetition.findMany({
      where: { experimentId },
      orderBy: [{ strategy: 'asc' }, { repetition: 'asc' }],
    });
  }
}
