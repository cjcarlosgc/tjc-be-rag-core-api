import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { SymbolBehaviorConstructsService, type BehaviorSymbolCandidate } from './symbol-behavior-constructs.service.js';
import type { CompareFile, GithubRepositoryContentService } from '../github-app/github-repository-content.service.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

const WORKSPACE = '/work/head';
const INSTALLATION_ID = '999';
const REPOSITORY = 'org/repo';
const BASE_SHA = 'base-sha';

const BASE_WITHOUT_BRANCH = `
class Account {
  withdraw(amount: number): number {
    return amount;
  }
}
`;

const HEAD_WITH_BRANCH = `
class Account {
  withdraw(amount: number): number {
    if (amount <= 0) {
      throw new Error('invalid');
    }
    return amount;
  }
}
`;

const PHP_PATH = 'src/Billing/Account.php';
const PHP_QUALIFIED_NAME = 'App\\Billing\\Account.withdraw';

const PHP_BASE_WITHOUT_BRANCH = `<?php
namespace App\\Billing;
class Account {
  public function withdraw(int $amount): int {
    return $amount;
  }
}
`;

const PHP_HEAD_WITH_BRANCH = `<?php
namespace App\\Billing;
class Account {
  public function withdraw(int $amount): int {
    if ($amount <= 0) {
      throw new DomainError('invalid');
    }
    return $amount;
  }
}
`;

function symbol(overrides: Partial<BehaviorSymbolCandidate> = {}): BehaviorSymbolCandidate {
  return {
    language: 'TYPESCRIPT',
    kind: 'METHOD',
    changeKind: 'DIRECTLY_CHANGED',
    filePath: 'src/account.ts',
    qualifiedName: 'Account.withdraw',
    ...overrides,
  };
}

