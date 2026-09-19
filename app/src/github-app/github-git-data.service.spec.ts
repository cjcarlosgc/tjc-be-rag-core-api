import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubGitDataService } from './github-git-data.service.js';
import { GithubAppUnavailableError } from './github-app-auth.service.js';

const TOKEN = 'installation-token';
const REPO = 'org/repo';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('GithubGitDataService', () => {
  const service = new GithubGitDataService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getBranchHeadSha', () => {
    it('returns the branch sha when it exists', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ object: { sha: 'branch-sha' } })));

      await expect(service.getBranchHeadSha(REPO, 'rag-tests/pr-1-abc1234', TOKEN)).resolves.toBe('branch-sha');
    });

    it('returns null when the branch does not exist (404)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 404)));

      await expect(service.getBranchHeadSha(REPO, 'rag-tests/pr-1-abc1234', TOKEN)).resolves.toBeNull();
    });
  });

  it('createBranch POSTs the ref with refs/heads/ prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await service.createBranch(REPO, 'rag-tests/pr-1-abc1234', 'head-sha', TOKEN);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/org/repo/git/refs');
    expect(JSON.parse(options.body)).toEqual({ ref: 'refs/heads/rag-tests/pr-1-abc1234', sha: 'head-sha' });
  });

  it('getCommitTreeSha resolves the tree sha of a commit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ tree: { sha: 'tree-sha' } })));

    await expect(service.getCommitTreeSha(REPO, 'commit-sha', TOKEN)).resolves.toBe('tree-sha');
  });

  it('createBlob POSTs utf-8 content and returns the blob sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sha: 'blob-sha' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.createBlob(REPO, 'export const x = 1;', TOKEN)).resolves.toBe('blob-sha');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      content: 'export const x = 1;',
      encoding: 'utf-8',
    });
  });

  it('createTree creates a blob per entry then POSTs the tree with base_tree', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ sha: 'blob-1' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'blob-2' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'tree-sha' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.createTree(
      REPO,
      'base-tree-sha',
      [
        { path: 'src/a.spec.ts', content: 'a' },
        { path: 'src/b.spec.ts', content: 'b' },
      ],
      TOKEN,
    );

    expect(result).toBe('tree-sha');
    const treeBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(treeBody).toEqual({
      base_tree: 'base-tree-sha',
      tree: [
        { path: 'src/a.spec.ts', mode: '100644', type: 'blob', sha: 'blob-1' },
        { path: 'src/b.spec.ts', mode: '100644', type: 'blob', sha: 'blob-2' },
      ],
    });
  });

  it('createCommit POSTs message/tree/parents and returns the commit sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sha: 'commit-sha' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.createCommit(REPO, 'msg', 'tree-sha', 'parent-sha', TOKEN)).resolves.toBe('commit-sha');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      message: 'msg',
      tree: 'tree-sha',
      parents: ['parent-sha'],
    });
  });

  it('updateRef PATCHes the branch ref without force', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await service.updateRef(REPO, 'rag-tests/pr-1-abc1234', 'commit-sha', TOKEN);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/org/repo/git/refs/heads/rag-tests/pr-1-abc1234');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ sha: 'commit-sha', force: false });
  });

  describe('findPullRequestByHead', () => {
    it('returns the first matching PR with its state', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse([{ number: 7, html_url: 'https://github.com/org/repo/pull/7', state: 'open' }])),
      );

      await expect(service.findPullRequestByHead(REPO, 'rag-tests/pr-1-abc1234', TOKEN)).resolves.toEqual({
        number: 7,
        url: 'https://github.com/org/repo/pull/7',
        state: 'open',
      });
    });

    it('returns null when no PR matches that head branch', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));

      await expect(service.findPullRequestByHead(REPO, 'rag-tests/pr-1-abc1234', TOKEN)).resolves.toBeNull();
    });
  });

  it('createPullRequest POSTs title/head/base/body and returns the new PR ref', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ number: 9, html_url: 'https://github.com/org/repo/pull/9' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.createPullRequest(
      REPO,
      { title: 't', head: 'rag-tests/pr-1-abc1234', base: 'feature/x', body: 'b' },
      TOKEN,
    );

    expect(result).toEqual({ number: 9, url: 'https://github.com/org/repo/pull/9', state: 'open' });
  });

  it('throws GithubAppUnavailableError on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 422)));

    await expect(service.createBranch(REPO, 'x', 'sha', TOKEN)).rejects.toBeInstanceOf(GithubAppUnavailableError);
  });
});
