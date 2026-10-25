import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubSnapshotMaterializerService } from './github-snapshot-materializer.service.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';

const fsState = vi.hoisted(() => ({ rmFailure: undefined as unknown }));

// Permite simular que `rm` falla (p. ej. ENOTEMPTY) y delega en el real en el resto.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const rm = async (...args: Parameters<typeof actual.rm>): Promise<void> => {
    if (fsState.rmFailure !== undefined) {
      throw fsState.rmFailure;
    }
    return actual.rm(...args);
  };
  return { ...actual, default: { ...actual, rm }, rm };
});

const osState = vi.hoisted(() => ({ base: undefined as string | undefined }));

// Aísla el directorio temporal de cada prueba para localizar el workspace
// creado por `materialize` sin depender de otros specs en paralelo.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const tmpdir = (): string => osState.base ?? actual.tmpdir();
  return { ...actual, default: { ...actual, tmpdir }, tmpdir };
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  let base: string;

  async function workspaceDirs(): Promise<string[]> {
    return (await readdir(base)).filter((name) => name.startsWith('rag-core-snapshot-'));
  }

  beforeEach(async () => {
    const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
    base = await mkdtemp(join(tmpdir(), 'rag-core-materializer-spec-'));
    osState.base = base;
  });

  afterEach(async () => {
    osState.base = undefined;
    fsState.rmFailure = undefined;
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs = [];
    await rm(base, { recursive: true, force: true });
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

  it('rethrows the original download error and leaves no directory while sibling writers are still running', async () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      setup();
      const paths = Array.from({ length: 8 }, (_, index) => `src/dir${index}/file${index}.ts`);
      githubRepositoryContentService.getTree.mockResolvedValue(paths.map((path) => ({ path })));
      const originalError = new Error('fallo original');
      githubRepositoryContentService.getFileContent.mockImplementation(
        async (_installationId: string, _repo: string, path: string) => {
          if (path === paths[0]) {
            throw originalError;
          }
          // Retardos distintos por iteración y archivo: las descargas hermanas
          // terminan (y escriben) después del rechazo de la primera.
          await sleep(3 + ((iteration * 7 + paths.indexOf(path) * 5) % 25));
          return `// content of ${path}`;
        },
      );

      await expect(service.materialize(binding, 'head-sha')).rejects.toBe(originalError);

      expect(await workspaceDirs()).toEqual([]);
      await sleep(60);
      expect(await workspaceDirs()).toEqual([]);
    }
  });

  it('rethrows the rejection with the lowest position in the batch, not the first one in time, and removes the directory', async () => {
    setup();
    const paths = Array.from({ length: 4 }, (_, index) => `src/file${index}.ts`);
    githubRepositoryContentService.getTree.mockResolvedValue(paths.map((path) => ({ path })));
    const firstError = new Error('primer fallo');
    const secondError = new Error('segundo fallo');
    githubRepositoryContentService.getFileContent.mockImplementation(
      async (_installationId: string, _repo: string, path: string) => {
        if (path === 'src/file1.ts') {
          // Posición menor, pero rechaza después en el tiempo.
          await sleep(40);
          throw firstError;
        }
        if (path === 'src/file2.ts') {
          // Posición mayor, pero rechaza antes en el tiempo.
          await sleep(5);
          throw secondError;
        }
        await sleep(10);
        return `// content of ${path}`;
      },
    );

    await expect(service.materialize(binding, 'head-sha')).rejects.toBe(firstError);

    expect(await workspaceDirs()).toEqual([]);
    await sleep(60);
    expect(await workspaceDirs()).toEqual([]);
  });

  it('keeps the first batch written, then cleans everything and rethrows the original error when the second batch fails', async () => {
    setup();
    const paths = Array.from({ length: 16 }, (_, index) => `src/file${index}.ts`);
    githubRepositoryContentService.getTree.mockResolvedValue(paths.map((path) => ({ path })));
    const originalError = new Error('fallo en el segundo lote');
    let firstBatchWasWritten = false;
    githubRepositoryContentService.getFileContent.mockImplementation(
      async (_installationId: string, _repo: string, path: string) => {
        if (path === 'src/file8.ts') {
          const [dir] = await workspaceDirs();
          firstBatchWasWritten = (await readFile(join(base, dir, 'src/file0.ts'), 'utf8')) === '// content of src/file0.ts';
          throw originalError;
        }
        await sleep(5);
        return `// content of ${path}`;
      },
    );

    await expect(service.materialize(binding, 'head-sha')).rejects.toBe(originalError);

    expect(firstBatchWasWritten).toBe(true);
    expect(await workspaceDirs()).toEqual([]);
    await sleep(40);
    expect(await workspaceDirs()).toEqual([]);
  });

  it('rethrows the original error and never throws from cleanup even when directory removal fails', async () => {
    setup();
    githubRepositoryContentService.getTree.mockResolvedValue([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]);
    const originalError = new Error('fallo original');
    githubRepositoryContentService.getFileContent.mockImplementation(
      async (_installationId: string, _repo: string, path: string) => {
        if (path === 'src/a.ts') {
          throw originalError;
        }
        return '// b';
      },
    );
    fsState.rmFailure = Object.assign(new Error('ENOTEMPTY: directory not empty'), { code: 'ENOTEMPTY' });

    await expect(service.materialize(binding, 'head-sha')).rejects.toBe(originalError);

    fsState.rmFailure = undefined;
    githubRepositoryContentService.getFileContent.mockResolvedValue('// ok');
    const workspace = await service.materialize(binding, 'head-sha');
    createdDirs.push(workspace.dir);
    fsState.rmFailure = Object.assign(new Error('ENOTEMPTY: directory not empty'), { code: 'ENOTEMPTY' });
    await expect(workspace.cleanup()).resolves.toBeUndefined();
  });

  it('cleanup removes the workspace directory and is idempotent', async () => {
    setup();
    githubRepositoryContentService.getTree.mockResolvedValue([{ path: 'src/a.ts' }]);
    githubRepositoryContentService.getFileContent.mockResolvedValue('// a');

    const workspace = await service.materialize(binding, 'head-sha');
    createdDirs.push(workspace.dir);
    await expect(stat(workspace.dir)).resolves.toBeDefined();

    await expect(workspace.cleanup()).resolves.toBeUndefined();
    await expect(stat(workspace.dir)).rejects.toThrow();
    await expect(workspace.cleanup()).resolves.toBeUndefined();
  });
});
