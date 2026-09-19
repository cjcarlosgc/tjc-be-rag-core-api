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
  let githubAppAuthService: { getInstallationToken: ReturnType<typeof vi.fn> };
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
    githubAppAuthService = { getInstallationToken: vi.fn().mockResolvedValue('installation-token') };
    githubRepositoryContentService = { getTree: vi.fn(), getFileContent: vi.fn() };
    service = new GithubSnapshotMaterializerService(
      githubAppAuthService as never,
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
      async (_repo: string, path: string) => `// content of ${path}`,
    );

    const workspace = await service.materialize(binding, 'head-sha');
    createdDirs.push(workspace.dir);

    expect(githubAppAuthService.getInstallationToken).toHaveBeenCalledWith('999');
    expect(githubRepositoryContentService.getTree).toHaveBeenCalledWith('org/repo', 'head-sha', 'installation-token');

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
      async (_repo: string, path: string) => `// content of ${path}`,
    );

    const workspace = await service.materialize(binding, 'head-sha');
    createdDirs.push(workspace.dir);

    const written = await readFile(join(workspace.dir, 'pnpm-lock.yaml'), 'utf8');
    expect(written).toBe('// content of pnpm-lock.yaml');
  });

  it('cleans up the temp dir if materialization fails partway through', async () => {
    setup();
    githubRepositoryContentService.getTree.mockResolvedValue([{ path: 'src/a.ts' }]);
    githubRepositoryContentService.getFileContent.mockRejectedValue(new Error('network down'));

    await expect(service.materialize(binding, 'head-sha')).rejects.toThrow('network down');
  });
});
