import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * WI-CORE-027 (corte C): lecturas de la exportación de evidencia. Son consultas de solo lectura, filtradas por el
 * AnalysisRun o por las repeticiones ya autorizadas. Cada una selecciona columnas explícitas: ningún campo de
 * contenido (`content`, `storageKey`, `excerpt` fuera de `detail`) se pide.
 */
@Injectable()
export class EvidenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findRetrievalsForEvidence(analysisRunId: string) {
    return this.prisma.analysisRetrieval.findMany({
      where: { analysisRunId },
      select: { id: true, analysisSymbolId: true, mode: true, config: true, candidates: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  findContextsForEvidence(analysisRunId: string) {
    return this.prisma.analysisContext.findMany({
      where: { analysisRunId },
      select: {
        id: true,
        analysisSymbolId: true,
        selectedChunkIds: true,
        discardedChunkIds: true,
        selectedTokens: true,
        tokenBudget: true,
        functionalRuleIds: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Propuestas del Run con símbolo, en orden de creación; sin `storageKey` (el contenido no sale). */
  findProposalsForEvidence(analysisRunId: string) {
    return this.prisma.generatedTestProposal.findMany({
      where: { analysisRunId, analysisSymbolId: { not: null } },
      select: { id: true, contentSha256: true, generation: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  findExecutionsForEvidence(analysisRunId: string) {
    return this.prisma.analysisRunExecution.findMany({
      where: { analysisRunId },
      select: {
        id: true,
        proposalId: true,
        executionId: true,
        attempt: true,
        executionProfile: true,
        requestId: true,
        correlationId: true,
        durationMs: true,
        facts: true,
      },
      orderBy: [{ attempt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Trazas de los intentos vigentes de un experimento, por la repetición a la que pertenecen. */
  findContextTracesByRepetitionIds(experimentRepetitionIds: string[]) {
    if (experimentRepetitionIds.length === 0) return Promise.resolve([]);

    return this.prisma.contextTrace.findMany({
      where: { experimentRepetitionId: { in: experimentRepetitionIds } },
      select: { id: true, experimentRepetitionId: true, kind: true, detail: true },
    });
  }
}
