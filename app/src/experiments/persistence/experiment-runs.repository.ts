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
  runnerHint: 'JEST' | 'VITEST' | 'PHPUNIT';
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
  /**
   * WI-CORE-025: interno (no se expone en DTO ni INTEROP). `true` solo cuando el Sandbox devolvió
   * TIMED_OUT; omitido en otros casos (queda NULL). Discriminador de la redelivery.
   */
  sandboxTimedOut?: boolean;
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
          ...(modelConfig.endpoint !== undefined ? { endpoint: modelConfig.endpoint } : {}),
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

  /**
   * Arranca (o reanuda tras un reintento) el run. Limpia el fallo y el cierre de un intento anterior
   * (WI-CORE-030, H4): un run que pasó por `markFailed` y vuelve a ejecutarse no queda con `failureCode`.
   */
  markStarted(id: string): Promise<ExperimentRun> {
    return this.prisma.experimentRun.update({
      where: { id },
      data: {
        status: ExperimentStatus.RUNNING,
        startedAt: new Date(),
        failureCode: null,
        failureMessage: null,
        completedAt: null,
      },
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

  /**
   * Marca COMPLETED solo si todos los slots lógicos (`totalRepetitions`) tienen un intento terminal
   * y no queda ninguna repetición RUNNING (WI-CORE-025 (3c), guardia). Se serializa con
   * `refreshCompletedRepetitions` por el bloqueo de la fila del experimento.
   */
  complete(id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "experiment_runs" WHERE "id" = ${id} FOR UPDATE`;

      const run = await tx.experimentRun.findUnique({
        where: { id },
        select: { totalRepetitions: true },
      });
      const running = await tx.experimentRepetition.count({
        where: { experimentId: id, state: ExperimentRepetitionState.RUNNING },
      });
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
      const terminalSlots = new Set(
        terminalAttempts.map(({ strategy, repetition }) => `${strategy}:${repetition}`),
      ).size;

      if (!run || running > 0 || terminalSlots < run.totalRepetitions) {
        throw new Error(
          'El experimento no puede quedar COMPLETED: faltan slots lógicos terminales o hay repeticiones RUNNING.',
        );
      }

      // Limpia un fallo previo (WI-CORE-030, H4): un run COMPLETED no conserva failureCode/failureMessage.
      await tx.experimentRun.update({
        where: { id },
        data: {
          status: ExperimentStatus.COMPLETED,
          completedAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      });
    });
  }

  /** Renueva el latido de un intento que sigue RUNNING. Un intento ya cerrado no se toca. */
  touchRepetitionHeartbeat(id: string, at: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.experimentRepetition.updateMany({
      where: { id, state: ExperimentRepetitionState.RUNNING },
      data: { lastHeartbeatAt: at },
    });
  }

  /**
   * Cierra como FAILED/INFRASTRUCTURE un intento RUNNING con latido vencido (WI-CORE-025 (3c)).
   * Solo fija estado, tipo de fallo, resumen y, si se pide, `technicallyEvaluable: false`; el resto de
   * columnas y la evidencia de la traza se conservan. La traza en CAPTURING pasa a FAILED.
   */
  async closeInterruptedRepetition(
    id: string,
    options: { errorSummary: string; technicallyEvaluable?: false },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.experimentRepetition.updateMany({
        where: { id, state: ExperimentRepetitionState.RUNNING },
        data: {
          state: ExperimentRepetitionState.FAILED,
          failureType: 'INFRASTRUCTURE',
          errorSummary: options.errorSummary,
          ...(options.technicallyEvaluable === false ? { technicallyEvaluable: false } : {}),
        },
      });

      if (count === 0) return;

      await tx.contextTrace.updateMany({
        where: { experimentRepetitionId: id, state: 'CAPTURING' },
        data: { state: 'FAILED' },
      });
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

  /**
   * Escribe el resultado final de un intento SOLO si sigue RUNNING (WI-CORE-030, H3): un intento ya
   * cerrado (p. ej. liberado como interrumpido por otro worker) no se sobrescribe. Devuelve si escribió.
   */
  async updateRepetitionById(
    id: string,
    repetition: ExperimentRepetitionInput,
    state: 'COMPLETED' | 'FAILED',
  ): Promise<boolean> {
    const {
      repetition: _logicalRepetition,
      strategy: _strategy,
      trajectory,
      ...metrics
    } = repetition;

    const { count } = await this.prisma.experimentRepetition.updateMany({
      where: { id, state: ExperimentRepetitionState.RUNNING },
      data: {
        ...metrics,
        state,
        ...(trajectory === undefined ? {} : { trajectory }),
      },
    });

    return count > 0;
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
