import { describe, expect, it, vi } from 'vitest';
import { GithubGitDataService } from './github-git-data.service.js';
import { GithubAppUnavailableError } from './github-app-auth.service.js';
import type { GithubIntegrationClient } from './github-integration.client.js';

const request = {
  installationId: '999',
  repositoryName: 'org/repo',
  pullRequestNumber: 42,
  sourceHeadSha: 'source-head',
};

describe('GithubGitDataService', () => {
  it('runs a freshness preflight before any proposal upload', async () => {
    const integration = { post: vi.fn().mockResolvedValue({ status: 'READY' }) };
    const service = new GithubGitDataService(integration as unknown as GithubIntegrationClient);

    await expect(service.preflight(request)).resolves.toEqual({ status: 'READY' });
    expect(integration.post).toHaveBeenCalledWith(
      '/publications/companion-pull-request/preflight',
      request,
    );
  });

  it('sends one proposal blob with the extended deadline and validates the response', async () => {
    const integration = {
      post: vi.fn().mockResolvedValue({ status: 'UPLOADED', path: 'tests/a.spec.ts', blobSha: 'blob-sha' }),
    };
    const service = new GithubGitDataService(integration as unknown as GithubIntegrationClient);
    const upload = { ...request, path: 'tests/a.spec.ts', contentBase64: 'ZXhwb3J0IHt9' };

    await expect(service.uploadProposalBlob(upload)).resolves.toEqual({
      status: 'UPLOADED',
      path: 'tests/a.spec.ts',
      blobSha: 'blob-sha',
    });
    expect(integration.post).toHaveBeenCalledWith(
      '/publications/companion-pull-request/proposal-blobs',
      upload,
      { timeoutMs: 180_000 },
    );
  });

  it('finalizes only from already-uploaded blob references', async () => {
    const integration = {
      post: vi.fn().mockResolvedValue({
        status: 'PUBLISHED',
        branchName: 'rag-tests/pr-42-sourceh',
        commitSha: 'commit-sha',
        pullRequest: { number: 9, url: 'https://github.com/org/repo/pull/9' },
      }),
    };
    const service = new GithubGitDataService(integration as unknown as GithubIntegrationClient);
    const finalization = {
      ...request,
      sourceHeadRef: 'feature/example',
      analysisRunId: 'run-1',
      proposalFiles: [{ path: 'tests/a.spec.ts', blobSha: 'blob-sha' }],
    };

    await expect(service.finalize(finalization)).resolves.toMatchObject({ status: 'PUBLISHED', commitSha: 'commit-sha' });
    expect(integration.post).toHaveBeenCalledWith(
      '/publications/companion-pull-request',
      finalization,
      { timeoutMs: 180_000 },
    );
  });

  it('rejects malformed successful responses without exposing raw data', async () => {
    const integration = { post: vi.fn().mockResolvedValue({ status: 'PUBLISHED', pullRequest: { url: 'javascript:alert(1)' } }) };
    const service = new GithubGitDataService(integration as unknown as GithubIntegrationClient);

    await expect(service.finalize({
      ...request,
      sourceHeadRef: 'feature/example',
      analysisRunId: 'run-1',
      proposalFiles: [],
    })).rejects.toBeInstanceOf(GithubAppUnavailableError);
  });
});
