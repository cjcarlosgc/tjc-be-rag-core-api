import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { AnalysisRunTraceService } from '../analysis-runs/analysis-run-trace.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { ExperimentRunsRepository } from '../experiments/persistence/experiment-runs.repository.js';
import { RetrievalComparisonsRepository } from '../retrieval-comparisons/persistence/retrieval-comparisons.repository.js';
import {
  assembleAnalysisRunBundle,
  assembleExperimentBundle,
  assembleRetrievalComparisonBundle,
  type EvidenceAssemblyContext,
} from './evidence-bundle.assembler.js';
import type { EvidenceBundleResponse } from './dto/evidence-bundle.response.js';
import { EvidenceRepository } from './persistence/evidence.repository.js';

/** Reloj inyectable de `generatedAt`; en producción devuelve el instante actual. */
export const EVIDENCE_CLOCK = Symbol('EVIDENCE_CLOCK');
export type EvidenceClock = () => Date;

const NOT_FINISHED_RUN_STATUSES: ReadonlySet<string> = new Set(['QUEUED', 'PROCESSING']);
const NOT_FINISHED_EXPERIMENT_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'RUNNING']);
const NOT_FINISHED_COMPARISON_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'RUNNING']);

function notFinished(message: string): AppException {
  return new AppException(ErrorCode.EVIDENCE_NOT_FINISHED, message, HttpStatus.CONFLICT);
}

/**
 * WI-CORE-027 (INTEROP-2.7 §6.16): exportación de evidencia de un AnalysisRun, de un experimento o de una
 * comparación de retrieval. Solo lectura: no llama a LLM, Sandbox ni almacenamiento. Estados: `QUEUED`/`PROCESSING`
 * del Run y `PENDING`/`RUNNING` de experimento y comparación responden `409 EVIDENCE_NOT_FINISHED`; los terminales
 * (incluido `FAILED`) responden el bundle. El `404` de un recurso inexistente o no visible es el de su ruta de estado.
 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly analysisRunTraceService: AnalysisRunTraceService,
    private readonly evidenceRepository: EvidenceRepository,
    private readonly experimentRunsRepository: ExperimentRunsRepository,
    private readonly retrievalComparisonsRepository: RetrievalComparisonsRepository,
    @Inject(EVIDENCE_CLOCK) private readonly now: EvidenceClock,
  ) {}

  async getAnalysisRunEvidence(
    analysisRunId: string,
    ownerUserId: string,
    correlationId: string,
  ): Promise<EvidenceBundleResponse> {
    const run = await this.analysisRunsService.getById(analysisRunId, ownerUserId);

    if (NOT_FINISHED_RUN_STATUSES.has(run.status)) {
      throw notFinished(
        `El AnalysisRun "${run.id}" está en "${run.status}"; la evidencia queda disponible cuando termina.`,
      );
    }

    const [{ targetSymbols, publication }, retrievals, contexts, proposals, executions] = await Promise.all([
      this.analysisRunTraceService.loadTargets(run),
      this.evidenceRepository.findRetrievalsForEvidence(run.id),
      this.evidenceRepository.findContextsForEvidence(run.id),
      this.evidenceRepository.findProposalsForEvidence(run.id),
      this.evidenceRepository.findExecutionsForEvidence(run.id),
    ]);

    return assembleAnalysisRunBundle({
      ...this.context(correlationId),
      run,
      targets: targetSymbols,
      publication,
      retrievals,
      contexts,
      proposals,
      executions,
    });
  }

  async getExperimentEvidence(
    experimentId: string,
    ownerUserId: string,
    correlationId: string,
  ): Promise<EvidenceBundleResponse> {
    const run = await this.experimentRunsRepository.findByIdForOwner(experimentId, ownerUserId);

    if (!run) {
      throw new AppException(
        ErrorCode.EXPERIMENT_NOT_FOUND,
        `No existe el experimento ${experimentId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (NOT_FINISHED_EXPERIMENT_STATUSES.has(run.status)) {
      throw notFinished(`El experimento "${run.id}" está en "${run.status}"; la evidencia queda disponible cuando termina.`);
    }

    // Solo el intento vigente de cada repetición lógica (último intento por slot).
    const repetitions = await this.experimentRunsRepository.findRepetitions(run.id);
    const traces = await this.evidenceRepository.findContextTracesByRepetitionIds(repetitions.map((row) => row.id));

    return assembleExperimentBundle({ ...this.context(correlationId), run, repetitions, traces });
  }

  async getRetrievalComparisonEvidence(
    retrievalComparisonId: string,
    correlationId: string,
  ): Promise<EvidenceBundleResponse> {
    const comparison = await this.retrievalComparisonsRepository.findById(retrievalComparisonId);

    if (!comparison) {
      throw new AppException(
        ErrorCode.RETRIEVAL_COMPARISON_NOT_FOUND,
        `No existe una comparación de retrieval con id "${retrievalComparisonId}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (NOT_FINISHED_COMPARISON_STATUSES.has(comparison.status)) {
      throw notFinished(
        `La comparación "${comparison.id}" está en "${comparison.status}"; la evidencia queda disponible cuando termina.`,
      );
    }

    const results =
      comparison.status === 'COMPLETED' ? await this.retrievalComparisonsRepository.findResults(comparison.id) : [];

    return assembleRetrievalComparisonBundle({ ...this.context(correlationId), comparison, results });
  }

  private context(correlationId: string): EvidenceAssemblyContext {
    return { correlationId, generatedAt: this.now() };
  }
}
