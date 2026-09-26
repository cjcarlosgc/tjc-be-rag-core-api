import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { TestPublicationsRepository } from './test-publications.repository.js';
import { GeneratedTestProposalsRepository } from '../validation/generated-test-proposals.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { GithubGitDataService } from '../github-app/github-git-data.service.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import type { AnalysisRun, RepositoryBinding, TestPublication } from '../generated/prisma/client.js';

export interface TestPublicationJobPayload {
  publicationId: string;
}

export const TEST_PUBLICATION_JOB_TYPE = 'test-publication';
const MAX_GITHUB_BLOB_BYTES = 100_000_000;

/**
 * HU40 (§6.12): publica un companion PR con las propuestas AVAILABLE
 * pedidas. Vuelve a comprobar freshness contra el HEAD real del PR antes de
 * tocar nada -si cambió, `STALE` y no se escribe en GitHub-. La rama
 * `rag-tests/pr-<number>-<shortSha>` se crea (o reutiliza, si el job se
 * reintenta) desde `run.headSha`; el companion PR apunta a la feature
 * branch original (`run.headRef`), nunca a `integrationBranch`. Nunca
 * reabre un PR cerrado (invariante de `system-contract.md`): si ya existe
 * uno con ese head branch y está cerrado, la publicación termina `FAILED`.
 */
@Injectable()
export class TestPublicationJobHandler implements JobHandler<TestPublicationJobPayload>, OnModuleInit {
  readonly type = TEST_PUBLICATION_JOB_TYPE;
  private readonly logger = new Logger(TestPublicationJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly testPublicationsRepository: TestPublicationsRepository,
    private readonly generatedTestProposalsRepository: GeneratedTestProposalsRepository,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly githubGitDataService: GithubGitDataService,
    private readonly objectStorageService: ObjectStorageService,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: TestPublicationJobPayload): Promise<void> {
    const publication = await this.testPublicationsRepository.findById(payload.publicationId);

    if (!publication || publication.status !== 'PENDING') {
      return;
    }

    await this.testPublicationsRepository.update(publication.id, { status: 'PUBLISHING' });

    try {
      const run = await this.analysisRunsRepository.findById(publication.analysisRunId);

      if (!run) {
        await this.fail(publication, `El AnalysisRun "${publication.analysisRunId}" ya no existe.`);
        return;
      }

      const binding = await this.repositoryBindingsRepository.findForRun(run);

      if (!binding) {
        await this.fail(publication, `No se encontró el repository binding para "${run.repositoryId}".`);
        return;
      }

      await this.publish(publication, run, binding);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido publicando el companion PR.';
      this.logger.error(`TestPublication ${publication.id} falló: ${message}`);
      await this.fail(publication, message);
      throw error;
    }
  }

  private async publish(
    publication: TestPublication,
    run: AnalysisRun,
    binding: RepositoryBinding,
  ): Promise<void> {
    const request = {
      installationId: binding.installationId,
      repositoryName: binding.repositoryName,
      pullRequestNumber: run.prNumber,
      sourceHeadSha: publication.sourceHeadSha,
    };
    const preflight = await this.githubGitDataService.preflight(request);
    if (preflight.status === 'STALE') {
      await this.testPublicationsRepository.update(publication.id, { status: 'STALE' });
      return;
    }
    if (preflight.status === 'EXISTING_PR_CLOSED') {
      await this.fail(publication, `Ya existe un companion PR cerrado (#${preflight.number}); no se reabre.`);
      return;
    }

    const proposals = await this.generatedTestProposalsRepository.findByIdsForRun(
      publication.analysisRunId,
      publication.proposalIds,
    );
    const uploadedFiles: Array<{ path: string; blobSha: string }> = [];
    for (const proposal of proposals) {
      const content = await this.objectStorageService.get(proposal.storageKey);
      if (content.byteLength > MAX_GITHUB_BLOB_BYTES) {
        await this.fail(
          publication,
          'Una propuesta supera el límite de GitHub de 100 MB y no se envió.',
        );
        return;
      }
      const uploaded = await this.githubGitDataService.uploadProposalBlob({
        ...request,
        path: proposal.relativePath,
        contentBase64: content.toString('base64'),
      });
      if (uploaded.status === 'STALE') {
        await this.testPublicationsRepository.update(publication.id, { status: 'STALE' });
        return;
      }
      if (uploaded.status === 'EXISTING_PR_CLOSED') {
        await this.fail(publication, `Ya existe un companion PR cerrado (#${uploaded.number}); no se reabre.`);
        return;
      }
      uploadedFiles.push({ path: uploaded.path, blobSha: uploaded.blobSha });
    }

    const result = await this.githubGitDataService.finalize({
      ...request,
      sourceHeadRef: run.headRef,
      analysisRunId: run.id,
      proposalFiles: uploadedFiles,
    });
    if (result.status === 'STALE') {
      await this.testPublicationsRepository.update(publication.id, { status: 'STALE' });
      return;
    }
    if (result.status === 'EXISTING_PR_CLOSED') {
      await this.fail(publication, `Ya existe un companion PR cerrado (#${result.number}); no se reabre.`);
      return;
    }

    await this.testPublicationsRepository.update(publication.id, {
      status: 'PUBLISHED',
      branchName: result.branchName,
      companionPullRequestNumber: result.pullRequest.number,
      companionPullRequestUrl: result.pullRequest.url,
    });
    await this.generatedTestProposalsRepository.markPublished(publication.proposalIds);
  }

  private async fail(publication: TestPublication, message: string): Promise<void> {
    await this.testPublicationsRepository.update(publication.id, {
      status: 'FAILED',
      failureMessage: message,
    });
  }
}
