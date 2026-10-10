import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { AnalysisRunsService } from './analysis-runs.service.js';
import { AnalysisSymbolsRepository } from './persistence/analysis-symbols.repository.js';
import { AnalysisTraceRepository } from './persistence/analysis-trace.repository.js';
import { toAnalysisSymbolResponse } from './dto/analysis-run.response.js';
import type {
  AnalysisRunTraceResponse,
  TraceExecutionResponse,
  TracePublicationResponse,
  TraceTargetResponse,
} from './dto/analysis-run-trace.response.js';
import type { AnalysisRun, AnalysisSymbol } from '../generated/prisma/client.js';

const NOT_FINISHED_STATUSES: ReadonlySet<string> = new Set(['QUEUED', 'PROCESSING']);

interface PublicationRow {
  id: string;
  status: 'PENDING' | 'PUBLISHING' | 'PUBLISHED' | 'STALE' | 'FAILED' | 'CLOSED';
  branchName: string | null;
  companionPullRequestUrl: string | null;
  sourceHeadSha: string;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Posición determinista de un símbolo: el modelo no guarda línea; se usa ruta, nombre calificado e id. */
function compareSymbolPosition(a: AnalysisSymbol, b: AnalysisSymbol): number {
  return (
    compareText(a.filePath, b.filePath) || compareText(a.qualifiedName, b.qualifiedName) || compareText(a.id, b.id)
  );
}

/** Más reciente primero; empate por id descendente, como en la lectura del repositorio. */
function compareLatestPublication(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || compareText(b.id, a.id);
}

function isTraceTarget(symbol: AnalysisSymbol): boolean {
  return symbol.changeKind === 'DIRECTLY_CHANGED' && (symbol.kind === 'METHOD' || symbol.kind === 'FUNCTION');
}

/**
 * WI-CORE-026 (INTEROP-2.7 §6.16): arma el trace operativo de un AnalysisRun. Es solo lectura: no
 * altera el contexto entregado al LLM ni recalcula evidencia. Un enlace sin fila en un Run terminal
 * consta como NOT_APPLICABLE.
 */
@Injectable()
export class AnalysisRunTraceService {
  constructor(
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly analysisSymbolsRepository: AnalysisSymbolsRepository,
    private readonly analysisTraceRepository: AnalysisTraceRepository,
  ) {}

  async getTrace(analysisRunId: string, ownerUserId: string): Promise<AnalysisRunTraceResponse> {
    const run = await this.analysisRunsService.getById(analysisRunId, ownerUserId);

    if (NOT_FINISHED_STATUSES.has(run.status)) {
      throw new AppException(
        ErrorCode.EVIDENCE_NOT_FINISHED,
        `El AnalysisRun "${run.id}" está en "${run.status}"; el trace queda disponible cuando termina.`,
        HttpStatus.CONFLICT,
      );
    }

    const [{ targetSymbols, publication }, retrievals, contexts, proposals, executions] = await Promise.all([
      this.loadTargets(run),
      this.analysisTraceRepository.findRetrievalsByRun(run.id),
      this.analysisTraceRepository.findContextsByRun(run.id),
      this.analysisTraceRepository.findProposalsByRun(run.id),
      this.analysisTraceRepository.findExecutionsByRun(run.id),
    ]);

    const retrievalBySymbol = new Map(retrievals.map((row) => [row.analysisSymbolId, row]));
    const contextBySymbol = new Map(contexts.map((row) => [row.analysisSymbolId, row]));
    const proposalsBySymbol = groupBy(proposals, (row) => row.analysisSymbolId);
    const executionsBySymbol = groupBy(
      [...executions].sort((a, b) => a.attempt - b.attempt),
      (row) => row.proposal.analysisSymbolId,
    );
    const targets: TraceTargetResponse[] = targetSymbols.map((symbol) => {
      const retrieval = retrievalBySymbol.get(symbol.id);
      const context = contextBySymbol.get(symbol.id);
      const symbolProposals = proposalsBySymbol.get(symbol.id) ?? [];
      const symbolExecutions = executionsBySymbol.get(symbol.id) ?? [];

      return {
        symbol: toAnalysisSymbolResponse(symbol),
        retrieval: retrieval
          ? { status: 'PRESENT', retrievalId: retrieval.id }
          : { status: 'NOT_APPLICABLE', retrievalId: null },
        context: context
          ? { status: 'PRESENT', contextId: context.id, functionalRuleIds: context.functionalRuleIds }
          : { status: 'NOT_APPLICABLE', contextId: null, functionalRuleIds: [] },
        generation: {
          status: symbolProposals.length > 0 ? 'PRESENT' : 'NOT_APPLICABLE',
          proposalIds: symbolProposals.map((row) => row.id),
        },
        executions: {
          status: symbolExecutions.length > 0 ? 'PRESENT' : 'NOT_APPLICABLE',
          items: symbolExecutions.map(
            (row): TraceExecutionResponse => ({
              executionId: row.executionId,
              proposalId: row.proposalId,
              attempt: row.attempt,
              executionProfile: row.executionProfile,
              outcome: row.outcome,
            }),
          ),
        },
      };
    });

    return {
      analysisRunId: run.id,
      repositoryName: run.repositoryName,
      pullRequestNumber: run.prNumber,
      headSha: run.headSha,
      changeset: {
        status: targets.length > 0 ? 'PRESENT' : 'NOT_APPLICABLE',
        targetCount: targets.length,
      },
      targets,
      publication,
    };
  }

  /**
   * WI-CORE-027: objetivos (símbolos DIRECTLY_CHANGED METHOD/FUNCTION en el orden del trace) y publicación del
   * Run. Lo usan el trace y la exportación de evidencia, para que ninguna de las dos repita la regla. Solo lee;
   * el estado terminal lo exige el llamador.
   */
  async loadTargets(
    run: Pick<AnalysisRun, 'id' | 'checkId' | 'checkPublishedAt'>,
  ): Promise<{ targetSymbols: AnalysisSymbol[]; publication: TracePublicationResponse }> {
    const [symbols, publications] = await Promise.all([
      this.analysisSymbolsRepository.findByAnalysisRun(run.id),
      this.analysisTraceRepository.findTestPublicationsByRun(run.id),
    ]);
    const latestPublication = [...publications].sort(compareLatestPublication)[0] ?? null;

    return {
      targetSymbols: symbols.filter(isTraceTarget).sort(compareSymbolPosition),
      publication: toPublication(latestPublication, run.checkId ?? null, run.checkPublishedAt ?? null),
    };
  }
}

/**
 * `publication` (DEC-TRACE-002): PRESENT si hay Check publicado (con o sin id) o TestPublication;
 * `freshness` solo de la publicación más reciente (CURRENT con PUBLISHED, STALE con STALE, null en
 * cualquier otro estado). `checkId` es el id del Check o null (GitHub puede responder 204 sin id).
 */
function toPublication(
  latest: PublicationRow | null,
  checkId: string | null,
  checkPublishedAt: Date | null,
): TracePublicationResponse {
  const freshness = latest?.status === 'PUBLISHED' ? 'CURRENT' : latest?.status === 'STALE' ? 'STALE' : null;
  const hasCheck = checkId !== null || checkPublishedAt !== null;

  return {
    status: hasCheck || latest !== null ? 'PRESENT' : 'NOT_APPLICABLE',
    checkId,
    companionBranch: latest?.branchName ?? null,
    companionPullRequestUrl: latest?.companionPullRequestUrl ?? null,
    sourceHeadSha: latest?.sourceHeadSha ?? null,
    freshness,
  };
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return groups;
}
