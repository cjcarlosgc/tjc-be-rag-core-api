import { Injectable } from '@nestjs/common';
import type { ContextTrace, DiscoveredFile, ExperimentRepetition, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface BeginContextTraceAttemptInput {
  experimentId: string;
  projectId: string;
  projectVersionId: string;
  targetId: string;
  strategy: 'RAG' | 'GENERALIST_AGENT';
  kind: 'RAG' | 'AGENT';
  repetition: number;
}

export interface BegunContextTraceAttempt {
  repetition: ExperimentRepetition;
  trace: ContextTrace;
}

export interface DiscoveredFilePage {
  items: Array<Pick<DiscoveredFile, 'id' | 'filePath'>>;
  hasMore: boolean;
}

function isSafeRelativePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !filePath.startsWith('/') &&
    !filePath.includes('\\') &&
    !filePath.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')
  );
}

// Each row binds three values. Keep inserts well below PostgreSQL's bind
// parameter ceiling while retaining a useful bulk-insert size.
const DISCOVERED_FILES_INSERT_BATCH_SIZE = 1_000;

@Injectable()
export class ContextTracesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Serializa la asignación de intentos por repetición lógica. Las seis
   * repeticiones de un experimento conservan concurrencia entre sí; un replay
   * de la misma repetición obtiene un attempt nuevo y obsoleta el anterior.
   */
  beginAttempt(input: BeginContextTraceAttemptInput): Promise<BegunContextTraceAttempt> {
    if ((input.strategy === 'RAG') !== (input.kind === 'RAG')) {
      throw new Error('ContextTrace kind debe corresponder con la estrategia experimental.');
    }

    return this.prisma.$transaction(async (tx) => {
      const lockKey = `context-trace:${input.experimentId}:${input.strategy}:${input.repetition}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`;

      const previous = await tx.experimentRepetition.findFirst({
        where: {
          experimentId: input.experimentId,
          strategy: input.strategy,
          repetition: input.repetition,
        },
        orderBy: { attempt: 'desc' },
      });
      const attempt = (previous?.attempt ?? 0) + 1;
      const repetition = await tx.experimentRepetition.create({
        data: {
          experimentId: input.experimentId,
          strategy: input.strategy,
          repetition: input.repetition,
          attempt,
          state: 'RUNNING',
        },
      });

      await tx.contextTrace.updateMany({
        where: {
          experimentId: input.experimentId,
          strategy: input.strategy,
          repetition: input.repetition,
          current: true,
        },
        data: { current: false },
      });

      const trace = await tx.contextTrace.create({
        data: {
          projectId: input.projectId,
          projectVersionId: input.projectVersionId,
          targetId: input.targetId,
          experimentId: input.experimentId,
          experimentRepetitionId: repetition.id,
          strategy: input.strategy,
          kind: input.kind,
          repetition: input.repetition,
          attempt,
          current: true,
          state: 'CAPTURING',
        },
      });

      return { repetition, trace };
    });
  }

  updateDetail(traceId: string, detail: Prisma.InputJsonValue): Promise<ContextTrace> {
    return this.prisma.contextTrace.update({ where: { id: traceId }, data: { detail } });
  }

  updateAgentCounters(
    traceId: string,
    counters: { toolCalls: number; filesInspected: number },
  ): Promise<ContextTrace> {
    return this.prisma.contextTrace.update({ where: { id: traceId }, data: counters });
  }

  finishTrace(traceId: string): Promise<ContextTrace> {
    return this.prisma.contextTrace.update({ where: { id: traceId }, data: { state: 'COMPLETE' } });
  }

  failTrace(traceId: string): Promise<ContextTrace> {
    return this.prisma.contextTrace.update({ where: { id: traceId }, data: { state: 'FAILED' } });
  }

  finishRepetition(repetitionId: string, state: 'COMPLETED' | 'FAILED'): Promise<ExperimentRepetition> {
    return this.prisma.experimentRepetition.update({ where: { id: repetitionId }, data: { state } });
  }

  async insertDiscoveredFiles(traceId: string, step: number, filePaths: string[]): Promise<void> {
    const uniquePaths = [...new Set(filePaths)];
    if (uniquePaths.length === 0) return;

    if (uniquePaths.some((filePath) => !isSafeRelativePath(filePath))) {
      throw new Error('DiscoveredFile requiere rutas relativas POSIX seguras.');
    }

    await this.prisma.$transaction(async (tx) => {
      for (let offset = 0; offset < uniquePaths.length; offset += DISCOVERED_FILES_INSERT_BATCH_SIZE) {
        const batch = uniquePaths.slice(offset, offset + DISCOVERED_FILES_INSERT_BATCH_SIZE);
        await tx.discoveredFile.createMany({
          data: batch.map((filePath) => ({ contextTraceId: traceId, step, filePath })),
          skipDuplicates: true,
        });
      }
    });
  }

  async listDiscoveredFiles(
    traceId: string,
    step: number,
    cursor: string | undefined,
    take: number,
  ): Promise<DiscoveredFilePage> {
    const rows = await this.prisma.discoveredFile.findMany({
      where: {
        contextTraceId: traceId,
        step,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: take + 1,
      select: { id: true, filePath: true },
    });

    return { items: rows.slice(0, take), hasMore: rows.length > take };
  }
}
