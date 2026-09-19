import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TestPublicationsRepository } from './test-publications.repository.js';
import { GeneratedTestProposalsRepository } from '../validation/generated-test-proposals.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { JobsService } from '../jobs/jobs.service.js';
import { TEST_PUBLICATION_JOB_TYPE } from './test-publication-job.handler.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import {
  toTestPublicationResponse,
  type TestPublicationAcceptedResponse,
  type TestPublicationResponse,
} from './dto/test-publication.response.js';

const DEFAULT_POLL_AFTER_MS = 1500;

/**
 * HU40: solicitar la publicación es sincrónico solo hasta encolar el job
 * (`AsyncAccepted`, §6.12). La ejecución real -freshness, rama, commit,
 * companion PR- vive en `TestPublicationJobHandler`.
 */
@Injectable()
export class TestPublicationsService {
  constructor(
    private readonly testPublicationsRepository: TestPublicationsRepository,
    private readonly generatedTestProposalsRepository: GeneratedTestProposalsRepository,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly jobsService: JobsService,
    private readonly configService: ConfigService,
  ) {}

  async create(
    analysisRunId: string,
    proposalIds: string[],
    ownerUserId: string,
  ): Promise<TestPublicationAcceptedResponse> {
    const run = await this.analysisRunsRepository.findByIdForOwner(analysisRunId, ownerUserId);

    if (!run) {
      throw new AppException(
        ErrorCode.ANALYSIS_RUN_NOT_FOUND,
        `No existe un AnalysisRun con id "${analysisRunId}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (run.status !== 'SUCCESS' || !run.current) {
      throw new AppException(
        ErrorCode.TEST_PUBLICATION_INVALID_RUN_STATUS,
        `El AnalysisRun "${analysisRunId}" debe estar SUCCESS y vigente para publicar tests.`,
        HttpStatus.CONFLICT,
      );
    }

    const proposals = await this.generatedTestProposalsRepository.findByIdsForRun(analysisRunId, proposalIds);
    const foundIds = new Set(proposals.map((proposal) => proposal.id));
    const missing = proposalIds.filter((id) => !foundIds.has(id));

    if (missing.length > 0 || proposals.some((proposal) => proposal.status !== 'AVAILABLE')) {
      throw new AppException(
        ErrorCode.TEST_PUBLICATION_PROPOSAL_NOT_AVAILABLE,
        'Una o más propuestas no existen para este Run o no están AVAILABLE.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const publication = await this.testPublicationsRepository.create({
      analysisRunId,
      proposalIds,
      sourceHeadSha: run.headSha,
    });

    await this.jobsService.enqueue(TEST_PUBLICATION_JOB_TYPE, { publicationId: publication.id });

    return {
      status: 'PENDING',
      pollAfterMs: this.configService.get<number>('INDEXING_POLL_AFTER_MS', DEFAULT_POLL_AFTER_MS),
      publicationId: publication.id,
      analysisRunId,
    };
  }

  async getById(publicationId: string, ownerUserId: string): Promise<TestPublicationResponse> {
    const publication = await this.testPublicationsRepository.findByIdForOwner(publicationId, ownerUserId);

    if (!publication) {
      throw new AppException(
        ErrorCode.TEST_PUBLICATION_NOT_FOUND,
        `No existe una publicación con id "${publicationId}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return toTestPublicationResponse(publication);
  }
}