describe('SymbolBehaviorConstructsService', () => {
  let service: SymbolBehaviorConstructsService;
  let getFileContent: ReturnType<typeof vi.fn>;
  let headFiles: Record<string, string>;

  function request(changesetFiles: CompareFile[] = [{ filename: 'src/account.ts', status: 'modified' }]) {
    return {
      workspaceDir: WORKSPACE,
      installationId: INSTALLATION_ID,
      repositoryName: REPOSITORY,
      baseSha: BASE_SHA,
      changesetFiles,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    headFiles = {};
    vi.mocked(readFile).mockImplementation((async (path: unknown) => {
      const content = headFiles[String(path)];
      if (content === undefined) {
        throw new Error(`ENOENT ${String(path)}`);
      }
      return content;
    }) as never);

    getFileContent = vi.fn().mockResolvedValue(BASE_WITHOUT_BRANCH);
    service = new SymbolBehaviorConstructsService({
      getFileContent,
    } as unknown as GithubRepositoryContentService);
  });

  it('reports the new branch and throw of a modified method, with keys derived from the HEAD target', async () => {
    headFiles[join(WORKSPACE, 'src/account.ts')] = HEAD_WITH_BRANCH;

    const [constructs] = await service.compute(request(), [symbol()]);

    expect(getFileContent).toHaveBeenCalledTimes(1);
    expect(getFileContent).toHaveBeenCalledWith(INSTALLATION_ID, REPOSITORY, 'src/account.ts', BASE_SHA);
    expect(constructs).toEqual([
      {
        scenarioKind: 'BOUNDARY',
        scenarioKey: expect.stringMatching(/^BOUNDARY:[0-9a-f]{16}$/),
        order: 0,
        snippet: 'if (amount <= 0)',
      },
      {
        scenarioKind: 'EXCEPTION',
        scenarioKey: expect.stringMatching(/^EXCEPTION:[0-9a-f]{16}$/),
        order: 1,
        snippet: "throw new Error('invalid');",
      },
    ]);
  });

  it('reports only the constructs that are new or modified, not those already in the base', async () => {
    getFileContent.mockResolvedValue(HEAD_WITH_BRANCH);
    headFiles[join(WORKSPACE, 'src/account.ts')] = `
class Account {
  withdraw(amount: number): number {
    if (amount <= 0) {
      throw new Error('invalid');
    }
    if (amount > 100) {
      return 100;
    }
    return amount;
  }
}
`;

    const [constructs] = await service.compute(request(), [symbol()]);

    expect(constructs).toEqual([
      expect.objectContaining({ scenarioKind: 'BOUNDARY', snippet: 'if (amount > 100)', order: 2 }),
    ]);
  });

  it('reports nothing for a cosmetic change that keeps the same behavioral constructs', async () => {
    getFileContent.mockResolvedValue(HEAD_WITH_BRANCH);
    headFiles[join(WORKSPACE, 'src/account.ts')] = `
class Account {
  // reformatted without behavior change
  withdraw(  amount: number ): number {
    if (amount<=0) { throw new Error('invalid'); }
    return amount;
  }
}
`;

    const [constructs] = await service.compute(request(), [symbol()]);

    expect(constructs).toEqual([]);
  });

  it('uses the previous filename as base path for a renamed file', async () => {
    headFiles[join(WORKSPACE, 'src/new-account.ts')] = HEAD_WITH_BRANCH;

    const [constructs] = await service.compute(
      request([{ filename: 'src/new-account.ts', status: 'renamed', previousFilename: 'src/account.ts' }]),
      [symbol({ filePath: 'src/new-account.ts' })],
    );

    expect(getFileContent).toHaveBeenCalledWith(INSTALLATION_ID, REPOSITORY, 'src/account.ts', BASE_SHA);
    expect(constructs).toHaveLength(2);
    expect(constructs?.[0]?.scenarioKey).toMatch(/^BOUNDARY:/);
  });

  it('treats every construct as new for an added file without fetching a base', async () => {
    headFiles[join(WORKSPACE, 'src/account.ts')] = HEAD_WITH_BRANCH;

    const [constructs] = await service.compute(
      request([{ filename: 'src/account.ts', status: 'added' }]),
      [symbol()],
    );

    expect(getFileContent).not.toHaveBeenCalled();
    expect(constructs).toHaveLength(2);
  });

  it('treats the whole HEAD symbol as new when the symbol does not exist in the base', async () => {
    getFileContent.mockResolvedValue('class Account {\n  deposit(value: number) { return value; }\n}\n');
    headFiles[join(WORKSPACE, 'src/account.ts')] = HEAD_WITH_BRANCH;

    const [constructs] = await service.compute(request(), [symbol()]);

    expect(constructs).toHaveLength(2);
  });

  it('propagates GitHub errors when the base content cannot be read', async () => {
    getFileContent.mockRejectedValue(new Error('GitHub Integration no está disponible.'));
    headFiles[join(WORKSPACE, 'src/account.ts')] = HEAD_WITH_BRANCH;

    await expect(service.compute(request(), [symbol()])).rejects.toThrow('GitHub Integration no está disponible.');
  });

  it('makes one GitHub call per changed file even when it holds several symbols', async () => {
    headFiles[join(WORKSPACE, 'src/account.ts')] = `
class Account {
  withdraw(amount: number): number {
    if (amount <= 0) { throw new Error('invalid'); }
    return amount;
  }
  deposit(amount: number): number {
    if (amount < 0) { throw new Error('negative'); }
    return amount;
  }
}
`;

    const results = await service.compute(request(), [
      symbol(),
      symbol({ qualifiedName: 'Account.deposit' }),
    ]);

    expect(getFileContent).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0]?.length).toBeGreaterThan(0);
    expect(results[1]?.length).toBeGreaterThan(0);
  });

  it('returns a construct list for a top-level FUNCTION symbol', async () => {
    getFileContent.mockResolvedValue('export function parse(value: number) { return value; }\n');
    headFiles[join(WORKSPACE, 'src/parser.ts')] = `
export function parse(value: number) {
  if (value < 0) {
    return 0;
  }
  return value;
}
`;

    const [constructs] = await service.compute(
      request([{ filename: 'src/parser.ts', status: 'modified' }]),
      [symbol({ kind: 'FUNCTION', filePath: 'src/parser.ts', qualifiedName: 'parse' })],
    );

    expect(constructs).toEqual([expect.objectContaining({ scenarioKind: 'BOUNDARY', order: 0 })]);
  });

  it('returns an empty list when the HEAD file does not parse', async () => {
    headFiles[join(WORKSPACE, 'src/account.ts')] = 'class Account { withdraw( {';

    const [constructs] = await service.compute(request(), [symbol()]);

    expect(constructs).toEqual([]);
  });

  it.each([
    ['a PHP symbol that is not DIRECTLY_CHANGED', symbol({ language: 'PHP', changeKind: 'POTENTIALLY_IMPACTED', filePath: PHP_PATH, qualifiedName: PHP_QUALIFIED_NAME })],
    ['a CLASS symbol', symbol({ kind: 'CLASS' })],
    ['a potentially impacted symbol', symbol({ changeKind: 'POTENTIALLY_IMPACTED' })],
  ])('returns null without any I/O for %s', async (_label, candidate) => {
    const [constructs] = await service.compute(request(), [candidate]);

    expect(constructs).toBeNull();
    expect(getFileContent).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('reports the new branch and throw of a modified PHP method, with scenarioKey', async () => {
    getFileContent.mockResolvedValue(PHP_BASE_WITHOUT_BRANCH);
    headFiles[join(WORKSPACE, PHP_PATH)] = PHP_HEAD_WITH_BRANCH;

    const [constructs] = await service.compute(
      request([{ filename: PHP_PATH, status: 'modified' }]),
      [symbol({ language: 'PHP', filePath: PHP_PATH, qualifiedName: PHP_QUALIFIED_NAME })],
    );

    expect(getFileContent).toHaveBeenCalledWith(INSTALLATION_ID, REPOSITORY, PHP_PATH, BASE_SHA);
    expect(constructs).toEqual([
      {
        scenarioKind: 'BOUNDARY',
        scenarioKey: expect.stringMatching(/^BOUNDARY:[0-9a-f]{16}$/),
        order: 0,
        snippet: 'if ($amount <= 0)',
      },
      {
        scenarioKind: 'EXCEPTION',
        scenarioKey: expect.stringMatching(/^EXCEPTION:[0-9a-f]{16}$/),
        order: 1,
        snippet: expect.stringContaining("throw new DomainError('invalid')"),
      },
    ]);
  });

  it('treats every PHP construct of an added file as new without fetching a base', async () => {
    headFiles[join(WORKSPACE, PHP_PATH)] = PHP_HEAD_WITH_BRANCH;

    const [constructs] = await service.compute(
      request([{ filename: PHP_PATH, status: 'added' }]),
      [symbol({ language: 'PHP', filePath: PHP_PATH, qualifiedName: PHP_QUALIFIED_NAME })],
    );

    expect(getFileContent).not.toHaveBeenCalled();
    expect(constructs?.map((construct) => construct.scenarioKind)).toEqual(['BOUNDARY', 'EXCEPTION']);
  });

  it('keeps the input order and returns null only for the symbols that do not qualify', async () => {
    headFiles[join(WORKSPACE, 'src/account.ts')] = HEAD_WITH_BRANCH;

    const results = await service.compute(request(), [
      symbol({ kind: 'CLASS', qualifiedName: 'Account' }),
      symbol(),
    ]);

    expect(results[0]).toBeNull();
    expect(results[1]).toHaveLength(2);
  });
});

