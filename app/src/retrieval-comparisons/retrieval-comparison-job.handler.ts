import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AnalysisSymbol, Prisma } from '../generated/prisma/client.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import type { RetrievalTarget } from '../retrieval/generation-context.js';
import { RetrievalService, type RetrievalCandidate } from '../retrieval/retrieval.service.js';
import { toRetrievalTarget } from '../validation/symbol-target.util.js';
import { RetrievalComparisonsRepository, type RetrievalModeResultInput } from './persistence/retrieval-comparisons.repository.js';
import { computeRetrievalMetrics, type RetrievalGroundTruthItem } from './retrieval-comparison-metrics.js';
import { rankComparisonCandidates, type RankedComparisonCandidate } from './retrieval-comparison-ranking.js';

/** Tipo de job sin `dedupeKey` (WI-CORE-022, §6.15). Se libera tras lock vencido por DEC-RC-002. */
export const RETRIEVAL_COMPARISON_JOB_TYPE = 'retrieval-comparison';

/** Candidatos semánticos de los que se derivan SE y SEM (§6.15: `semanticTopK` = 20). */
export const SEMANTIC_TOP_K = 20;

/** `failureCode` abiertos de una comparación FAILED (§6.15). Mensajes fijos: nunca se persiste texto crudo del error. */
export const RETRIEVAL_TARGET_UNRESOLVABLE_CODE = 'RETRIEVAL_TARGET_UNRESOLVABLE';
export const RETRIEVAL_COMPARISON_FAILED_CODE = 'RETRIEVAL_COMPARISON_FAILED';
export const RETRIEVAL_COMPARISON_WORKER_LOST_CODE = 'RETRIEVAL_COMPARISON_WORKER_LOST';

export const TARGET_UNRESOLVABLE_MESSAGE = 'No se encontró un chunk indexado para el símbolo objetivo en la versión del AnalysisRun.';
export const COMPARISON_FAILED_MESSAGE = 'La comparación de retrieval falló durante la recuperación; el job se reintentará si quedan intentos.';
export const WORKER_LOST_MESSAGE = 'El worker que ejecutaba la comparación dejó de responder y agotó sus intentos.';

export interface RetrievalComparisonJobPayload {
  retrievalComparisonId: string;
  projectId: string;
  projectVersionId: string;
  analysisRunId: string;
}

/** Error que termina el intento sin el mensaje crudo: así `lastError` del job tampoco guarda detalles. */
class RetrievalComparisonAttemptError extends Error {
  constructor() {
    super(COMPARISON_FAILED_MESSAGE);
    this.name = 'RetrievalComparisonAttemptError';
  }
}

/** Lee el snapshot `symbol` de la comparación. Devuelve `null` si no es un METHOD/FUNCTION válido. */
export function readSymbolTarget(symbol: Prisma.JsonValue): RetrievalTarget | null {
  if (typeof symbol !== 'object' || symbol === null || Array.isArray(symbol)) {
    return null;
  }

  const { kind, qualifiedName, filePath } = symbol as Record<string, unknown>;
  if ((kind !== 'METHOD' && kind !== 'FUNCTION') || typeof qualifiedName !== 'string' || typeof filePath !== 'string') {
    return null;
  }

  return toRetrievalTarget({
    kind: kind as AnalysisSymbol['kind'],
    qualifiedName,
    filePath,
  });
}

function toCandidateRecord(entry: RankedComparisonCandidate): Prisma.InputJsonObject {
  return {
    rank: entry.rank,
    chunkId: entry.chunkId,
    filePath: entry.filePath,
    symbolQualifiedName: entry.symbolQualifiedName,
    semanticScore: entry.semanticScore,
    structuralRelation: entry.structuralMatch,
    combinedScore: entry.combinedScore,
    selected: entry.selected,
  };
}

/**
 * Job `retrieval-comparison` (WI-CORE-022, INTEROP-2.7 §6.15). Solo retrieval: una recuperación
 * semántica por ejecución, de la que se derivan SE y SEM; métricas; resultados por upsert en una
 * transacción. No invoca LLM, Functional Knowledge, `ACTION_REQUIRED`, generación, Sandbox ni
 * publicación, y no escribe el `AnalysisRun`. Sus dependencias están limitadas a esas de retrieval.
 */
