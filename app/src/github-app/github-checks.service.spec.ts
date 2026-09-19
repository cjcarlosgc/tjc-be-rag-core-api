import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubChecksService } from './github-checks.service.js';
import { GithubAppUnavailableError } from './github-app-auth.service.js';

const TOKEN = 'installation-token';
const REPO = 'org/repo';

describe('GithubChecksService', () => {
  const service = new GithubChecksService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs a completed check-run with the given conclusion and output', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await service.createCheckRun(REPO, TOKEN, {
      name: 'RAG Core Analysis',
      headSha: 'head-sha',
      conclusion: 'success',
      title: 'Análisis exitoso',
      summary: 'todo bien',
      detailsUrl: 'https://console.example.com/projects/p1/runs/r1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/check-runs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      name: 'RAG Core Analysis',
      head_sha: 'head-sha',
      status: 'completed',
      conclusion: 'success',
      details_url: 'https://console.example.com/projects/p1/runs/r1',
      output: { title: 'Análisis exitoso', summary: 'todo bien' },
    });
  });

  it('omits details_url when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await service.createCheckRun(REPO, TOKEN, {
      name: 'RAG Core Analysis',
      headSha: 'head-sha',
      conclusion: 'neutral',
      title: 'x',
      summary: 'y',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.details_url).toBeUndefined();
  });

  it('throws GithubAppUnavailableError on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'no checks:write' }),
    );

    await expect(
      service.createCheckRun(REPO, TOKEN, {
        name: 'RAG Core Analysis',
        headSha: 'head-sha',
        conclusion: 'success',
        title: 'x',
        summary: 'y',
      }),
    ).rejects.toBeInstanceOf(GithubAppUnavailableError);
  });
});
