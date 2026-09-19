import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AnalysisRun,
  FunctionalAnswerChoice,
  FunctionalQuestion,
  FunctionalQuestionStatus,
} from '../generated/prisma/client.js';

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
    ownerUserId: string,
    projectId: string | undefined,
    status: FunctionalQuestionStatus,
    take: number,
    cursor: string | undefined,
  ): Promise<FunctionalQuestionWithRun[]> {
    return this.prisma.functionalQuestion.findMany({
      where: {
        status,
        project: { ownerUserId },
        ...(projectId ? { projectId } : {}),
      },
      include: { analysisRun: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
