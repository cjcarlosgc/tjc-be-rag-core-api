import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  Prisma,
  type AnalysisContext,
  type AnalysisRetrieval,
  type AnalysisRunExecution,
  type RetrievalMode,
} from '../../generated/prisma/client.js';
import type { ExperimentRepetitionFailure } from '../../experiments/experiment-failure-fact.js';
import type { SandboxEvidenceFacts } from '../../sandbox/sandbox-evidence-facts.js';

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
  /**
   * WI-CORE-027 (DEC-EVID-003): evidencia de la ejecución. Ausente o null significa no observado y se guarda
   * como null (nunca como 0 ni como cadena vacía).
   */
  requestId?: string | null;
  correlationId?: string | null;
  durationMs?: number | null;
  facts?: SandboxEvidenceFacts | null;
  failure?: ExperimentRepetitionFailure | null;
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
    const { proposalId, attempt, requestId, correlationId, durationMs, facts, failure, ...identity } = input;
    // Los JSON nulos se escriben como DbNull (una columna Json no admite el null literal).
    const fields = {
      ...identity,
      requestId: requestId ?? null,
      correlationId: correlationId ?? null,
      durationMs: durationMs ?? null,
      facts: facts ?? Prisma.DbNull,
      failure: failure ?? Prisma.DbNull,
    };

    return this.prisma.analysisRunExecution.upsert({
      where: { proposalId_attempt: { proposalId, attempt } },
      create: { proposalId, attempt, ...fields },
      update: fields,
    });
  }

  /** Lecturas del trace (WI-CORE-026, corte C). Todas filtran por el Run; ninguna devuelve contenido de código. */
  findRetrievalsByRun(analysisRunId: string) {
    return this.prisma.analysisRetrieval.findMany({
      where: { analysisRunId },
      select: { id: true, analysisSymbolId: true },
    });
  }

  findContextsByRun(analysisRunId: string) {
    return this.prisma.analysisContext.findMany({
      where: { analysisRunId },
      select: { id: true, analysisSymbolId: true, functionalRuleIds: true },
    });
  }

  findProposalsByRun(analysisRunId: string) {
    return this.prisma.generatedTestProposal.findMany({
      where: { analysisRunId, analysisSymbolId: { not: null } },
      select: { id: true, analysisSymbolId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Ejecuciones del Run en orden de intento; el símbolo se obtiene por la propuesta. */
  findExecutionsByRun(analysisRunId: string) {
    return this.prisma.analysisRunExecution.findMany({
      where: { analysisRunId },
      select: {
        id: true,
        proposalId: true,
        executionId: true,
        attempt: true,
        executionProfile: true,
        outcome: true,
        proposal: { select: { analysisSymbolId: true } },
      },
      orderBy: [{ attempt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Publicaciones de companion PR del Run, la más reciente primero (empate por id). */
  findTestPublicationsByRun(analysisRunId: string) {
    return this.prisma.testPublication.findMany({
      where: { analysisRunId },
      select: {
        id: true,
        status: true,
        branchName: true,
        companionPullRequestUrl: true,
        sourceHeadSha: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
