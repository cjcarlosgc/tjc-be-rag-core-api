import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, type GeneratedTestProposal, type GeneratedTestProposalStatus } from '../generated/prisma/client.js';

/**
 * WI-CORE-027 (DEC-EVID-003): generación que produjo la propuesta. Cada campo es null si no se conoce
 * (proveedor o modelo no informados, `modelVersion` no confirmada en la llamada del producto).
 */
export type ProposalGenerationEvidence = {
  provider: string | null;
  model: string | null;
  modelVersion: string | null;
  reasoningEffort: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
};

export interface CreateGeneratedTestProposalInput {
  analysisRunId: string;
  /** WI-CORE-026 (corte B): símbolo del que se generó la propuesta; clave natural con `analysisRunId`. */
  analysisSymbolId: string;
  relativePath: string;
  symbolLanguage: GeneratedTestProposal['symbolLanguage'];
  symbolKind: GeneratedTestProposal['symbolKind'];
  qualifiedName: string;
  filePath: string;
  storageKey: string;
  contentSha256: string;
  status: GeneratedTestProposalStatus;
  failureSummary?: string | null;
  /** WI-CORE-026: `context_id` del contexto usado para generar la propuesta. */
  contextId?: string | null;
  /** WI-CORE-027: generación de la propuesta; null si no hubo resultado de generación. */
  generation?: ProposalGenerationEvidence | null;
}

@Injectable()
export class GeneratedTestProposalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert por `(analysisRunId, analysisSymbolId)`: un reintento del job actualiza la propuesta del
   * símbolo en lugar de duplicarla. `failureSummary` se escribe siempre (null limpia un fallo previo).
   */
  upsertForSymbol(input: CreateGeneratedTestProposalInput): Promise<GeneratedTestProposal> {
    const { analysisRunId, analysisSymbolId, generation, ...rest } = input;
    // Un reintento sin generación limpia la anterior (DbNull): nunca se mezcla con el contenido nuevo.
    const fields = { ...rest, generation: generation ?? Prisma.DbNull };

    return this.prisma.generatedTestProposal.upsert({
      where: { analysisRunId_analysisSymbolId: { analysisRunId, analysisSymbolId } },
      create: { analysisRunId, analysisSymbolId, ...fields },
      update: fields,
    });
  }

  findByAnalysisRun(analysisRunId: string): Promise<GeneratedTestProposal[]> {
    return this.prisma.generatedTestProposal.findMany({
      where: { analysisRunId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** HU40: valida que las propuestas a publicar pertenezcan de verdad a ese Run. */
  findByIdsForRun(analysisRunId: string, ids: string[]): Promise<GeneratedTestProposal[]> {
    return this.prisma.generatedTestProposal.findMany({
      where: { analysisRunId, id: { in: ids } },
    });
  }

  async markPublished(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.prisma.generatedTestProposal.updateMany({
      where: { id: { in: ids } },
      data: { status: 'PUBLISHED' },
    });
  }
}
