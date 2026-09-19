import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { GeneratedTestProposal, GeneratedTestProposalStatus } from '../generated/prisma/client.js';

export interface CreateGeneratedTestProposalInput {
  analysisRunId: string;
  relativePath: string;
  symbolLanguage: GeneratedTestProposal['symbolLanguage'];
  symbolKind: GeneratedTestProposal['symbolKind'];
  qualifiedName: string;
  filePath: string;
  storageKey: string;
  contentSha256: string;
  status: GeneratedTestProposalStatus;
  failureSummary?: string;
}

@Injectable()
export class GeneratedTestProposalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateGeneratedTestProposalInput): Promise<GeneratedTestProposal> {
    return this.prisma.generatedTestProposal.create({ data: input });
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
