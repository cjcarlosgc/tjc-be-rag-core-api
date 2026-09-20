import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { TestPublicationsRepository } from './test-publications.repository.js';
import { GeneratedTestProposalsRepository } from '../validation/generated-test-proposals.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { GithubAppAuthService } from '../github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../github-app/github-repository-content.service.js';
import { GithubGitDataService, type TreeEntryInput } from '../github-app/github-git-data.service.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import type { AnalysisRun, RepositoryBinding, TestPublication } from '../generated/prisma/client.js';

export interface TestPublicationJobPayload {
  publicationId: string;
}

export const TEST_PUBLICATION_JOB_TYPE = 'test-publication';

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

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
    private readonly githubAppAuthService: GithubAppAuthService,
    private readonly githubRepositoryContentService: GithubRepositoryContentService,
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

      const token = await this.githubAppAuthService.getInstallationToken(binding.installationId);
      const livePr = await this.githubRepositoryContentService.getPullRequestHead(
        binding.repositoryName,
        run.prNumber,
        token,
      );

      if (livePr.headSha !== publication.sourceHeadSha) {
        await this.testPublicationsRepository.update(publication.id, { status: 'STALE' });
        return;
      }

      await this.publish(publication, run, binding, token);
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
    token: string,
  ): Promise<void> {
    const repoFullName = binding.repositoryName;
    const branchName = `rag-tests/pr-${run.prNumber}-${shortSha(run.headSha)}`;

    const existingBranchSha = await this.githubGitDataService.getBranchHeadSha(repoFullName, branchName, token);
    const baseCommitSha = existingBranchSha ?? run.headSha;

    if (!existingBranchSha) {
      await this.githubGitDataService.createBranch(repoFullName, branchName, run.headSha, token);
    }

    const proposals = await this.generatedTestProposalsRepository.findByIdsForRun(
      publication.analysisRunId,
      publication.proposalIds,
    );
    const entries: TreeEntryInput[] = await Promise.all(
      proposals.map(async (proposal) => ({
        path: proposal.relativePath,
        content: (await this.objectStorageService.get(proposal.storageKey)).toString('utf8'),
      })),
    );

    const baseTreeSha = await this.githubGitDataService.getCommitTreeSha(repoFullName, baseCommitSha, token);
    const newTreeSha = await this.githubGitDataService.createTree(repoFullName, baseTreeSha, entries, token);
    const commitMessage = `test: agrega ${proposals.length} prueba(s) generada(s) para PR #${run.prNumber}\n\nGenerado por RAG Core Analysis (AnalysisRun ${run.id}).`;
    const newCommitSha = await this.githubGitDataService.createCommit(
      repoFullName,
      commitMessage,
      newTreeSha,
      baseCommitSha,
      token,
    );
    await this.githubGitDataService.updateRef(repoFullName, branchName, newCommitSha, token);

    const existingPr = await this.githubGitDataService.findPullRequestByHead(repoFullName, branchName, token);

    if (existingPr?.state === 'closed') {
      await this.fail(publication, `Ya existe un companion PR cerrado (#${existingPr.number}); no se reabre.`);
      return;
    }

    const prRef =
      existingPr ??
      (await this.githubGitDataService.createPullRequest(
        repoFullName,
        {
          title: `RAG Core: pruebas generadas para PR #${run.prNumber}`,
          head: branchName,
          base: run.headRef,
          body: this.buildPrBody(run, proposals.length),
        },
        token,
      ));

    await this.testPublicationsRepository.update(publication.id, {
      status: 'PUBLISHED',
      branchName,
      companionPullRequestNumber: prRef.number,
      companionPullRequestUrl: prRef.url,
    });
    await this.generatedTestProposalsRepository.markPublished(publication.proposalIds);
  }

  private buildPrBody(run: AnalysisRun, proposalCount: number): string {
    return [
      `Pruebas generadas por RAG Core para el PR #${run.prNumber} (\`${run.headSha}\`).`,
      '',
      `${proposalCount} archivo(s) de test propuesto(s), revisados y aprobados para publicación.`,
      '',
      'Este PR no se mergea automáticamente. Al mergearlo, el PR original recibirá un evento `synchronize` y se revalidará.',
    ].join('\n');
  }

  private async fail(publication: TestPublication, message: string): Promise<void> {
    await this.testPublicationsRepository.update(publication.id, {
      status: 'FAILED',
      failureMessage: message,
    });
  }
}
