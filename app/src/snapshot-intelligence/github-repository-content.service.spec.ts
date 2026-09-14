import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubRepositoryContentService } from './github-repository-content.service.js';
import { GithubAppUnavailableError } from './github-app-auth.service.js';

const TOKEN = 'installation-token';
const REPO = 'org/repo';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('GithubRepositoryContentService', () => {
  let service: GithubRepositoryContentService;

  beforeEach(() => {
    service = new GithubRepositoryContentService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('compare', () => {
    it('returns the changed files for a base...head compare', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          files: [
            { filename: 'src/a.ts', status: 'modified' },
            { filename: 'src/b.ts', status: 'added' },
            { filename: 'src/old.ts', status: 'renamed', previous_filename: 'src/older.ts' },
          ],
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const files = await service.compare(REPO, 'base-sha', 'head-sha', TOKEN);

      expect(files).toEqual([
        { filename: 'src/a.ts', status: 'modified' },
        { filename: 'src/b.ts', status: 'added' },
        { filename: 'src/old.ts', status: 'renamed', previousFilename: 'src/older.ts' },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.github.com/repos/${REPO}/compare/base-sha...head-sha?per_page=100&page=1`,
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }) }),
      );
    });

    it('paginates when a page comes back full (100 files)', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({ filename: `src/f${i}.ts`, status: 'modified' as const }));
      const secondPage = [{ filename: 'src/last.ts', status: 'modified' as const }];
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ files: fullPage }))
        .mockResolvedValueOnce(jsonResponse({ files: secondPage }));
      vi.stubGlobal('fetch', fetchMock);

      const files = await service.compare(REPO, 'base-sha', 'head-sha', TOKEN);

      expect(files).toHaveLength(101);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain('page=2');
    });

    it('throws GithubAppUnavailableError on a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 403)));

      await expect(service.compare(REPO, 'base-sha', 'head-sha', TOKEN)).rejects.toBeInstanceOf(
        GithubAppUnavailableError,
      );
    });
  });

  describe('getTree', () => {
    it('returns only blob entries from a recursive tree', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            truncated: false,
            tree: [
              { path: 'src', type: 'tree' },
              { path: 'src/a.ts', type: 'blob' },
              { path: 'src/b.ts', type: 'blob' },
            ],
          }),
        ),
      );

      const entries = await service.getTree(REPO, 'head-sha', TOKEN);

      expect(entries).toEqual([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]);
    });
  });

  describe('getFileContent', () => {
    it('decodes base64 content from the Contents API', async () => {
      const content = Buffer.from('export const x = 1;', 'utf8').toString('base64');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ content, encoding: 'base64' })));

      const result = await service.getFileContent(REPO, 'src/a.ts', 'head-sha', TOKEN);

      expect(result).toBe('export const x = 1;');
    });
  });
});
