import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AnalysisSymbol, Prisma } from '../../generated/prisma/client.js';

export interface AnalysisSymbolToPersist {
  language: Prisma.AnalysisSymbolCreateManyInput['language'];
  kind: Prisma.AnalysisSymbolCreateManyInput['kind'];
  qualifiedName: string;
  filePath: string;
  changeKind: Prisma.AnalysisSymbolCreateManyInput['changeKind'];
}

@Injectable()
export class AnalysisSymbolsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertMany(analysisRunId: string, symbols: AnalysisSymbolToPersist[]): Promise<void> {
    if (symbols.length === 0) {
      return;
    }

    await this.prisma.analysisSymbol.createMany({
      data: symbols.map((symbol) => ({ ...symbol, analysisRunId })),
    });
  }

  findByAnalysisRun(analysisRunId: string): Promise<AnalysisSymbol[]> {
    return this.prisma.analysisSymbol.findMany({ where: { analysisRunId } });
  }
}
