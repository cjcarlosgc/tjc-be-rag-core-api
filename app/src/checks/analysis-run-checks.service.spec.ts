import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunChecksService } from './analysis-run-checks.service.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { GithubChecksService } from '../github-app/github-checks.service.js';
import type { AnalysisRun, RepositoryBinding } from '../generated/prisma/client.js';

function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryId: '123',
    headSha: 'head-sha',
    status: 'SUCCESS',
    current: true,
    resultSummary: 'todo bien',
    ...overrides,
  } as AnalysisRun;
}

const binding: RepositoryBinding = {
  id: 'binding-1',
  projectId: 'project-1',
  installationId: '999',
  repositoryId: '123',
  repositoryName: 'org/repo',
  integrationBranch: 'main',
  status: 'ENABLED',
  disabledReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AnalysisRunChecksService', () => {
  let service: AnalysisRunChecksService;
  let repositoryBindingsRepository: { findForRun: ReturnType<typeof vi.fn> };
  let analysisRunsRepository: { findById: ReturnType<typeof vi.fn>; setCheckId: ReturnType<typeof vi.fn> };
  let githubChecksService: { createCheckRun: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    analysisRunsRepository = {
      findById: vi.fn().mockImplementation(async (id: string) => buildRun({ id })),
      setCheckId: vi.fn().mockResolvedValue(buildRun()),
    };
    repositoryBindingsRepository = { findForRun: vi.fn().mockResolvedValue(binding) };
    githubChecksService = { createCheckRun: vi.fn().mockResolvedValue({ checkId: null }) };
    configService = {
      get: vi.fn((key: string, fallback?: unknown) => {
        if (key === 'GITHUB_CHECK_NAME') return fallback ?? 'RAG Core Analysis';
        if (key === 'CONSOLE_BASE_URL') return undefined;
        return fallback;
      }),
    };
    service = new AnalysisRunChecksService(
      analysisRunsRepository as unknown as AnalysisRunsRepository,
      repositoryBindingsRepository as unknown as RepositoryBindingsRepository,
      githubChecksService as unknown as GithubChecksService,
      configService as never,
    );
  });

  it('publishes a check-run with the mapped conclusion for a terminal status', async () => {
    await service.publishForRun(buildRun({ status: 'SUCCESS' }));

    expect(repositoryBindingsRepository.findForRun).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: '123' }),
    );
    expect(githubChecksService.createCheckRun).toHaveBeenCalledWith(
      '999',
      'org/repo',
      expect.objectContaining({ headSha: 'head-sha', conclusion: 'success', summary: 'todo bien' }),
    );
  });

  it('builds detailsUrl from CONSOLE_BASE_URL when configured', async () => {
    configService.get.mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'CONSOLE_BASE_URL') return 'https://console.example.com/';
      return fallback;
    });

    await service.publishForRun(buildRun());

    expect(githubChecksService.createCheckRun).toHaveBeenCalledWith(
      '999',
      'org/repo',
      expect.objectContaining({ detailsUrl: 'https://console.example.com/projects/project-1/runs/run-1' }),
    );
  });

  it('does nothing for a non-publishable status (e.g. PROCESSING)', async () => {
    await service.publishForRun(buildRun({ status: 'PROCESSING' }));

    expect(repositoryBindingsRepository.findForRun).not.toHaveBeenCalled();
  });

  it('does not publish a check after the run stopped being current or changed status', async () => {
    analysisRunsRepository.findById.mockResolvedValue(buildRun({ status: 'OBSOLETE', current: false }));

    await service.publishForRun(buildRun());

    expect(repositoryBindingsRepository.findForRun).not.toHaveBeenCalled();
    expect(githubChecksService.createCheckRun).not.toHaveBeenCalled();
  });

  it('does nothing when there is no repository binding', async () => {
    repositoryBindingsRepository.findForRun.mockResolvedValue(null);

    await service.publishForRun(buildRun());

    expect(githubChecksService.createCheckRun).not.toHaveBeenCalled();
  });

  it('never throws when publishing the check fails (best-effort)', async () => {
    githubChecksService.createCheckRun.mockRejectedValue(new Error('GitHub API 403'));

    await expect(service.publishForRun(buildRun())).resolves.toBeUndefined();
  });

  it('persists the checkId returned by GitHub Integration on the run (WI-CORE-026)', async () => {
    githubChecksService.createCheckRun.mockResolvedValue({ checkId: 'chk-42' });

    await service.publishForRun(buildRun({ id: 'run-9' }));

    expect(analysisRunsRepository.setCheckId).toHaveBeenCalledWith('run-9', 'chk-42');
  });

  it('does not persist a checkId when GitHub Integration did not return one (204 transition)', async () => {
    githubChecksService.createCheckRun.mockResolvedValue({ checkId: null });

    await service.publishForRun(buildRun());

    expect(analysisRunsRepository.setCheckId).not.toHaveBeenCalled();
  });

  it('stays best-effort when persisting the checkId fails', async () => {
    githubChecksService.createCheckRun.mockResolvedValue({ checkId: 'chk-42' });
    analysisRunsRepository.setCheckId.mockRejectedValue(new Error('db down'));

    await expect(service.publishForRun(buildRun())).resolves.toBeUndefined();
  });
});
