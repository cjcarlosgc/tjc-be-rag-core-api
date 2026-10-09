import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  ExperimentRepetition,
  ExperimentRun,
  Prisma,
} from '../../generated/prisma/client.js';
import {
  ExperimentRepetitionState,
  ExperimentStatus,
} from '../../generated/prisma/enums.js';
import type { FailureTypeValue } from '../../sandbox/map-sandbox-result.js';
import { accessibleProject } from '../../common/persistence/accessible-project.filter.js';
import type { LLMEffectiveConfig } from '../../providers/llm-provider.interface.js';

/** Presupuesto resuelto al crear el experimento (WI-CORE-025, INTEROP-2.7 §6.5.1). */
export type ExperimentBudget = {
  toolCallCap: number;
  contextTokenBudget: number;
  maxDurationMs: number;
};

export interface CreateExperimentRunInput {
  projectId: string;
  projectVersionId: string;
  targetId: string;
  totalRepetitions: number;
  /** Configuración efectiva resuelta una vez por experimento (WI-CORE-023). */
  modelConfig: LLMEffectiveConfig;
  /** Semilla de aleatorización del orden por par, generada una vez al crear (WI-CORE-025). */
  randomizationSeed: string;
  budget: ExperimentBudget;
  /** Perfil de ejecución del Sandbox, tomado de EXECUTION_PROFILE_BY_RUNNER (WI-CORE-025). */
  executionProfile: string;
  /** Runner detectado en la versión al crear (WI-CORE-025). */
  runnerHint: 'JEST' | 'VITEST';
}

export interface ExperimentRepetitionInput {
  repetition: number;
  strategy: 'RAG' | 'GENERALIST_AGENT';
  compiled: boolean | null;
  executed: boolean | null;
  passed: boolean | null;
  valid: boolean | null;
  failureType: FailureTypeValue | null;
  errorSummary: string | null;
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
  /** WI-CORE-025: identidad compartida por las dos estrategias de un par (opcional en escrituras previas). */
  pairId?: string | null;
  /** WI-CORE-025: 1 = primera posición del par, 2 = segunda. */
  pairPosition?: number | null;
  /** WI-CORE-025: número de intento del slot lógico (1 o 2). */
  attempt?: number;
  /** WI-CORE-025: false cuando el slot agotó el reintento externo sin evaluación técnica (default true). */
  technicallyEvaluable?: boolean;
}

@Injectable()
export class ExperimentRunsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: CreateExperimentRunInput,
    tx?: Prisma.TransactionClient,
  ): Promise<ExperimentRun> {
    const { modelConfig, budget, ...columns } = input;

    return (tx ?? this.prisma).experimentRun.create({
      data: {
        ...columns,
        budget: { ...budget },
        modelConfig: {
          provider: modelConfig.provider,
          model: modelConfig.model,
          modelVersion: modelConfig.modelVersion,
          reasoningEffort: modelConfig.reasoningEffort,
          temperature: modelConfig.temperature,
          maxOutputTokens: modelConfig.maxOutputTokens,
        },
      },
    });
  }

  /**
   * Sin scoping por propietario: uso exclusivo de job handlers en segundo
   * plano y de lecturas internas encadenadas a un recurso ya autorizado.
   */
  findById(id: string): Promise<ExperimentRun | null> {
    return this.prisma.experimentRun.findUnique({ where: { id } });
  }

  /**
   * Variante para rutas HTTP: filtra por propietario en la misma consulta
   * (HU29) en vez de cargar y comprobar después.
   */
  findByIdForOwner(id: string, userId: string): Promise<ExperimentRun | null> {
    return this.prisma.experimentRun.findFirst({
      where: { id, project: accessibleProject(userId) },
    });
  }

  markStarted(id: string): Promise<ExperimentRun> {
    return this.prisma.experimentRun.update({
      where: { id },
      data: { status: ExperimentStatus.RUNNING, startedAt: new Date() },
    });
  }

  refreshCompletedRepetitions(id: string): Promise<ExperimentRun> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize refreshes so concurrent terminal attempts cannot overwrite a
      // newer logical-repetition count with a stale snapshot.
      await tx.$queryRaw`SELECT "id" FROM "experiment_runs" WHERE "id" = ${id} FOR UPDATE`;

      const terminalAttempts = await tx.experimentRepetition.findMany({
        where: {
          experimentId: id,
          state: {
            in: [
              ExperimentRepetitionState.COMPLETED,
              ExperimentRepetitionState.FAILED,
            ],
          },
        },
        select: { strategy: true, repetition: true },
      });
      const completedSlots = new Set(
        terminalAttempts.map(
          ({ strategy, repetition }) => `${strategy}:${repetition}`,
        ),
      );

      return tx.experimentRun.update({
        where: { id },
        data: { completedRepetitions: completedSlots.size },
      });
    });
  }

  complete(id: string): Promise<ExperimentRun> {
    return this.prisma.experimentRun.update({
      where: { id },
      data: { status: ExperimentStatus.COMPLETED, completedAt: new Date() },
    });
  }

  markFailed(
    id: string,
    failureCode: string,
    failureMessage: string,
  ): Promise<ExperimentRun> {
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
    return this.prisma.experimentRepetition.create({
      data: { experimentId, ...repetition },
    });
  }

  updateRepetitionById(
    id: string,
    repetition: ExperimentRepetitionInput,
    state: 'COMPLETED' | 'FAILED',
  ): Promise<ExperimentRepetition> {
    const {
      repetition: _logicalRepetition,
      strategy: _strategy,
      trajectory,
      ...metrics
    } = repetition;

    return this.prisma.experimentRepetition.update({
      where: { id },
      data: {
        ...metrics,
        state,
        ...(trajectory === undefined ? {} : { trajectory }),
      },
    });
  }

  findRepetitions(experimentId: string): Promise<ExperimentRepetition[]> {
    return this.prisma.experimentRepetition
      .findMany({
        where: { experimentId },
        orderBy: [
          { strategy: 'asc' },
          { repetition: 'asc' },
          { attempt: 'desc' },
        ],
      })
      .then((attempts) => {
        const latestByRepetition = new Map<string, ExperimentRepetition>();

        for (const attempt of attempts) {
          const logicalKey = `${attempt.strategy}:${attempt.repetition}`;
          if (!latestByRepetition.has(logicalKey))
            latestByRepetition.set(logicalKey, attempt);
        }

        return [...latestByRepetition.values()];
      });
  }
}
