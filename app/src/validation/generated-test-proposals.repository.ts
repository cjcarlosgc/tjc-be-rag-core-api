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
}
