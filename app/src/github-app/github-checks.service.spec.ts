import { describe, expect, it, vi } from 'vitest';
import { GithubChecksService } from './github-checks.service.js';
import type { GithubIntegrationClient } from './github-integration.client.js';

describe('GithubChecksService', () => {
  it('delegates a completed check to GitHub Integration', async () => {
    const integration = { post: vi.fn().mockResolvedValue(undefined) };
    const service = new GithubChecksService(integration as unknown as GithubIntegrationClient);

    await service.createCheckRun('999', 'org/repo', {
      name: 'RAG Core Analysis',
      headSha: 'head-sha',
      conclusion: 'success',
      title: 'Análisis exitoso',
      summary: 'todo bien',
      detailsUrl: 'https://console.example.com/projects/p1/runs/r1',
    });

    expect(integration.post).toHaveBeenCalledWith('/checks', {
      installationId: '999',
      repositoryName: 'org/repo',
      name: 'RAG Core Analysis',
      headSha: 'head-sha',
      conclusion: 'success',
      title: 'Análisis exitoso',
      summary: 'todo bien',
      detailsUrl: 'https://console.example.com/projects/p1/runs/r1',
    });
  });

  it('omits an absent details URL', async () => {
    const integration = { post: vi.fn().mockResolvedValue(undefined) };
    const service = new GithubChecksService(integration as unknown as GithubIntegrationClient);

    await service.createCheckRun('999', 'org/repo', {
      name: 'RAG Core Analysis',
      headSha: 'head-sha',
      conclusion: 'neutral',
      title: 'Sin cambios',
      summary: 'No hay cambios fuente.',
    });

    expect(integration.post.mock.calls[0][1]).not.toHaveProperty('detailsUrl');
  });
});
