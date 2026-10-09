import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  AnalysisContext,
  AnalysisRetrieval,
  AnalysisRunExecution,
  Prisma,
  RetrievalMode,
} from '../../generated/prisma/client.js';

export interface UpsertAnalysisRetrievalInput {
  analysisRunId: string;
  analysisSymbolId: string;
  mode: RetrievalMode;
  config: Prisma.InputJsonValue;
  candidates: Prisma.InputJsonValue;
}

export interface UpsertAnalysisRunExecutionInput {
  analysisRunId: string;
  proposalId: string;
  executionId: string;
  attempt: number;
  executionProfile: string;
  outcome: string;
}

export interface UpsertAnalysisContextInput {
  analysisRunId: string;
  analysisSymbolId: string;
  retrievalId: string;
  selectedChunkIds: string[];
  discardedChunkIds: string[];
  selectedTokens: number;
  tokenBudget: number;
  functionalRuleIds: string[];
  functionalRulesRetrieved: number;
  functionalRulesSelected: number;
  functionalRulesOmitted: number;
  omittedFunctionalRules: Prisma.InputJsonValue;
}

/**
 * WI-CORE-026: escritura de `analysis_retrievals` y `analysis_contexts`. Upsert por
 * `(analysisRunId, analysisSymbolId)`: un reintento del job actualiza la fila del target y conserva su
 * `id`, de modo que el `retrieval_id`/`context_id` de un target no se duplica.
 */
@Injectable()
export class AnalysisTraceRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsertRetrieval(input: UpsertAnalysisRetrievalInput): Promise<AnalysisRetrieval> {
    const { analysisRunId, analysisSymbolId, mode, config, candidates } = input;

    return this.prisma.analysisRetrieval.upsert({
      where: { analysisRunId_analysisSymbolId: { analysisRunId, analysisSymbolId } },
      create: { analysisRunId, analysisSymbolId, mode, config, candidates },
      update: { mode, config, candidates },
    });
  }

  /**
   * WI-CORE-026 (corte B): ejecución de una propuesta en un intento. Upsert por `(proposalId, attempt)`:
   * repetir la captura del mismo intento no duplica la fila.
   */
  upsertExecution(input: UpsertAnalysisRunExecutionInput): Promise<AnalysisRunExecution> {
    const { proposalId, attempt, ...fields } = input;

    return this.prisma.analysisRunExecution.upsert({
      where: { proposalId_attempt: { proposalId, attempt } },
      create: { proposalId, attempt, ...fields },
      update: fields,
    });
  }

  upsertContext(input: UpsertAnalysisContextInput): Promise<AnalysisContext> {
    const { analysisRunId, analysisSymbolId, ...fields } = input;

    return this.prisma.analysisContext.upsert({
      where: { analysisRunId_analysisSymbolId: { analysisRunId, analysisSymbolId } },
      create: { analysisRunId, analysisSymbolId, ...fields },
      update: fields,
    });
  }
}
