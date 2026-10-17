import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestPublicationJobHandler } from './test-publication-job.handler.js';
import { JobsService } from '../jobs/jobs.service.js';
import { TestPublicationsRepository } from './test-publications.repository.js';
import { GeneratedTestProposalsRepository } from '../validation/generated-test-proposals.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { GithubGitDataService } from '../github-app/github-git-data.service.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import type {
  AnalysisRun,
  GeneratedTestProposal,
  RepositoryBinding,
  TestPublication,
} from '../generated/prisma/client.js';

function buildPublication(overrides: Partial<TestPublication> = {}): TestPublication {
  return {
    id: 'publication-1',
    analysisRunId: 'run-1',
    proposalIds: ['proposal-1'],
    sourceHeadSha: 'head-sha',
    status: 'PENDING',
    branchName: null,
    companionPullRequestNumber: null,
    companionPullRequestUrl: null,
    failureMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    repositoryId: '123',
    prNumber: 42,
    headRef: 'feature/x',
    headSha: 'head-sha',
    ...overrides,
  } as AnalysisRun;
}

const binding: RepositoryBinding = {
  id: 'binding-1',
  projectId: 'project-1',
  installationId: '999',
  repositoryId: '123',
  repositoryName: 'org/repo',
  integrationBranch: 'develop',
  status: 'ENABLED',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildProposal(overrides: Partial<GeneratedTestProposal> = {}): GeneratedTestProposal {
  return {
    id: 'proposal-1',
    analysisRunId: 'run-1',
    relativePath: 'src/thing.spec.ts',
    storageKey: 'analysis-runs/run-1/proposals/proposal-1',
    status: 'AVAILABLE',
    ...overrides,
  } as GeneratedTestProposal;
}

describe('TestPublicationJobHandler', () => {
  const activeModules: TestingModule[] = [];

  afterEach(async () => {
    await Promise.all(activeModules.splice(0).map((module) => module.close()));
  });

  async function setup() {
    const jobsService = { registerHandler: vi.fn() };
    const testPublicationsRepository = {
      findById: vi.fn().mockResolvedValue(buildPublication()),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const generatedTestProposalsRepository = {
      findByIdsForRun: vi.fn().mockResolvedValue([buildProposal()]),
      markPublished: vi.fn().mockResolvedValue(undefined),
    };
    const analysisRunsRepository = { findById: vi.fn().mockResolvedValue(buildRun()) };
    const repositoryBindingsRepository = { findForRun: vi.fn().mockResolvedValue(binding) };
    const githubGitDataService = {
      preflight: vi.fn().mockResolvedValue({ status: 'READY' }),
      uploadProposalBlob: vi.fn().mockResolvedValue({
        status: 'UPLOADED',
        path: 'src/thing.spec.ts',
        blobSha: 'blob-sha',
      }),
      finalize: vi.fn().mockResolvedValue({
        status: 'PUBLISHED',
        branchName: 'rag-tests/pr-42-head-sh',
        commitSha: 'commit-sha',
        pullRequest: { number: 9, url: 'https://github.com/org/repo/pull/9' },
      }),
    };
    const objectStorageService = { get: vi.fn().mockResolvedValue(Buffer.from('test content', 'utf8')) };

    const testingModule = await Test.createTestingModule({
      providers: [
        TestPublicationJobHandler,
        { provide: JobsService, useValue: jobsService },
        { provide: TestPublicationsRepository, useValue: testPublicationsRepository },
        { provide: GeneratedTestProposalsRepository, useValue: generatedTestProposalsRepository },
        { provide: AnalysisRunsRepository, useValue: analysisRunsRepository },
        { provide: RepositoryBindingsRepository, useValue: repositoryBindingsRepository },
        { provide: GithubGitDataService, useValue: githubGitDataService },
        { provide: ObjectStorageService, useValue: objectStorageService },
      ],
    }).compile();
    activeModules.push(testingModule);

    return {
      handler: testingModule.get<TestPublicationJobHandler>(TestPublicationJobHandler),
      jobsService,
      testPublicationsRepository,
      generatedTestProposalsRepository,
      analysisRunsRepository,
      repositoryBindingsRepository,
      githubGitDataService,
      objectStorageService,
    };
  }

  it('registers itself as a job handler on module init', async () => {
    const { handler, jobsService } = await setup();
    handler.onModuleInit();
    expect(jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('is a no-op when the publication does not exist or is not pending', async () => {
    const { handler, testPublicationsRepository, analysisRunsRepository } = await setup();
    testPublicationsRepository.findById.mockResolvedValue(null);
    await handler.handle({ publicationId: 'missing' });
    testPublicationsRepository.findById.mockResolvedValue(buildPublication({ status: 'PUBLISHED' }));
    await handler.handle({ publicationId: 'publication-1' });
    expect(analysisRunsRepository.findById).not.toHaveBeenCalled();
  });

  it('marks STALE at preflight without downloading or uploading files', async () => {
    const { handler, testPublicationsRepository, githubGitDataService, objectStorageService } = await setup();
    githubGitDataService.preflight.mockResolvedValue({ status: 'STALE' });

    await handler.handle({ publicationId: 'publication-1' });

    expect(testPublicationsRepository.update).toHaveBeenCalledWith('publication-1', { status: 'STALE' });
    expect(objectStorageService.get).not.toHaveBeenCalled();
    expect(githubGitDataService.uploadProposalBlob).not.toHaveBeenCalled();
  });

  it('does not reopen an existing closed companion PR', async () => {
    const { handler, testPublicationsRepository, githubGitDataService, objectStorageService } = await setup();
    githubGitDataService.preflight.mockResolvedValue({ status: 'EXISTING_PR_CLOSED', number: 5 });

    await handler.handle({ publicationId: 'publication-1' });

    expect(objectStorageService.get).not.toHaveBeenCalled();
    expect(githubGitDataService.uploadProposalBlob).not.toHaveBeenCalled();
    expect(testPublicationsRepository.update).toHaveBeenCalledWith('publication-1', {
      status: 'FAILED',
      failureMessage: expect.stringContaining('cerrado (#5)'),
    });
  });

  it('uploads stored proposal bytes and finalizes through the private three-step API', async () => {
    const { handler, githubGitDataService, testPublicationsRepository, generatedTestProposalsRepository, objectStorageService } = await setup();

    await handler.handle({ publicationId: 'publication-1' });

    expect(githubGitDataService.preflight).toHaveBeenCalledWith({
      installationId: '999',
      repositoryName: 'org/repo',
      pullRequestNumber: 42,
      sourceHeadSha: 'head-sha',
    });
    expect(objectStorageService.get).toHaveBeenCalledWith('analysis-runs/run-1/proposals/proposal-1');
    expect(githubGitDataService.uploadProposalBlob).toHaveBeenCalledWith({
      installationId: '999',
      repositoryName: 'org/repo',
      pullRequestNumber: 42,
      sourceHeadSha: 'head-sha',
      path: 'src/thing.spec.ts',
      contentBase64: 'dGVzdCBjb250ZW50',
    });
    expect(githubGitDataService.finalize).toHaveBeenCalledWith({
      installationId: '999',
      repositoryName: 'org/repo',
      pullRequestNumber: 42,
      sourceHeadSha: 'head-sha',
      sourceHeadRef: 'feature/x',
      analysisRunId: 'run-1',
      proposalFiles: [{ path: 'src/thing.spec.ts', blobSha: 'blob-sha' }],
    });
    expect(testPublicationsRepository.update).toHaveBeenCalledWith('publication-1', {
      status: 'PUBLISHED',
      branchName: 'rag-tests/pr-42-head-sh',
      companionPullRequestNumber: 9,
      companionPullRequestUrl: 'https://github.com/org/repo/pull/9',
    });
    expect(generatedTestProposalsRepository.markPublished).toHaveBeenCalledWith(['proposal-1']);
  });

  it('rejects a proposal above GitHub’s per-blob limit before Base64 encoding or upload', async () => {
    const {
      handler,
      githubGitDataService,
      objectStorageService,
      testPublicationsRepository,
      generatedTestProposalsRepository,
    } = await setup();
    const oversized = {
      byteLength: 100_000_001,
      toString: vi.fn(),
    } as unknown as Buffer;
    objectStorageService.get.mockResolvedValue(oversized);

    await handler.handle({ publicationId: 'publication-1' });

    expect(oversized.toString).not.toHaveBeenCalled();
    expect(githubGitDataService.uploadProposalBlob).not.toHaveBeenCalled();
    expect(githubGitDataService.finalize).not.toHaveBeenCalled();
    expect(testPublicationsRepository.update).toHaveBeenCalledWith('publication-1', {
      status: 'FAILED',
      failureMessage: expect.stringContaining('100 MB'),
    });
    expect(generatedTestProposalsRepository.markPublished).not.toHaveBeenCalled();
  });

  it('marks STALE if the PR changes while a proposal blob is uploaded', async () => {
    const { handler, githubGitDataService, testPublicationsRepository, generatedTestProposalsRepository } = await setup();
    githubGitDataService.uploadProposalBlob.mockResolvedValue({ status: 'STALE' });

    await handler.handle({ publicationId: 'publication-1' });

    expect(testPublicationsRepository.update).toHaveBeenCalledWith('publication-1', { status: 'STALE' });
    expect(githubGitDataService.finalize).not.toHaveBeenCalled();
    expect(generatedTestProposalsRepository.markPublished).not.toHaveBeenCalled();
  });

  it('marks STALE if the source PR changes during finalization', async () => {
    const { handler, githubGitDataService, testPublicationsRepository, generatedTestProposalsRepository } = await setup();
    githubGitDataService.finalize.mockResolvedValue({ status: 'STALE' });

    await handler.handle({ publicationId: 'publication-1' });

    expect(testPublicationsRepository.update).toHaveBeenCalledWith('publication-1', { status: 'STALE' });
    expect(generatedTestProposalsRepository.markPublished).not.toHaveBeenCalled();
  });

  it('fails and rethrows a neutral integration error', async () => {
    const { handler, githubGitDataService, testPublicationsRepository } = await setup();
    githubGitDataService.finalize.mockRejectedValue(new Error('GitHub Integration unavailable'));

    await expect(handler.handle({ publicationId: 'publication-1' })).rejects.toThrow('GitHub Integration unavailable');

    expect(testPublicationsRepository.update).toHaveBeenCalledWith('publication-1', {
      status: 'FAILED',
      failureMessage: 'GitHub Integration unavailable',
    });
  });

  it('fails when the AnalysisRun or repository binding no longer exists', async () => {
    const missingRun = await setup();
    missingRun.analysisRunsRepository.findById.mockResolvedValue(null);
    await missingRun.handler.handle({ publicationId: 'publication-1' });
    expect(missingRun.testPublicationsRepository.update).toHaveBeenCalledWith(
      'publication-1', expect.objectContaining({ status: 'FAILED' }),
    );

    const missingBinding = await setup();
    missingBinding.repositoryBindingsRepository.findForRun.mockResolvedValue(null);
    await missingBinding.handler.handle({ publicationId: 'publication-1' });
    expect(missingBinding.testPublicationsRepository.update).toHaveBeenCalledWith(
      'publication-1', expect.objectContaining({ status: 'FAILED' }),
    );
  });
});
