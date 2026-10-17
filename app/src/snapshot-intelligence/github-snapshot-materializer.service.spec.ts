import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubSnapshotMaterializerService } from './github-snapshot-materializer.service.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';

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

describe('GithubSnapshotMaterializerService', () => {
  let githubRepositoryContentService: {
    getTree: ReturnType<typeof vi.fn>;
    getFileContent: ReturnType<typeof vi.fn>;
  };
  let service: GithubSnapshotMaterializerService;
  let createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs = [];
  });

  function setup(): void {
    githubRepositoryContentService = { getTree: vi.fn(), getFileContent: vi.fn() };
    service = new GithubSnapshotMaterializerService(
      githubRepositoryContentService as never,
    );
  }

  it('filters to pool files and writes their content under a temp dir', async () => {
    setup();
    githubRepositoryContentService.getTree.mockResolvedValue([
      { path: 'src/a.ts' },
      { path: 'src/a.spec.ts' },
      { path: 'README.md' },
      { path: 'node_modules/dep/index.ts' },
      { path: 'package.json' },
    ]);
    githubRepositoryContentService.getFileContent.mockImplementation(
      async (_installationId: string, _repo: string, path: string) => `// content of ${path}`,
    );

    const workspace = await service.materialize(binding, 'head-sha');
    createdDirs.push(workspace.dir);

    expect(githubRepositoryContentService.getTree).toHaveBeenCalledWith('999', 'org/repo', 'head-sha');
    expect(githubRepositoryContentService.getFileContent).toHaveBeenCalledWith(
      '999',
      'org/repo',
      'src/a.ts',
      'head-sha',
    );

    const written = await readFile(join(workspace.dir, 'src/a.ts'), 'utf8');
    expect(written).toBe('// content of src/a.ts');

    await expect(stat(join(workspace.dir, 'README.md'))).rejects.toThrow();
    await expect(stat(join(workspace.dir, 'node_modules/dep/index.ts'))).rejects.toThrow();

    await workspace.cleanup();
    await expect(stat(workspace.dir)).rejects.toThrow();
  });

  it('always includes pnpm-lock.yaml even though it is not a pool file (needed by the Sandbox)', async () => {
    setup();
    githubRepositoryContentService.getTree.mockResolvedValue([
      { path: 'src/a.ts' },
      { path: 'pnpm-lock.yaml' },
    ]);
    githubRepositoryContentService.getFileContent.mockImplementation(
      async (_installationId: string, _repo: string, path: string) => `// content of ${path}`,
    );

    const workspace = await service.materialize(binding, 'head-sha');
    createdDirs.push(workspace.dir);

    const written = await readFile(join(workspace.dir, 'pnpm-lock.yaml'), 'utf8');
    expect(written).toBe('// content of pnpm-lock.yaml');
  });

  it('materializes nested PHP applications when the only Composer manifest is below repository root', async () => {
    setup();
    githubRepositoryContentService.getTree.mockResolvedValue([
      { path: 'backend/composer.json' },
      { path: 'backend/composer.lock' },
      { path: 'backend/src/Service.php' },
      { path: 'web/package.json' },
      { path: 'web/src/main.ts' },
      { path: 'vendor/acme/ignored.php' },
    ]);
    githubRepositoryContentService.getFileContent.mockImplementation(
      async (_installationId: string, _repo: string, path: string) => `// content of ${path}`,
    );

    const workspace = await service.materialize(binding, 'head-sha');
    createdDirs.push(workspace.dir);

    expect(githubRepositoryContentService.getFileContent.mock.calls.map((call) => call[2])).toEqual([
      'backend/composer.json', 'backend/composer.lock', 'backend/src/Service.php',
    ]);
    expect(await readFile(join(workspace.dir, 'backend/composer.json'), 'utf8')).toContain('backend/composer.json');
    await expect(stat(join(workspace.dir, 'web/src/main.ts'))).rejects.toThrow();
  });

  it('keeps TypeScript sources when only a differently-cased Composer name exists', async () => {
    setup();
    githubRepositoryContentService.getTree.mockResolvedValue([
      { path: 'COMPOSER.JSON' },
      { path: 'src/index.ts' },
      { path: 'src/Service.php' },
    ]);
    githubRepositoryContentService.getFileContent.mockImplementation(
      async (_installationId: string, _repo: string, path: string) => `// content of ${path}`,
    );

    const workspace = await service.materialize(binding, 'head-sha');
    createdDirs.push(workspace.dir);

    expect(githubRepositoryContentService.getFileContent.mock.calls.map((call) => call[2])).toEqual([
      'src/index.ts',
    ]);
    expect(await readFile(join(workspace.dir, 'src/index.ts'), 'utf8')).toContain('src/index.ts');
    await expect(stat(join(workspace.dir, 'COMPOSER.JSON'))).rejects.toThrow();
  });

  it('cleans up the temp dir if materialization fails partway through', async () => {
    setup();
    githubRepositoryContentService.getTree.mockResolvedValue([{ path: 'src/a.ts' }]);
    githubRepositoryContentService.getFileContent.mockRejectedValue(new Error('network down'));

    await expect(service.materialize(binding, 'head-sha')).rejects.toThrow('network down');
  });
});