@Injectable()
export class RetrievalComparisonJobHandler implements JobHandler<RetrievalComparisonJobPayload>, OnModuleInit {
  readonly type = RETRIEVAL_COMPARISON_JOB_TYPE;
  private readonly logger = new Logger(RetrievalComparisonJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly repository: RetrievalComparisonsRepository,
    private readonly retrievalService: RetrievalService,
    private readonly contextBuilder: ContextBuilder,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: RetrievalComparisonJobPayload, _jobId: string): Promise<void> {
    const comparison = await this.repository.findById(payload.retrievalComparisonId);

    if (!comparison) {
      this.logger.warn(`Comparación de retrieval ${payload.retrievalComparisonId} inexistente; el job no tiene trabajo.`);
      return;
    }

    // Idempotencia: una comparación ya COMPLETED no se recalcula ni reescribe.
    if (comparison.status === 'COMPLETED') {
      return;
    }

    const target = readSymbolTarget(comparison.symbol);
    if (!target) {
      await this.repository.markFailed(comparison.id, RETRIEVAL_TARGET_UNRESOLVABLE_CODE, TARGET_UNRESOLVABLE_MESSAGE);
      return;
    }

    if (!(await this.repository.markRunning(comparison.id))) {
      return;
    }

    try {
      const results = await this.computeResults(comparison.projectVersionId, target, comparison.groundTruth);
      const saved = await this.repository.saveResultsAndComplete(comparison.id, results);

      if (!saved) {
        this.logger.warn(`Comparación ${comparison.id} cerrada antes de persistir resultados; no se escribe nada.`);
      }
    } catch (error) {
      if (error instanceof AppException && error.code === ErrorCode.UNRESOLVABLE_TARGET) {
        await this.repository.markFailed(comparison.id, RETRIEVAL_TARGET_UNRESOLVABLE_CODE, TARGET_UNRESOLVABLE_MESSAGE);
        return;
      }

      // Se registra el tipo de error; el mensaje crudo no sale a la fila persistida ni al `lastError` del job.
      this.logger.error(`Comparación ${comparison.id}: fallo de recuperación (${errorKind(error)}).`);
      await this.repository.recordFailure(comparison.id, RETRIEVAL_COMPARISON_FAILED_CODE, COMPARISON_FAILED_MESSAGE);
      throw new RetrievalComparisonAttemptError();
    }
  }

  /**
   * Cierre al agotar los intentos (DEC-JOBS-001). Solo cierra una comparación abierta; nunca pisa
   * COMPLETED ni FAILED.
   */
  async onExhausted(payload: RetrievalComparisonJobPayload, _reason: string): Promise<void> {
    const comparison = await this.repository.findById(payload.retrievalComparisonId);

    if (!comparison || comparison.status === 'COMPLETED' || comparison.status === 'FAILED') {
      return;
    }

    await this.repository.markFailed(comparison.id, RETRIEVAL_COMPARISON_WORKER_LOST_CODE, WORKER_LOST_MESSAGE);
  }

  /**
   * Una sola recuperación semántica (modo SE, que incluye los estructurales). SEM se deriva de esos
   * mismos candidatos: solo los que tienen `semanticScore`, es decir, los 20 semánticos.
   */
  private async computeResults(
    projectVersionId: string,
    target: RetrievalTarget,
    groundTruthJson: Prisma.JsonValue | null,
  ): Promise<RetrievalModeResultInput[]> {
    const retrieval = await this.retrievalService.retrieve(projectVersionId, target, SEMANTIC_TOP_K, 'SE');
    const weights = this.contextBuilder.resolveWeights();
    const scoreOf = (candidate: RetrievalCandidate): number =>
      this.contextBuilder.scoreCandidate(weights, candidate.semanticScore, candidate.structuralMatch);
    const embeddingModel = this.configService.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small');
    const groundTruth = (groundTruthJson as RetrievalGroundTruthItem[] | null) ?? null;

    const se = rankComparisonCandidates(retrieval.candidates, 'SE', scoreOf);
    const sem = rankComparisonCandidates(retrieval.candidates, 'SEM', scoreOf);
    const seMetrics = computeRetrievalMetrics(se, groundTruth);
    const semMetrics = computeRetrievalMetrics(sem, groundTruth);

    return [
      {
        mode: 'SE',
        config: {
          semanticTopK: SEMANTIC_TOP_K,
          finalTopK: 10,
          semanticWeight: weights.semanticWeight,
          structuralWeight: weights.structuralWeight,
          embeddingModel,
        },
        candidates: se.map(toCandidateRecord),
        metrics: seMetrics ? { ...seMetrics } : null,
      },
      {
        mode: 'SEM',
        config: {
          semanticTopK: SEMANTIC_TOP_K,
          finalTopK: 10,
          semanticWeight: null,
          structuralWeight: null,
          embeddingModel,
        },
        candidates: sem.map(toCandidateRecord),
        metrics: semMetrics ? { ...semMetrics } : null,
      },
    ];
  }
}

/** Clase del error para el log, sin mensaje ni stack (pueden contener datos sensibles). */
function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
