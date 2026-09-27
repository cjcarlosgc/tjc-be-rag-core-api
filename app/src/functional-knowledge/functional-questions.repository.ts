import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AnalysisRun,
  AnalysisRunStatus,
  FunctionalAnswerChoice,
  FunctionalQuestion,
  FunctionalQuestionStatus,
} from '../generated/prisma/client.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';

export type FunctionalQuestionWithRun = FunctionalQuestion & { analysisRun: AnalysisRun };

export interface CreateFunctionalQuestionInput {
  analysisRunId: string;
  projectId: string;
  symbolLanguage: FunctionalQuestion['symbolLanguage'];
  symbolKind: FunctionalQuestion['symbolKind'];
  qualifiedName: string;
  filePath: string;
  question: string;
  rationale: string;
}

export interface CurrentRunQuestionResult {
  question: FunctionalQuestion;
  analysisRun: AnalysisRun;
}

export interface AnswerFunctionalQuestionInput {
  answerChoice: FunctionalAnswerChoice;
  answerText: string | null;
  knowledgeId: string | null;
}

@Injectable()
export class FunctionalQuestionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateFunctionalQuestionInput): Promise<FunctionalQuestion> {
    return this.prisma.functionalQuestion.create({ data: input });
  }

  /**
   * Guarda una pregunta solo si el Run sigue en el estado que observó el
   * evaluador. Para PROCESSING, la transición a ACTION_REQUIRED y la pregunta
   * se confirman juntas; para una continuación, exige que el Run siga siendo
   * el ACTION_REQUIRED vigente. El update condicional serializa evaluaciones
   * concurrentes sobre el mismo Run.
   */
  async createForCurrentRun(
    input: CreateFunctionalQuestionInput,
    expectedStatus: AnalysisRunStatus,
  ): Promise<CurrentRunQuestionResult | null> {
    if (expectedStatus !== 'PROCESSING' && expectedStatus !== 'ACTION_REQUIRED') {
      return null;
    }

    return this.prisma.$transaction(async (tx) => {
      const runUpdate = await tx.analysisRun.updateMany({
        where: { id: input.analysisRunId, status: expectedStatus, current: true },
        data:
          expectedStatus === 'PROCESSING'
            ? { status: 'ACTION_REQUIRED', actionRequiredCount: { increment: 1 } }
            : { updatedAt: new Date() },
      });

      if (runUpdate.count === 0) {
        return null;
      }

      const existing = await tx.functionalQuestion.findFirst({
        where: {
          analysisRunId: input.analysisRunId,
          filePath: input.filePath,
          qualifiedName: input.qualifiedName,
          status: { not: 'OBSOLETE' },
        },
      });
      const question = existing ?? (await tx.functionalQuestion.create({ data: input }));
      const analysisRun = await tx.analysisRun.findUniqueOrThrow({ where: { id: input.analysisRunId } });

      return { question, analysisRun };
    });
  }

  findByAnalysisRun(analysisRunId: string): Promise<FunctionalQuestion[]> {
    return this.prisma.functionalQuestion.findMany({ where: { analysisRunId } });
  }

  /** Debe existir a lo sumo una PENDING por Run (`FunctionalContextEvaluatorService` genera de a una). */
  findPendingByAnalysisRun(analysisRunId: string): Promise<FunctionalQuestion | null> {
    return this.prisma.functionalQuestion.findFirst({
      where: { analysisRunId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string): Promise<FunctionalQuestion | null> {
    return this.prisma.functionalQuestion.findUnique({ where: { id } });
  }

  answer(id: string, input: AnswerFunctionalQuestionInput): Promise<FunctionalQuestion> {
    return this.prisma.functionalQuestion.update({
      where: { id },
      data: { ...input, status: 'ANSWERED', answeredAt: new Date() },
    });
  }

  markObsolete(id: string): Promise<FunctionalQuestion> {
    return this.prisma.functionalQuestion.update({ where: { id }, data: { status: 'OBSOLETE' } });
  }

  /** HU55-ish: `projectId` es opcional -inbox cross-project del usuario-. */
  findActionRequired(
    userId: string,
    projectId: string | undefined,
    status: FunctionalQuestionStatus,
    take: number,
    cursor: string | undefined,
  ): Promise<FunctionalQuestionWithRun[]> {
    return this.prisma.functionalQuestion.findMany({
      where: {
        status,
        project: accessibleProject(userId),
        analysisRun: { status: 'ACTION_REQUIRED', current: true },
        ...(projectId ? { projectId } : {}),
      },
      include: { analysisRun: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
