import { describe, expect, it, vi } from 'vitest';
import { GithubChecksService } from './github-checks.service.js';
import { GithubIntegrationClient } from './github-integration.client.js';

describe('GithubChecksService', () => {
  it('delegates a completed check to GitHub Integration', async () => {
    const integration = { post: vi.fn().mockResolvedValue({ checkId: 'chk-1' }) };
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
    }, { tolerateUnreadableSuccessBody: true });
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

  it('returns the checkId of a 200 response, and null for a 204 without body (GH-INTEROP 1.3 transition)', async () => {
    const withBody = new GithubChecksService({ post: vi.fn().mockResolvedValue({ checkId: 'chk-200' }) } as unknown as GithubIntegrationClient);
    const withoutBody = new GithubChecksService({ post: vi.fn().mockResolvedValue(undefined) } as unknown as GithubIntegrationClient);
    const input = { name: 'RAG Core Analysis', headSha: 'head-sha', conclusion: 'success' as const, title: 't', summary: 's' };

    await expect(withBody.createCheckRun('999', 'org/repo', input)).resolves.toEqual({ checkId: 'chk-200' });
    await expect(withoutBody.createCheckRun('999', 'org/repo', input)).resolves.toEqual({ checkId: null });
  });

  it('treats any other response shape as checkId null without throwing', async () => {
    const shapes: unknown[] = [{}, { checkId: 42 }, { checkId: '' }, { checkId: null }, 'texto', null];

    for (const body of shapes) {
      const service = new GithubChecksService({ post: vi.fn().mockResolvedValue(body) } as unknown as GithubIntegrationClient);
      await expect(
        service.createCheckRun('999', 'org/repo', { name: 'n', headSha: 'h', conclusion: 'success', title: 't', summary: 's' }),
      ).resolves.toEqual({ checkId: null });
    }
  });

  it('returns the same checkId when the same headSha and name are created again (idempotent on GitHub Integration)', async () => {
    const created = new Map<string, string>();
    const integration = {
      post: vi.fn(async (_path: string, body: { headSha: string; name: string }) => {
        const key = `${body.headSha}|${body.name}`;
        if (!created.has(key)) created.set(key, `chk-${created.size + 1}`);
        return { checkId: created.get(key) };
      }),
    };
    const service = new GithubChecksService(integration as unknown as GithubIntegrationClient);
    const input = { name: 'RAG Core Analysis', headSha: 'head-sha', conclusion: 'success' as const, title: 't', summary: 's' };

    const first = await service.createCheckRun('999', 'org/repo', input);
    const second = await service.createCheckRun('999', 'org/repo', input);

    expect(first).toEqual({ checkId: 'chk-1' });
    expect(second).toEqual(first);
  });

  it('treats a 200 whose body is not JSON as checkId null without throwing, because the Check already exists', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));
    const config = { get: (key: string) => ({ GITHUB_INTEGRATION_API_BASE_URL: 'https://github-integration.example.test', CORE_TO_GITHUB_INTEGRATION_TOKEN: 'service-secret-token' })[key] };
    const service = new GithubChecksService(new GithubIntegrationClient(config as never, fetcher));

    await expect(
      service.createCheckRun('999', 'org/repo', { name: 'n', headSha: 'h', conclusion: 'success', title: 't', summary: 's' }),
    ).resolves.toEqual({ checkId: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps throwing for other HTTP errors and transport failures', async () => {
    const config = { get: (key: string) => ({ GITHUB_INTEGRATION_API_BASE_URL: 'https://github-integration.example.test', CORE_TO_GITHUB_INTEGRATION_TOKEN: 'service-secret-token' })[key] };
    const input = { name: 'n', headSha: 'h', conclusion: 'success' as const, title: 't', summary: 's' };
    const serverError = new GithubChecksService(new GithubIntegrationClient(config as never, vi.fn<typeof fetch>().mockResolvedValue(new Response('boom', { status: 500 }))));
    const transport = new GithubChecksService(new GithubIntegrationClient(config as never, vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network'))));

    await expect(serverError.createCheckRun('999', 'org/repo', input)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_UNAVAILABLE', status: 500 });
    await expect(transport.createCheckRun('999', 'org/repo', input)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_UNAVAILABLE', status: undefined });
  });
});
