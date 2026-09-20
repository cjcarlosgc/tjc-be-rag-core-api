import { describe, expect, it, vi } from 'vitest';
import { TestPublicationJobHandler } from './test-publication-job.handler.js';
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
  function setup() {
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
    const githubAppAuthService = { getInstallationToken: vi.fn().mockResolvedValue('installation-token') };
    const githubRepositoryContentService = {
      getPullRequestHead: vi.fn().mockResolvedValue({ headSha: 'head-sha', state: 'open' }),
    };
    const githubGitDataService = {
      getBranchHeadSha: vi.fn().mockResolvedValue(null),
      createBranch: vi.fn().mockResolvedValue(undefined),
      getCommitTreeSha: vi.fn().mockResolvedValue('base-tree-sha'),
      createTree: vi.fn().mockResolvedValue('new-tree-sha'),
      createCommit: vi.fn().mockResolvedValue('new-commit-sha'),
      updateRef: vi.fn().mockResolvedValue(undefined),
      findPullRequestByHead: vi.fn().mockResolvedValue(null),
      createPullRequest: vi
        .fn()
        .mockResolvedValue({ number: 9, url: 'https://github.com/org/repo/pull/9', state: 'open' }),
    };
    const objectStorageService = { get: vi.fn().mockResolvedValue(Buffer.from('test content', 'utf8')) };

    const handler = new TestPublicationJobHandler(
      jobsService as never,
      testPublicationsRepository as never,
      generatedTestProposalsRepository as never,
      analysisRunsRepository as never,
      repositoryBindingsRepository as never,
      githubAppAuthService as never,
      githubRepositoryContentService as never,
      githubGitDataService as never,
      objectStorageService as never,
    );

    return {
      handler,
      jobsService,
      testPublicationsRepository,
      generatedTestProposalsRepository,
      analysisRunsRepository,
      repositoryBindingsRepository,
      githubAppAuthService,
      githubRepositoryContentService,
      githubGitDataService,
      objectStorageService,
    };
  }

  it('registers itself as a job handler on module init', () => {
    const { handler, jobsService } = setup();
    handler.onModuleInit();
    expect(jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('is a no-op when the publication does not exist', async () => {
    const { handler, testPublicationsRepository, analysisRunsRepository } = setup();
    testPublicationsRepository.findById.mockResolvedValue(null);

    await handler.handle({ publicationId: 'missing' });

    expect(analysisRunsRepository.findById).not.toHaveBeenCalled();
  });

  it('is a no-op when the publication is not PENDING', async () => {
    const { handler, testPublicationsRepository, analysisRunsRepository } = setup();
    testPublicationsRepository.findById.mockResolvedValue(buildPublication({ status: 'PUBLISHED' }));

    await handler.handle({ publicationId: 'publication-1' });

    expect(analysisRunsRepository.findById).not.toHaveBeenCalled();
  });

  it('marks STALE without touching GitHub when the live PR head no longer matches', async () => {
    const { handler, testPublicationsRepository, githubRepositoryContentService, githubGitDataService } = setup();
    githubRepositoryContentService.getPullRequestHead.mockResolvedValue({ headSha: 'new-head-sha', state: 'open' });

    await handler.handle({ publicationId: 'publication-1' });

    expect(testPublicationsRepository.update).toHaveBeenCalledWith('publication-1', { status: 'STALE' });
    expect(githubGitDataService.createBranch).not.toHaveBeenCalled();
  });

  it('fails when the AnalysisRun no longer exists', async () => {
    const { handler, analysisRunsRepository, testPublicationsRepository } = setup();
    analysisRunsRepository.findById.mockResolvedValue(null);

    await handler.handle({ publicationId: 'publication-1' });

    expect(testPublicationsRepository.update).toHaveBeenCalledWith(
      'publication-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('fails when the repository binding no longer exists', async () => {
    const { handler, repositoryBindingsRepository, testPublicationsRepository } = setup();
    repositoryBindingsRepository.findForRun.mockResolvedValue(null);

    await handler.handle({ publicationId: 'publication-1' });

    expect(testPublicationsRepository.update).toHaveBeenCalledWith(
      'publication-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('creates a new branch, commit and PR, then marks PUBLISHED and proposals PUBLISHED', async () => {
    const { handler, githubGitDataService, testPublicationsRepository, generatedTestProposalsRepository } = setup();

    await handler.handle({ publicationId: 'publication-1' });

    expect(githubGitDataService.createBranch).toHaveBeenCalledWith(
      'org/repo',
      'rag-tests/pr-42-head-sh',
      'head-sha',
      'installation-token',
    );
    expect(githubGitDataService.createTree).toHaveBeenCalledWith(
      'org/repo',
      'base-tree-sha',
      [{ path: 'src/thing.spec.ts', content: 'test content' }],
      'installation-token',
    );
    expect(githubGitDataService.createPullRequest).toHaveBeenCalledWith(
      'org/repo',
      expect.objectContaining({ head: 'rag-tests/pr-42-head-sh', base: 'feature/x' }),
      'installation-token',
    );
    expect(testPublicationsRepository.update).toHaveBeenCalledWith('publication-1', {
      status: 'PUBLISHED',
      branchName: 'rag-tests/pr-42-head-sh',
      companionPullRequestNumber: 9,
      companionPullRequestUrl: 'https://github.com/org/repo/pull/9',
    });
    expect(generatedTestProposalsRepository.markPublished).toHaveBeenCalledWith(['proposal-1']);
  });

  it('reuses the existing branch head as the base commit instead of creating a new branch', async () => {
    const { handler, githubGitDataService } = setup();
    githubGitDataService.getBranchHeadSha.mockResolvedValue('existing-branch-commit');

    await handler.handle({ publicationId: 'publication-1' });

    expect(githubGitDataService.createBranch).not.toHaveBeenCalled();
    expect(githubGitDataService.getCommitTreeSha).toHaveBeenCalledWith(
      'org/repo',
      'existing-branch-commit',
      'installation-token',
    );
  });

  it('reuses an existing OPEN companion PR instead of creating a new one', async () => {
    const { handler, githubGitDataService, testPublicationsRepository } = setup();
    githubGitDataService.findPullRequestByHead.mockResolvedValue({
      number: 5,
      url: 'https://github.com/org/repo/pull/5',
      state: 'open',
    });

    await handler.handle({ publicationId: 'publication-1' });

    expect(githubGitDataService.createPullRequest).not.toHaveBeenCalled();
    expect(testPublicationsRepository.update).toHaveBeenCalledWith(
      'publication-1',
      expect.objectContaining({ companionPullRequestNumber: 5 }),
    );
  });

  it('fails without creating a PR when a companion PR for that branch is already closed', async () => {
    const { handler, githubGitDataService, testPublicationsRepository } = setup();
    githubGitDataService.findPullRequestByHead.mockResolvedValue({
      number: 5,
      url: 'https://github.com/org/repo/pull/5',
      state: 'closed',
    });

    await handler.handle({ publicationId: 'publication-1' });

    expect(githubGitDataService.createPullRequest).not.toHaveBeenCalled();
    expect(testPublicationsRepository.update).toHaveBeenCalledWith(
      'publication-1',
      expect.objectContaining({ status: 'FAILED', failureMessage: expect.stringContaining('cerrado') }),
    );
  });

  it('marks FAILED and rethrows on an unexpected error', async () => {
    const { handler, githubGitDataService, testPublicationsRepository } = setup();
    githubGitDataService.createCommit.mockRejectedValue(new Error('GitHub API 500'));

    await expect(handler.handle({ publicationId: 'publication-1' })).rejects.toThrow('GitHub API 500');

    expect(testPublicationsRepository.update).toHaveBeenCalledWith(
      'publication-1',
      expect.objectContaining({ status: 'FAILED', failureMessage: 'GitHub API 500' }),
    );
  });
});
