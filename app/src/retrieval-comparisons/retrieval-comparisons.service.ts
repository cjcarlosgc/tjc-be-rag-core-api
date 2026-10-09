import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { AnalysisSymbolsRepository } from '../analysis-runs/persistence/analysis-symbols.repository.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { AnalysisSymbol, Prisma } from '../generated/prisma/client.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { RETRIEVAL_COMPARISON_JOB_TYPE, type RetrievalComparisonJobPayload } from './retrieval-comparison-job.handler.js';
import { RetrievalComparisonsRepository } from './persistence/retrieval-comparisons.repository.js';
import type { RetrievalComparison } from '../generated/prisma/client.js';
import type { RetrievalGroundTruthItem } from './retrieval-comparison-metrics.js';
import type { Page } from '../common/dto/page.response.js';
import {
  toRetrievalComparisonPage,
  toRetrievalComparisonStatusResponse,
  toRetrievalModeResultResponse,
  type RetrievalComparisonAcceptedResponse,
  type RetrievalComparisonResultsResponse,
  type RetrievalComparisonStatusResponse,
} from './dto/retrieval-comparison.response.js';

const DEFAULT_POLL_AFTER_MS = 1500;
const DEFAULT_PAGE_LIMIT = 20;
const MODE_ORDER: Record<string, number> = { SE: 0, SEM: 1 };

/** Cuerpo de `POST /retrieval-comparisons` (INTEROP-2.7 §6.15). El DTO con validadores se añade en el controlador. */
export interface CreateRetrievalComparisonRequest {
  analysisRunId: string;
  symbolFilePath: string;
  symbolQualifiedName: string;
  groundTruth?: RetrievalGroundTruthItem[];
}

/** Snapshot `AnalysisSymbolResponse` del símbolo, persistido al crear. */
function toSymbolSnapshot(symbol: AnalysisSymbol): Prisma.InputJsonObject {
  return {
    language: symbol.language,
    kind: symbol.kind,
    qualifiedName: symbol.qualifiedName,
    filePath: symbol.filePath,
    changeKind: symbol.changeKind,
  };
}

/**
 * Creación de comparaciones de retrieval (WI-CORE-022). Solo valida, persiste y encola; el trabajo
 * lo hace `RetrievalComparisonJobHandler`. No cambia el `AnalysisRun`.
 */
@Injectable()
export class RetrievalComparisonsService {
  constructor(
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly analysisSymbolsRepository: AnalysisSymbolsRepository,
    private readonly repository: RetrievalComparisonsRepository,
    private readonly jobsService: JobsService,
    private readonly idempotencyService: IdempotencyService,
    private readonly configService: ConfigService,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
  ) {}

  /**
   * Orden de validación (§6.15): el rol y el `404` del Run ya los aplicó el guard y `getById`; luego la
   * `Idempotency-Key` (400); el `404` del símbolo; el `422` de tipo; y la idempotencia al final.
   */
  async create(
    dto: CreateRetrievalComparisonRequest,
    idempotencyKey: string | undefined,
    ownerUserId: string,
  ): Promise<RetrievalComparisonAcceptedResponse> {
    const run = await this.analysisRunsService.getById(dto.analysisRunId, ownerUserId);
    this.idempotencyService.validateKey(idempotencyKey);

    // DEC-RC-001 (aprobada): un Run visible sin projectVersionId responde 409 ANALYSIS_NOT_FINISHED.
    if (!run.projectVersionId) {
      throw new AppException(
        ErrorCode.ANALYSIS_NOT_FINISHED,
        'El AnalysisRun todavía no tiene una versión de análisis; reintenta cuando termine el snapshot.',
        HttpStatus.CONFLICT,
      );
    }

    const projectVersionId = run.projectVersionId;

    // DEC-RC-001 (aprobada): un proyecto PHP responde 422 UNSUPPORTED_PROJECT, mismo código que los
    // experimentos. WI-CORE-028 retirará este rechazo solo en la comparación.
    await this.requireNotPhpVersion(projectVersionId);

    const symbol = await this.requireComparableSymbol(run.id, dto.symbolFilePath, dto.symbolQualifiedName);

    const pollAfterMs = this.configService.get<number>('INDEXING_POLL_AFTER_MS', DEFAULT_POLL_AFTER_MS);

    return this.idempotencyService.run({
      scope: 'RETRIEVAL_COMPARISON_CREATE',
      key: idempotencyKey,
      fingerprintInput: dto,
      create: async (tx) => {
        const comparison = await this.repository.create(
          {
            analysisRunId: run.id,
            projectId: run.projectId,
            projectVersionId,
            symbol: toSymbolSnapshot(symbol),
            idempotencyKey: idempotencyKey ?? null,
            groundTruth: dto.groundTruth ?? null,
          },
          tx,
        );

        const payload: RetrievalComparisonJobPayload = {
          retrievalComparisonId: comparison.id,
          projectId: run.projectId,
          projectVersionId,
          analysisRunId: run.id,
        };
        // Sin dedupeKey: cada creación es una comparación distinta; el replay lo resuelve el idempotency record.
        await this.jobsService.enqueue(RETRIEVAL_COMPARISON_JOB_TYPE, { ...payload }, tx);

        return {
          operationId: comparison.id,
          response: {
            analysisRunId: run.id,
            retrievalComparisonId: comparison.id,
            projectVersionId,
            status: 'PENDING' as const,
            pollAfterMs,
          },
        };
      },
      rebuildResponse: async (operationId) => {
        const comparison = await this.repository.findById(operationId);

        if (!comparison) {
          throw new AppException(
            ErrorCode.RETRIEVAL_COMPARISON_NOT_FOUND,
            `No existe la comparación de retrieval ${operationId}.`,
            HttpStatus.NOT_FOUND,
          );
        }

        return {
          analysisRunId: comparison.analysisRunId,
          retrievalComparisonId: comparison.id,
          projectVersionId: comparison.projectVersionId,
          status: 'PENDING' as const,
          pollAfterMs,
        };
      },
    });
  }

