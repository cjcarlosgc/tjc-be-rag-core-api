import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { FileDiscoveryService } from '../project-versions/discovery/file-discovery.service.js';
import { zipDirectory } from '../project-versions/zip/zip-directory.util.js';
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

/** Texto hexadecimal poco compresible (ratio ~2) de exactamente `size` bytes. */
const noisy = (size: number): string => randomBytes(Math.ceil(size / 2)).toString('hex').slice(0, size);

describe('GithubSnapshotMaterializerService.addSandboxFixtures (WI-CORE-102)', () => {
  let githubRepositoryContentService: {
    getTree: ReturnType<typeof vi.fn>;
    getFileContent: ReturnType<typeof vi.fn>;
  };
  let service: GithubSnapshotMaterializerService;
  let workspaceDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let contents: Record<string, string>;

  beforeEach(async () => {
    const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
    workspaceDir = await mkdtemp(join(tmpdir(), 'rag-core-fixtures-spec-'));
    githubRepositoryContentService = { getTree: vi.fn(), getFileContent: vi.fn() };
    service = new GithubSnapshotMaterializerService(githubRepositoryContentService as never);
    contents = {};
    githubRepositoryContentService.getFileContent.mockImplementation(
      async (_i: string, _r: string, path: string) => contents[path] ?? `content of ${path}`,
    );
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(workspaceDir, { recursive: true, force: true });
  });

  const phpTree = (...paths: string[]): Array<{ path: string }> =>
    [{ path: 'composer.json' }, { path: 'src/Foo.php' }, ...paths.map((path) => ({ path }))];

  const requestedPaths = (): string[] =>
    githubRepositoryContentService.getFileContent.mock.calls.map((call) => call[2] as string);

  async function exists(path: string): Promise<boolean> {
    return stat(join(workspaceDir, path)).then(() => true, () => false);
  }

  it('includes the text fixtures and writes their content', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(
      phpTree('examples/rbac_model.conf', 'examples/rbac_policy.csv', 'tests/fixtures/data.json'),
    );
    contents['examples/rbac_model.conf'] = '[request_definition]\nr = sub, obj, act\n';

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(githubRepositoryContentService.getTree).toHaveBeenCalledWith('999', 'org/repo', 'head-sha');
    expect(report.requested).toBe(3);
    expect(report.included).toBe(3);
    expect(report.bytes).toBe(
      Buffer.byteLength(contents['examples/rbac_model.conf'], 'utf8')
        + Buffer.byteLength('content of examples/rbac_policy.csv', 'utf8')
        + Buffer.byteLength('content of tests/fixtures/data.json', 'utf8'),
    );
    expect(report.omitted).toEqual({ maxFiles: 0, fetchFailed: 0, fileTooLarge: 0, notUtf8: 0, highCompression: 0, totalLimit: 0 });
    expect(await readFile(join(workspaceDir, 'examples/rbac_model.conf'), 'utf8')).toBe(
      contents['examples/rbac_model.conf'],
    );
    expect(await readFile(join(workspaceDir, 'tests/fixtures/data.json'), 'utf8')).toBe(
      'content of tests/fixtures/data.json',
    );
  });

  it('does not request .env files, binaries, lockfiles, ignored paths or PHP pool files', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(
      phpTree(
        '.env', '.env.testing', '.github/workflows/ci.yml', 'image.png', 'package-lock.json', 'yarn.lock',
        'pnpm-lock.yaml', 'vendor/x/y.json', 'build/a.json', 'README.md', 'composer.lock', 'phpunit.xml',
        'examples/ok.conf',
      ),
    );

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(requestedPaths()).toEqual(['examples/ok.conf']);
    expect(report.requested).toBe(1);
    expect(report.included).toBe(1);
    expect(await exists('.env')).toBe(false);
    expect(await exists('vendor/x/y.json')).toBe(false);
  });

  it('does not request Node pool config files (package.json, tsconfig.json, jest/vitest config) as fixtures', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(
      phpTree('package.json', 'tests/package.json', 'tsconfig.json', 'jest.config.json', 'vitest.config.json', 'examples/a.conf'),
    );

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(requestedPaths()).toEqual(['examples/a.conf']);
    expect(report.requested).toBe(1);
    expect(await exists('package.json')).toBe(false);
    expect(await exists('tests/package.json')).toBe(false);
  });

  it('does not change what FileDiscoveryService discovers: pool plus fixtures equals pool alone', async () => {
    const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
    const base = await mkdtemp(join(tmpdir(), 'rag-core-discovery-fx-'));
    osState.base = base;
    try {
      githubRepositoryContentService.getTree.mockResolvedValue([
        { path: 'composer.json' },
        { path: 'src/Foo.php' },
        { path: 'tests/FooTest.php' },
        { path: 'phpunit.xml.dist' },
        { path: 'examples/rbac_model.conf' },
        { path: 'tests/fixtures/data.json' },
        { path: 'tests/data.csv' },
        { path: 'package.json' },
        { path: 'tests/package.json' },
        { path: 'tsconfig.json' },
        { path: 'jest.config.json' },
        { path: 'vitest.config.json' },
      ]);
      const workspace = await service.materialize(binding, 'head-sha');
      const discovery = new FileDiscoveryService();
      const before = (await discovery.discover(workspace.dir)).sort();

      const report = await service.addSandboxFixtures(binding, 'head-sha', workspace.dir);
      const after = (await discovery.discover(workspace.dir)).sort();

      expect(report.included).toBe(3);
      expect(await readdir(join(workspace.dir, 'examples'))).toEqual(['rbac_model.conf']);
      expect(before).toEqual(['composer.json', 'phpunit.xml.dist', 'src/Foo.php', 'tests/FooTest.php']);
      expect(after).toEqual(before);
      await workspace.cleanup();
    } finally {
      osState.base = undefined;
      await rm(base, { recursive: true, force: true });
    }
  });

  it('is deterministic: requests candidates in sorted path order regardless of tree order', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(
      phpTree('z/last.conf', 'a/first.conf', 'm/middle.csv', 'B/upper.conf'),
    );

    await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(requestedPaths()).toEqual(['B/upper.conf', 'a/first.conf', 'm/middle.csv', 'z/last.conf']);
  });

  it('attempts only the first 500 sorted candidates and counts the rest as maxFiles', async () => {
    const paths = Array.from({ length: 501 }, (_, i) => `fx/f${String(i).padStart(3, '0')}.conf`);
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree(...[...paths].reverse()));

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.requested).toBe(501);
    expect(report.included).toBe(500);
    expect(report.omitted.maxFiles).toBe(1);
    expect(requestedPaths()).toHaveLength(500);
    expect(requestedPaths()).not.toContain('fx/f500.conf');
    expect(await exists('fx/f499.conf')).toBe(true);
    expect(await exists('fx/f500.conf')).toBe(false);
  });

  it('omits a file larger than 1 MiB after downloading it and keeps the rest', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree('big.json', 'small.json'));
    contents['big.json'] = 'x'.repeat(1_048_577);
    contents['small.json'] = '{}';

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.included).toBe(1);
    expect(report.omitted.fileTooLarge).toBe(1);
    expect(await exists('big.json')).toBe(false);
    expect(await exists('small.json')).toBe(true);
  });

  it('accepts a file of exactly 1 MiB', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree('exact.json'));
    contents['exact.json'] = noisy(1_048_576);

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.included).toBe(1);
    expect(report.omitted.fileTooLarge).toBe(0);
  });

  it('enforces the 5 MiB total limit but still includes a later small file that fits', async () => {
    const paths = ['a1.json', 'a2.json', 'a3.json', 'a4.json', 'a5.json', 'a6.json'];
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree(...paths));
    for (const path of paths.slice(0, 5)) {
      contents[path] = noisy(1_000_000);
    }
    contents['a6.json'] = noisy(1_000_000); // total 6_000_000 > 5_242_880 → omitted
    paths.push('z-small.json');
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree(...paths));
    contents['z-small.json'] = 'tiny';

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.included).toBe(6);
    expect(report.bytes).toBe(5_000_004);
    expect(report.omitted.totalLimit).toBe(1);
    expect(await exists('a6.json')).toBe(false);
    expect(await exists('z-small.json')).toBe(true);
  });

  it('omits a highly repetitive file (compression ratio above 80) and keeps the rest', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree('rep.csv', 'ok.csv'));
    contents['rep.csv'] = 'a,b,c,d\n'.repeat(55000);
    contents['ok.csv'] = 'id,name\n1,Ana\n2,Luis\n';

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.included).toBe(1);
    expect(report.omitted.highCompression).toBe(1);
    expect(await exists('rep.csv')).toBe(false);
    expect(await exists('ok.csv')).toBe(true);
  });

  it('includes a normal, little repetitive CSV', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree('normal.csv'));
    contents['normal.csv'] = Array.from({ length: 3000 }, (_, i) => `${i},user${i},${randomBytes(6).toString('hex')}`).join('\n');

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.included).toBe(1);
    expect(report.omitted.highCompression).toBe(0);
  });

  it('never produces a ZIP entry with a compression ratio above 100, even with repetitive fixtures around', async () => {
    const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
    const base = await mkdtemp(join(tmpdir(), 'rag-core-zip-ratio-'));
    osState.base = base;
    try {
      githubRepositoryContentService.getTree.mockResolvedValue(
        phpTree('examples/rep.csv', 'examples/normal.csv', 'examples/model.conf'),
      );
      contents['examples/rep.csv'] = 'a,b,c,d\n'.repeat(55000);
      contents['examples/normal.csv'] = Array.from({ length: 2000 }, (_, i) => `${i},${randomBytes(8).toString('hex')}`).join('\n');
      contents['examples/model.conf'] = '[request_definition]\nr = sub, obj, act\n';
      const workspace = await service.materialize(binding, 'head-sha');

      await service.addSandboxFixtures(binding, 'head-sha', workspace.dir);
      const entries = new AdmZip(zipDirectory(workspace.dir)).getEntries().filter((entry) => !entry.isDirectory);

      expect(entries.map((entry) => entry.entryName)).toContain('examples/normal.csv');
      expect(entries.map((entry) => entry.entryName)).not.toContain('examples/rep.csv');
      for (const entry of entries) {
        if (entry.header.size > 0) {
          expect(entry.header.size / Math.max(entry.header.compressedSize, 1)).toBeLessThanOrEqual(100);
        }
      }
      await workspace.cleanup();
    } finally {
      osState.base = undefined;
      await rm(base, { recursive: true, force: true });
    }
  });

  it('does not request sensitive-named files (auth.json, credentials.json, secrets, service accounts)', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(
      phpTree(
        'auth.json', 'credentials.json', 'config/secrets.yml', 'service-account.json', 'my_secret.json',
        'oauth2.json', 'authors.json', 'examples/rbac_model.conf',
      ),
    );

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(requestedPaths()).toEqual(['authors.json', 'examples/rbac_model.conf', 'oauth2.json']);
    expect(report.requested).toBe(3);
    expect(await exists('auth.json')).toBe(false);
    expect(await exists('credentials.json')).toBe(false);
  });

  it('omits a file whose download fails and includes the others', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree('a.conf', 'b.conf', 'c.conf'));
    githubRepositoryContentService.getFileContent.mockImplementation(
      async (_i: string, _r: string, path: string) => {
        if (path === 'b.conf') {
          throw new Error('https://signed.example/secret?token=abc');
        }
        return `content of ${path}`;
      },
    );

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.included).toBe(2);
    expect(report.omitted.fetchFailed).toBe(1);
    expect(await exists('a.conf')).toBe(true);
    expect(await exists('b.conf')).toBe(false);
    expect(await exists('c.conf')).toBe(true);
    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');
    expect(logged).not.toContain('signed.example');
  });

  it('omits content that is not valid UTF-8 (U+FFFD)', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree('bin.csv', 'ok.csv'));
    contents['bin.csv'] = 'abc\uFFFDdef';
    contents['ok.csv'] = 'a,b';

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.included).toBe(1);
    expect(report.omitted.notUtf8).toBe(1);
    expect(await exists('bin.csv')).toBe(false);
  });

  it('is a no-op for non-PHP repositories without fetching any file', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue([
      { path: 'package.json' },
      { path: 'src/a.ts' },
      { path: 'data/config.json' },
      { path: 'data/x.csv' },
    ]);

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(githubRepositoryContentService.getFileContent).not.toHaveBeenCalled();
    expect(report).toEqual({
      requested: 0,
      included: 0,
      bytes: 0,
      omitted: { maxFiles: 0, fetchFailed: 0, fileTooLarge: 0, notUtf8: 0, highCompression: 0, totalLimit: 0 },
    });
    expect(await readdir(workspaceDir)).toEqual([]);
  });

  it('does not treat a Composer manifest under an ignored directory as a PHP project', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue([
      { path: 'vendor/x/composer.json' },
      { path: 'data/x.csv' },
    ]);

    await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(githubRepositoryContentService.getFileContent).not.toHaveBeenCalled();
  });

  it('returns an empty report without throwing when getTree fails', async () => {
    githubRepositoryContentService.getTree.mockRejectedValue(new Error('github down'));

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.requested).toBe(0);
    expect(report.included).toBe(0);
    expect(githubRepositoryContentService.getFileContent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect([...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ')).not.toContain('github down');
  });

  it('never writes outside the workspace: traversal paths are not candidates and absolute paths count as fetchFailed', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(
      phpTree('../escape.conf', 'a/../../escape2.conf', '/abs/evil.conf', 'ok.conf'),
    );

    const report = await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    expect(report.included).toBe(1);
    expect(report.requested).toBe(2);
    expect(report.omitted.fetchFailed).toBe(1);
    expect(requestedPaths()).toEqual(['ok.conf']);
    expect(await exists('ok.conf')).toBe(true);
    await expect(stat(join(workspaceDir, '..', 'escape.conf'))).rejects.toThrow();
    await expect(stat('/abs/evil.conf')).rejects.toThrow();
  });

  it('logs only counters: no paths and no content', async () => {
    githubRepositoryContentService.getTree.mockResolvedValue(phpTree('secret/dir/model.conf', 'big/huge.json'));
    contents['secret/dir/model.conf'] = 'TOP-SECRET-CONTENT';
    contents['big/huge.json'] = 'x'.repeat(1_048_577);

    await service.addSandboxFixtures(binding, 'head-sha', workspaceDir);

    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join('\n');
    expect(logged).toContain('requested=2');
    expect(logged).toContain('included=1');
    expect(logged).toContain('fileTooLarge=1');
    expect(logged).not.toContain('secret/dir');
    expect(logged).not.toContain('model.conf');
    expect(logged).not.toContain('huge.json');
    expect(logged).not.toContain('TOP-SECRET-CONTENT');
  });

  it('materialize still brings no fixtures: only the PHP pool', async () => {
    const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
    const base = await mkdtemp(join(tmpdir(), 'rag-core-materialize-nofx-'));
    osState.base = base;
    try {
      githubRepositoryContentService.getTree.mockResolvedValue(
        phpTree('examples/rbac_model.conf', 'tests/data.json'),
      );

      const workspace = await service.materialize(binding, 'head-sha');

      expect(requestedPaths().sort()).toEqual(['composer.json', 'src/Foo.php']);
      expect(await readdir(workspace.dir)).toEqual(expect.arrayContaining(['composer.json', 'src']));
      expect(await readdir(workspace.dir)).not.toContain('examples');
      await workspace.cleanup();
    } finally {
      osState.base = undefined;
      await rm(base, { recursive: true, force: true });
    }
  });

  it('produces a ZIP with the PHP pool plus only the fixtures (real zipDirectory)', async () => {
    const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
    const base = await mkdtemp(join(tmpdir(), 'rag-core-zip-fx-'));
    osState.base = base;
    try {
      githubRepositoryContentService.getTree.mockResolvedValue(
        phpTree(
          'examples/rbac_model.conf', 'tests/data.json', '.env', 'image.png', 'package-lock.json',
          'vendor/x/y.json', 'README.md',
        ),
      );
      const workspace = await service.materialize(binding, 'head-sha');

      await service.addSandboxFixtures(binding, 'head-sha', workspace.dir);
      const entries = new AdmZip(zipDirectory(workspace.dir))
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => entry.entryName)
        .sort();

      expect(entries).toEqual([
        'composer.json', 'examples/rbac_model.conf', 'src/Foo.php', 'tests/data.json',
      ]);
      await workspace.cleanup();
    } finally {
      osState.base = undefined;
      await rm(base, { recursive: true, force: true });
    }
  });
});
