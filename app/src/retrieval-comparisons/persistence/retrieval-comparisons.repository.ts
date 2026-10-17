import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma, type RetrievalComparison, type RetrievalComparisonResult } from '../../generated/prisma/client.js';
import { RetrievalComparisonStatus } from '../../generated/prisma/enums.js';
import type { RetrievalMode } from '../../retrieval/retrieval.service.js';
import type { RetrievalGroundTruthItem } from '../retrieval-comparison-metrics.js';

export interface CreateRetrievalComparisonInput {
  analysisRunId: string;
  projectId: string;
  projectVersionId: string;
  /** Snapshot `AnalysisSymbolResponse` del símbolo, tomado al crear. */
  symbol: Prisma.InputJsonObject;
  idempotencyKey: string | null;
  groundTruth: RetrievalGroundTruthItem[] | null;
}

/** Resultado de un modo listo para persistir: `id` (retrievalId) lo asigna el repositorio. */
export interface RetrievalModeResultInput {
  mode: RetrievalMode;
  config: Prisma.InputJsonObject;
  candidates: Prisma.InputJsonArray;
  metrics: Prisma.InputJsonObject | null;
}

/** Estados en los que una comparación todavía puede recibir escrituras del job. */
const OPEN_STATUSES: RetrievalComparisonStatus[] = [RetrievalComparisonStatus.PENDING, RetrievalComparisonStatus.RUNNING];

/**
 * Persistencia de `retrieval_comparisons` y `retrieval_comparison_results` (WI-CORE-022). Las
 * transiciones se condicionan al estado: un COMPLETED o FAILED nunca se sobrescribe.
 */
@Injectable()
export class RetrievalComparisonsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateRetrievalComparisonInput, tx?: Prisma.TransactionClient): Promise<RetrievalComparison> {
    return (tx ?? this.prisma).retrievalComparison.create({
      data: {
        analysisRunId: input.analysisRunId,
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        symbol: input.symbol,
        idempotencyKey: input.idempotencyKey,
        groundTruth:
          input.groundTruth === null
            ? Prisma.DbNull
            : input.groundTruth.map(
                (item): Prisma.InputJsonObject => ({
                  filePath: item.filePath,
                  symbolQualifiedName: item.symbolQualifiedName,
                }),
              ),
      },
    });
  }

  /** Sin scoping por propietario: uso de job handlers y de lecturas encadenadas a un recurso ya autorizado. */
  findById(id: string): Promise<RetrievalComparison | null> {
    return this.prisma.retrievalComparison.findUnique({ where: { id } });
  }

  findResults(comparisonId: string): Promise<RetrievalComparisonResult[]> {
    return this.prisma.retrievalComparisonResult.findMany({
      where: { comparisonId },
      orderBy: { mode: 'asc' },
    });
  }

  /** Listado más reciente primero (`createdAt desc, id desc`); `take` incluye la fila extra para saber si hay más. */
  listByAnalysisRun(analysisRunId: string, take: number, cursor?: string): Promise<RetrievalComparison[]> {
    return this.prisma.retrievalComparison.findMany({
      where: { analysisRunId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  /** Arranca (o reanuda tras un fallo o un worker caído) la comparación; limpia el fallo previo. */
  async markRunning(id: string): Promise<boolean> {
    const { count } = await this.prisma.retrievalComparison.updateMany({
      where: { id, status: { in: [...OPEN_STATUSES, RetrievalComparisonStatus.FAILED] } },
      data: {
        status: RetrievalComparisonStatus.RUNNING,
        startedAt: new Date(),
        completedAt: null,
        failureCode: null,
        failureMessage: null,
      },
    });

    return count > 0;
  }

  /** Registra código y mensaje saneados sin cambiar el estado (un reintento puede aún completar). */
  async recordFailure(id: string, failureCode: string, failureMessage: string): Promise<void> {
    await this.prisma.retrievalComparison.updateMany({
      where: { id, status: { in: OPEN_STATUSES } },
      data: { failureCode, failureMessage },
    });
  }

  /** Cierra como FAILED solo una comparación abierta. Devuelve si la escritura aplicó. */
  async markFailed(id: string, failureCode: string, failureMessage: string): Promise<boolean> {
    const { count } = await this.prisma.retrievalComparison.updateMany({
      where: { id, status: { in: OPEN_STATUSES } },
      data: {
        status: RetrievalComparisonStatus.FAILED,
        failureCode,
        failureMessage,
        completedAt: new Date(),
      },
    });

    return count > 0;
  }

  /**
   * Persiste los resultados de ambos modos y marca COMPLETED en UNA transacción. El cambio de estado
   * va primero y está condicionado a estado abierto: si la comparación ya quedó cerrada, no se escribe
   * nada y devuelve `false`. Los resultados se hacen upsert por `(comparisonId, mode)`, así que un
   * reintento no duplica filas.
   */
  saveResultsAndComplete(id: string, results: RetrievalModeResultInput[]): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.retrievalComparison.updateMany({
        where: { id, status: { in: OPEN_STATUSES } },
        data: {
          status: RetrievalComparisonStatus.COMPLETED,
          completedAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      });

      if (count === 0) {
        return false;
      }

      for (const result of results) {
        const data = {
          config: result.config,
          candidates: result.candidates,
          metrics: result.metrics ?? Prisma.DbNull,
        };

        await tx.retrievalComparisonResult.upsert({
          where: { comparisonId_mode: { comparisonId: id, mode: result.mode } },
          create: { id: randomUUID(), comparisonId: id, mode: result.mode, ...data },
          update: data,
        });
      }

      return true;
    });
  }
}
