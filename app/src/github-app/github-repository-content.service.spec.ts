import { describe, expect, it, vi } from 'vitest';
import { GithubRepositoryContentService } from './github-repository-content.service.js';
import { GithubAppUnavailableError } from './github-app-auth.service.js';
import {
  GithubIntegrationClientError,
  type GithubIntegrationClient,
} from './github-integration.client.js';

const INSTALLATION_ID = '999';
const REPOSITORY_NAME = 'org/repo';

function setup() {
  const integration = { post: vi.fn() };
  return {
    integration,
    service: new GithubRepositoryContentService(integration as unknown as GithubIntegrationClient),
  };
}

describe('GithubRepositoryContentService', () => {
  it('loads the compare from GitHub Integration and preserves renamed files', async () => {
    const { integration, service } = setup();
    integration.post.mockResolvedValue({
      status: 'OK',
      value: {
        files: [{ filename: 'src/new.ts', status: 'renamed', previousFilename: 'src/old.ts' }],
      },
    });

    await expect(service.compare(INSTALLATION_ID, REPOSITORY_NAME, 'base', 'head')).resolves.toEqual([
      { filename: 'src/new.ts', status: 'renamed', previousFilename: 'src/old.ts' },
    ]);
    expect(integration.post).toHaveBeenCalledWith('/repositories/compare', {
      installationId: INSTALLATION_ID,
      repositoryName: REPOSITORY_NAME,
      baseSha: 'base',
      headSha: 'head',
    });
  });

  it.each([
    ['NOT_FOUND', 404],
    ['NOT_INSTALLED', 403],
    ['UNVERIFIABLE', 503],
  ] as const)('preserves lookup status %s when not OK', async (status, httpStatus) => {
    const { integration, service } = setup();
    integration.post.mockResolvedValue({ status });

    await expect(service.compare(INSTALLATION_ID, REPOSITORY_NAME, 'base', 'head')).rejects.toMatchObject({
      constructor: GithubAppUnavailableError,
      status: httpStatus,
    });
  });

  it('maps the verified tree and decodes file bytes returned as base64', async () => {
    const { integration, service } = setup();
    integration.post
      .mockResolvedValueOnce({ status: 'OK', value: { paths: ['src/a.ts'], truncated: false } })
      .mockResolvedValueOnce({
        status: 'OK',
        value: { files: [{ path: 'src/a.ts', contentBase64: Buffer.from('export const a = 1;').toString('base64') }] },
      });

    await expect(service.getTree(INSTALLATION_ID, REPOSITORY_NAME, 'head')).resolves.toEqual([
      { path: 'src/a.ts' },
    ]);
    await expect(service.getFileContent(INSTALLATION_ID, REPOSITORY_NAME, 'src/a.ts', 'head')).resolves.toBe(
      'export const a = 1;',
    );
    expect(integration.post).toHaveBeenNthCalledWith(2, '/repositories/files:batch', {
      installationId: INSTALLATION_ID,
      repositoryName: REPOSITORY_NAME,
      commitSha: 'head',
      paths: ['src/a.ts'],
    });
  });

  it('loads branches and pull-request freshness through the internal contract', async () => {
    const { integration, service } = setup();
    integration.post
      .mockResolvedValueOnce({ status: 'OK', value: { items: [{ name: 'main', protected: true }] } })
      .mockResolvedValueOnce({ status: 'OK', value: { headSha: 'live', state: 'open' } });

    await expect(service.listBranches(INSTALLATION_ID, REPOSITORY_NAME)).resolves.toEqual([
      { name: 'main', protected: true },
    ]);
    await expect(service.getPullRequestHead(INSTALLATION_ID, REPOSITORY_NAME, 42)).resolves.toEqual({
      headSha: 'live',
      state: 'open',
    });
    expect(integration.post).toHaveBeenNthCalledWith(2, '/repositories/pull-request-head', {
      installationId: INSTALLATION_ID,
      repositoryName: REPOSITORY_NAME,
      pullRequestNumber: 42,
    });
  });

  it('maps transport and malformed response failures to a neutral unavailable error', async () => {
    const { integration, service } = setup();
    integration.post.mockRejectedValue(
      new GithubIntegrationClientError('GITHUB_UPSTREAM_UNAVAILABLE', 503, true),
    );
    await expect(service.listBranches(INSTALLATION_ID, REPOSITORY_NAME)).rejects.toMatchObject({
      name: 'GithubAppUnavailableError',
      status: 503,
      message: 'GitHub Integration no está disponible.',
    });

    integration.post.mockResolvedValue({ status: 'OK', value: { items: 'not-an-array' } });
    await expect(service.listBranches(INSTALLATION_ID, REPOSITORY_NAME)).rejects.toMatchObject({
      status: 503,
      message: 'GitHub Integration devolvió una respuesta inválida.',
    });
  });
});