  /** `GET /retrieval-comparisons/{id}`: el rol lo aplica el guard (Reader; no visible = 404). */
  async getStatus(id: string): Promise<RetrievalComparisonStatusResponse> {
    return toRetrievalComparisonStatusResponse(await this.requireComparison(id));
  }

  /**
   * `GET /retrieval-comparisons/{id}/results`: `409 RETRIEVAL_COMPARISON_NOT_FINISHED` antes de un estado
   * terminal. Una comparación FAILED no tiene resultados persistidos y responde `modes: []`.
   */
  async getResults(id: string): Promise<RetrievalComparisonResultsResponse> {
    const comparison = await this.requireComparison(id);

    if (comparison.status !== 'COMPLETED' && comparison.status !== 'FAILED') {
      throw new AppException(
        ErrorCode.RETRIEVAL_COMPARISON_NOT_FINISHED,
        'La comparación de retrieval todavía no terminó.',
        HttpStatus.CONFLICT,
      );
    }

    const results = await this.repository.findResults(comparison.id);

    return {
      retrievalComparisonId: comparison.id,
      analysisRunId: comparison.analysisRunId,
      projectVersionId: comparison.projectVersionId,
      symbol: toRetrievalComparisonStatusResponse(comparison).symbol,
      modes: results
        .map(toRetrievalModeResultResponse)
        .sort((a, b) => (MODE_ORDER[a.mode] ?? 0) - (MODE_ORDER[b.mode] ?? 0)),
      completedAt: (comparison.completedAt ?? new Date()).toISOString(),
    };
  }

  /**
   * `GET /analysis-runs/{id}/retrieval-comparisons`: más reciente primero. Un Run inexistente o no visible
   * responde el mismo `404` que `GET /analysis-runs/{id}` (se resuelve con `getById`).
   */
  async listByAnalysisRun(
    analysisRunId: string,
    query: { cursor?: string; limit?: number },
    ownerUserId: string,
  ): Promise<Page<RetrievalComparisonStatusResponse>> {
    await this.analysisRunsService.getById(analysisRunId, ownerUserId);

    const take = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.repository.listByAnalysisRun(analysisRunId, take + 1, query.cursor);
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;

    return toRetrievalComparisonPage({ items, nextCursor: hasMore ? items[items.length - 1].id : null });
  }

  private async requireComparison(id: string): Promise<RetrievalComparison> {
    const comparison = await this.repository.findById(id);

    if (!comparison) {
      throw new AppException(
        ErrorCode.RETRIEVAL_COMPARISON_NOT_FOUND,
        `No existe una comparación de retrieval con id "${id}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return comparison;
  }

  /** `422 UNSUPPORTED_PROJECT` si la versión analizada es PHP (DEC-RC-001). */
  private async requireNotPhpVersion(projectVersionId: string): Promise<void> {
    const version = await this.projectVersionsRepository.findById(projectVersionId);

    if (version?.language === 'PHP') {
      throw new AppException(
        ErrorCode.UNSUPPORTED_PROJECT,
        'La comparación de retrieval todavía no soporta proyectos PHP.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  /**
   * Símbolo del Run por `(filePath, qualifiedName)`: `404` si no existe; `422` si no es METHOD o FUNCTION
   * DIRECTLY_CHANGED. Sin chunks indexados, el job termina FAILED con RETRIEVAL_TARGET_UNRESOLVABLE.
   */
  private async requireComparableSymbol(analysisRunId: string, filePath: string, qualifiedName: string): Promise<AnalysisSymbol> {
    const symbols = await this.analysisSymbolsRepository.findByAnalysisRun(analysisRunId);
    const symbol = symbols.find((candidate) => candidate.filePath === filePath && candidate.qualifiedName === qualifiedName);

    if (!symbol) {
      throw new AppException(
        ErrorCode.ANALYSIS_SYMBOL_NOT_FOUND,
        `No existe el símbolo "${qualifiedName}" en "${filePath}" dentro del AnalysisRun.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const comparable = (symbol.kind === 'METHOD' || symbol.kind === 'FUNCTION') && symbol.changeKind === 'DIRECTLY_CHANGED';
    if (!comparable) {
      throw new AppException(
        ErrorCode.UNSUPPORTED_SYMBOL_KIND,
        'La comparación de retrieval solo acepta un símbolo METHOD o FUNCTION DIRECTLY_CHANGED.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return symbol;
  }
}