describe('SymbolBehaviorConstructsService con PHP en monorepo (WI-CORE-052)', () => {
  const MONOREPO_PATH = 'backend/src/OrderLine.php';
  const MONOREPO_QUALIFIED_NAME = 'App\\OrderLine.discount';
  const BASE_PHP = `<?php
namespace App;
class OrderLine {
  public function discount(int $qty): string {
    return 'none';
  }
}
`;
  const HEAD_PHP = `<?php
namespace App;
class OrderLine {
  public function discount(int $qty): string {
    if ($qty >= 10) {
      return 'bulk';
    }
    return 'none';
  }
}
`;
  let actualFs: typeof import('node:fs/promises');
  let workspace: string;
  let getFileContent: ReturnType<typeof vi.fn>;
  let service: SymbolBehaviorConstructsService;

  beforeAll(async () => {
    actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    workspace = await actualFs.mkdtemp(join(tmpdir(), 'behavior-constructs-monorepo-'));
    await actualFs.mkdir(join(workspace, 'backend/src'), { recursive: true });
    await actualFs.writeFile(join(workspace, MONOREPO_PATH), HEAD_PHP, 'utf8');
  });

  afterAll(async () => {
    await actualFs.rm(workspace, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockImplementation(((path: unknown, encoding: unknown) =>
      actualFs.readFile(String(path), encoding as BufferEncoding)) as never);
    getFileContent = vi.fn().mockResolvedValue(BASE_PHP);
    service = new SymbolBehaviorConstructsService({
      getFileContent,
    } as unknown as GithubRepositoryContentService);
  });

  function phpSymbol(): BehaviorSymbolCandidate {
    return {
      language: 'PHP',
      kind: 'METHOD',
      changeKind: 'DIRECTLY_CHANGED',
      filePath: MONOREPO_PATH,
      qualifiedName: MONOREPO_QUALIFIED_NAME,
    };
  }

  const modified: CompareFile[] = [{ filename: MONOREPO_PATH, status: 'modified' }];

  it('lee el archivo del HEAD bajo projectRoot, pide la base con esa ruta y devuelve la construccion nueva', async () => {
    const [constructs] = await service.compute(
      { workspaceDir: workspace, installationId: INSTALLATION_ID, repositoryName: REPOSITORY, baseSha: BASE_SHA, changesetFiles: modified },
      [phpSymbol()],
    );

    expect(getFileContent).toHaveBeenCalledWith(INSTALLATION_ID, REPOSITORY, MONOREPO_PATH, BASE_SHA);
    expect(constructs).toEqual([
      {
        scenarioKind: 'BOUNDARY',
        scenarioKey: expect.stringMatching(/^BOUNDARY:[0-9a-f]{16}$/),
        order: 0,
        snippet: 'if ($qty >= 10)',
      },
    ]);
  });

  it('devuelve [] cuando la base ya tiene las mismas construcciones', async () => {
    getFileContent.mockResolvedValue(HEAD_PHP);

    const [constructs] = await service.compute(
      { workspaceDir: workspace, installationId: INSTALLATION_ID, repositoryName: REPOSITORY, baseSha: BASE_SHA, changesetFiles: modified },
      [phpSymbol()],
    );

    expect(constructs).toEqual([]);
  });

  it('trata todo el cuerpo como nuevo cuando la base no se encuentra (getFileContent null)', async () => {
    getFileContent.mockResolvedValue(null);

    const [constructs] = await service.compute(
      { workspaceDir: workspace, installationId: INSTALLATION_ID, repositoryName: REPOSITORY, baseSha: BASE_SHA, changesetFiles: modified },
      [phpSymbol()],
    );

    expect(constructs).toEqual([expect.objectContaining({ scenarioKind: 'BOUNDARY', snippet: 'if ($qty >= 10)' })]);
  });

  it('un archivo added no consulta GitHub y todo el cuerpo cuenta como nuevo', async () => {
    const [constructs] = await service.compute(
      { workspaceDir: workspace, installationId: INSTALLATION_ID, repositoryName: REPOSITORY, baseSha: BASE_SHA, changesetFiles: [{ filename: MONOREPO_PATH, status: 'added' }] },
      [phpSymbol()],
    );

    expect(getFileContent).not.toHaveBeenCalled();
    expect(constructs).toEqual([expect.objectContaining({ scenarioKind: 'BOUNDARY' })]);
  });

  it('propaga el error de getFileContent como hoy', async () => {
    getFileContent.mockRejectedValue(new Error('GitHub Integration no está disponible.'));

    await expect(
      service.compute(
        { workspaceDir: workspace, installationId: INSTALLATION_ID, repositoryName: REPOSITORY, baseSha: BASE_SHA, changesetFiles: modified },
        [phpSymbol()],
      ),
    ).rejects.toThrow('GitHub Integration no está disponible.');
  });
});
