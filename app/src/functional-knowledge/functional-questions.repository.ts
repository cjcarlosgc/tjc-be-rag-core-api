import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AnalysisRun,
  AnalysisRunStatus,
  FunctionalAnswerChoice,
  FunctionalQuestion,
  FunctionalQuestionAbstention,
  FunctionalQuestionStatus,
  ScenarioKind,
} from '../generated/prisma/client.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';
import {
  summarizeAbstentions,
  type ConfirmingRole,
  type FunctionalAbstentionSummary,
} from './dto/functional-question.response.js';

/** Pregunta con sus abstenciones, ordenadas `createdAt desc, id desc` (la primera es la más reciente). */
export type FunctionalQuestionWithAbstentions = FunctionalQuestion & { abstentions: FunctionalQuestionAbstention[] };

export type FunctionalQuestionWithRun = FunctionalQuestionWithAbstentions & { analysisRun: AnalysisRun };

export interface CreateFunctionalQuestionInput {
  analysisRunId: string;
  projectId: string;
  symbolLanguage: FunctionalQuestion['symbolLanguage'];
  symbolKind: FunctionalQuestion['symbolKind'];
  qualifiedName: string;
  filePath: string;
  question: string;
  rationale: string;
  /** WI-CORE-018: ausentes en preguntas creadas sin escenario (no se usan desde el corte 2). */
  scenarioKind?: ScenarioKind;
  scenarioKey?: string;
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

const NEWEST_FIRST = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

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
   *
   * Deduplicación: sin `scenarioKey` (preguntas anteriores a WI-CORE-018) se reutiliza
   * cualquier pregunta no `OBSOLETE` del mismo target. Con `scenarioKey` se reutiliza la
   * que tenga la misma clave, o una pregunta histórica (`scenarioKey` nulo) del mismo
   * target, que cubre todo el target; otras claves del mismo target se crean aparte.
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

      const target = {
        analysisRunId: input.analysisRunId,
        filePath: input.filePath,
        qualifiedName: input.qualifiedName,
        status: { not: 'OBSOLETE' as FunctionalQuestionStatus },
      };
      const existing = await tx.functionalQuestion.findFirst({
        where:
          input.scenarioKey === undefined
            ? target
            : { ...target, OR: [{ scenarioKey: input.scenarioKey }, { scenarioKey: null }] },
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
  findPendingByAnalysisRun(analysisRunId: string): Promise<FunctionalQuestionWithAbstentions | null> {
    return this.prisma.functionalQuestion.findFirst({
      where: {
        analysisRunId,
        status: 'PENDING',
        analysisRun: {
          pullRequestCreatedAt: { not: null },
          repositoryBindingEligible: true,
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { abstentions: { orderBy: NEWEST_FIRST } },
    });
  }

  findById(id: string): Promise<FunctionalQuestionWithAbstentions | null> {
    return this.prisma.functionalQuestion.findUnique({
      where: { id },
      include: { abstentions: { orderBy: NEWEST_FIRST } },
    });
  }

  /**
   * Respuesta condicional a `PENDING`: si la pregunta ya no está pendiente (respondida en
   * paralelo u obsoleta), no escribe y devuelve `null`.
   */
  answer(id: string, input: AnswerFunctionalQuestionInput): Promise<FunctionalQuestion | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.functionalQuestion.updateMany({
        where: { id, status: 'PENDING' },
        data: { ...input, status: 'ANSWERED', answeredAt: new Date() },
      });

      if (updated.count === 0) {
        return null;
      }

      return tx.functionalQuestion.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Registra un `UNKNOWN` como abstención auditada (DEC-FK-002). Bajo bloqueo de la fila de la
   * pregunta verifica que siga `PENDING` y que su Run siga `ACTION_REQUIRED` y vigente; si no,
   * devuelve `null` sin insertar. Inserta una fila nueva sin cambiar el estado de la pregunta
   * ni del Run, y calcula el resumen de las filas de esta misma transacción.
   */
  recordAbstention(
    questionId: string,
    userId: string,
    role: ConfirmingRole,
  ): Promise<FunctionalAbstentionSummary | null> {
    return this.prisma.$transaction(async (tx) => {
      // Serializa abstenciones y respuestas concurrentes sobre la misma pregunta.
      await tx.$queryRaw`SELECT "id" FROM "functional_questions" WHERE "id" = ${questionId} FOR UPDATE`;

      const open = await tx.functionalQuestion.findFirst({
        where: {
          id: questionId,
          status: 'PENDING',
          analysisRun: { status: 'ACTION_REQUIRED', current: true },
        },
        select: { id: true },
      });

      if (!open) {
        return null;
      }

      await tx.functionalQuestionAbstention.create({ data: { questionId, userId, role } });
      const abstentions = await tx.functionalQuestionAbstention.findMany({
        where: { questionId },
        orderBy: NEWEST_FIRST,
      });

      return summarizeAbstentions(abstentions);
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
        analysisRun: {
          status: 'ACTION_REQUIRED',
          current: true,
          pullRequestCreatedAt: { not: null },
          repositoryBindingEligible: true,
        },
        ...(projectId ? { projectId } : {}),
      },
      include: { analysisRun: true, abstentions: { orderBy: NEWEST_FIRST } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
