import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunChecksService } from './analysis-run-checks.service.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { GithubAppAuthService } from '../github-app/github-app-auth.service.js';
import { GithubChecksService } from '../github-app/github-checks.service.js';
import type { AnalysisRun, RepositoryBinding } from '../generated/prisma/client.js';

function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryId: '123',
    headSha: 'head-sha',
    status: 'SUCCESS',
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
  let githubAppAuthService: { getInstallationToken: ReturnType<typeof vi.fn> };
  let githubChecksService: { createCheckRun: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    repositoryBindingsRepository = { findForRun: vi.fn().mockResolvedValue(binding) };
    githubAppAuthService = { getInstallationToken: vi.fn().mockResolvedValue('installation-token') };
    githubChecksService = { createCheckRun: vi.fn().mockResolvedValue(undefined) };
    configService = {
      get: vi.fn((key: string, fallback?: unknown) => {
        if (key === 'GITHUB_CHECK_NAME') return fallback ?? 'RAG Core Analysis';
        if (key === 'CONSOLE_BASE_URL') return undefined;
        return fallback;
      }),
    };
    service = new AnalysisRunChecksService(
      repositoryBindingsRepository as unknown as RepositoryBindingsRepository,
      githubAppAuthService as unknown as GithubAppAuthService,
      githubChecksService as unknown as GithubChecksService,
      configService as never,
    );
  });

  it('publishes a check-run with the mapped conclusion for a terminal status', async () => {
    await service.publishForRun(buildRun({ status: 'SUCCESS' }));

    expect(repositoryBindingsRepository.findForRun).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: '123' }),
    );
    expect(githubAppAuthService.getInstallationToken).toHaveBeenCalledWith('999');
    expect(githubChecksService.createCheckRun).toHaveBeenCalledWith(
      'org/repo',
      'installation-token',
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
      'org/repo',
      'installation-token',
      expect.objectContaining({ detailsUrl: 'https://console.example.com/projects/project-1/runs/run-1' }),
    );
  });

  it('does nothing for a non-publishable status (e.g. PROCESSING)', async () => {
    await service.publishForRun(buildRun({ status: 'PROCESSING' }));

    expect(repositoryBindingsRepository.findForRun).not.toHaveBeenCalled();
  });

  it('does nothing when there is no repository binding', async () => {
    repositoryBindingsRepository.findForRun.mockResolvedValue(null);

    await service.publishForRun(buildRun());

    expect(githubAppAuthService.getInstallationToken).not.toHaveBeenCalled();
  });

  it('never throws when publishing the check fails (best-effort)', async () => {
    githubChecksService.createCheckRun.mockRejectedValue(new Error('GitHub API 403'));

    await expect(service.publishForRun(buildRun())).resolves.toBeUndefined();
  });
});
