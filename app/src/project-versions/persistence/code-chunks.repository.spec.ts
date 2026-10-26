import { describe, expect, it, vi } from 'vitest';
import { CodeChunksRepository, PhpDeclarationQueryLimitError } from './code-chunks.repository.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('CodeChunksRepository.findBySymbol', () => {
  function makeRepository() {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { codeChunk: { findMany } };
    return { findMany, repository: new CodeChunksRepository(prisma as unknown as PrismaService) };
  }

  it('filters symbolKind by equality when a single kind is given', async () => {
    const { findMany, repository } = makeRepository();

    await repository.findBySymbol('version-1', 'src/foo.ts', 'FUNCTION', 'foo', null);

    expect(findMany).toHaveBeenCalledWith({
      where: { projectVersionId: 'version-1', filePath: 'src/foo.ts', symbolKind: 'FUNCTION', symbolName: 'foo', parentSymbolName: null },
      orderBy: { partIndex: 'asc' },
    });
  });

  it('filters symbolKind with IN when a list of kinds is given', async () => {
    const { findMany, repository } = makeRepository();

    await repository.findBySymbol('version-1', 'src/Greeter.php', ['METHOD', 'CONSTRUCTOR'], 'greet', 'Greeter');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectVersionId: 'version-1',
        filePath: 'src/Greeter.php',
        symbolKind: { in: ['METHOD', 'CONSTRUCTOR'] },
        symbolName: 'greet',
        parentSymbolName: 'Greeter',
      },
      orderBy: { partIndex: 'asc' },
    });
  });
});

describe('CodeChunksRepository.findByFile', () => {
  it('selects the minimal fields for one file ordered by partIndex', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new CodeChunksRepository({ codeChunk: { findMany } } as unknown as PrismaService);

    await repository.findByFile('version-1', 'src/Services/RenewalService.php');

    expect(findMany).toHaveBeenCalledWith({
      where: { projectVersionId: 'version-1', filePath: 'src/Services/RenewalService.php' },
      select: { filePath: true, symbolKind: true, symbolName: true, parentSymbolName: true, importsUsed: true, content: true },
      orderBy: { partIndex: 'asc' },
    });
  });
});

describe('CodeChunksRepository.findPhpTypeSymbolNames', () => {
  it('returns unique PHP type symbol names', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { symbolName: 'Pilot\\A' },
      { symbolName: 'Pilot\\A' },
      { symbolName: null },
      { symbolName: 'Pilot\\B' },
    ]);
    const repository = new CodeChunksRepository({ codeChunk: { findMany } } as unknown as PrismaService);

    await expect(repository.findPhpTypeSymbolNames('version-1')).resolves.toEqual(['Pilot\\A', 'Pilot\\B']);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectVersionId: 'version-1',
        symbolKind: { in: ['CLASS', 'INTERFACE', 'TRAIT', 'ENUM'] },
        filePath: { endsWith: '.php' },
      },
      select: { symbolName: true },
    });
  });
});

describe('CodeChunksRepository.findPhpTypeDeclarations (WI-CORE-058)', () => {
  function makeRepository(rows: unknown[] = []) {
    const findMany = vi.fn().mockResolvedValue(rows);
    const repository = new CodeChunksRepository({ codeChunk: { findMany } } as unknown as PrismaService);
    return { findMany, repository };
  }

  it('does not query when the symbol list is empty', async () => {
    const { findMany, repository } = makeRepository();

    await expect(repository.findPhpTypeDeclarations('version-1', [])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('queries only part 1 of PHP type chunks for the given unique names, in deterministic order', async () => {
    const { findMany, repository } = makeRepository();

    await repository.findPhpTypeDeclarations('version-1', ['Pilot\\A', 'Pilot\\A', 'Pilot\\B']);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectVersionId: 'version-1',
        symbolKind: { in: ['CLASS', 'INTERFACE', 'TRAIT', 'ENUM'] },
        symbolName: { in: ['Pilot\\A', 'Pilot\\B'] },
        filePath: { endsWith: '.php' },
        partIndex: 1,
      },
      select: { symbolName: true, symbolKind: true, content: true, partIndex: true },
      orderBy: [{ symbolName: 'asc' }, { filePath: 'asc' }, { partIndex: 'asc' }],
    });
  });

  it('returns one declaration per name with the content of its part 1', async () => {
    const { repository } = makeRepository([
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', content: '#[Attr]\nfinal class A {', partIndex: 1 },
      { symbolName: 'Pilot\\B', symbolKind: 'ENUM', content: 'enum B {', partIndex: 1 },
    ]);

    await expect(repository.findPhpTypeDeclarations('version-1', ['Pilot\\A', 'Pilot\\B'])).resolves.toEqual([
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', content: '#[Attr]\nfinal class A {' },
      { symbolName: 'Pilot\\B', symbolKind: 'ENUM', content: 'enum B {' },
    ]);
  });

  it('omits a FQCN declared twice in different files (ambiguous)', async () => {
    const { repository } = makeRepository([
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', content: 'final class A {}', partIndex: 1 },
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', content: 'class A {}', partIndex: 1 },
      { symbolName: 'Pilot\\B', symbolKind: 'CLASS', content: 'final class B {}', partIndex: 1 },
    ]);

    await expect(repository.findPhpTypeDeclarations('version-1', ['Pilot\\A', 'Pilot\\B'])).resolves.toEqual([
      { symbolName: 'Pilot\\B', symbolKind: 'CLASS', content: 'final class B {}' },
    ]);
  });

  it('omits a FQCN declared as class and as interface (ambiguous, not preferred)', async () => {
    const { repository } = makeRepository([
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', content: 'final class A {}', partIndex: 1 },
      { symbolName: 'Pilot\\A', symbolKind: 'INTERFACE', content: 'interface A {}', partIndex: 1 },
    ]);

    await expect(repository.findPhpTypeDeclarations('version-1', ['Pilot\\A'])).resolves.toEqual([]);
  });

  it('ignores non-first parts of a split declaration so they do not count as another declaration', async () => {
    const { repository } = makeRepository([
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', content: 'final class A {', partIndex: 1 },
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', content: 'public function x() {}', partIndex: 2 },
    ]);

    await expect(repository.findPhpTypeDeclarations('version-1', ['Pilot\\A'])).resolves.toEqual([
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', content: 'final class A {' },
    ]);
  });
});

describe('CodeChunksRepository.findPhpConstructorDeclarations (WI-CORE-065)', () => {
  function makeRepository(rows: unknown[] = []) {
    const findMany = vi.fn().mockResolvedValue(rows);
    const repository = new CodeChunksRepository({ codeChunk: { findMany } } as unknown as PrismaService);
    return { findMany, repository };
  }

  it('does not query when the parent list is empty', async () => {
    const { findMany, repository } = makeRepository();

    await expect(repository.findPhpConstructorDeclarations('version-1', [])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('queries only part 1 of PHP CONSTRUCTOR chunks for the unique parents, in deterministic order', async () => {
    const { findMany, repository } = makeRepository();

    await repository.findPhpConstructorDeclarations('version-1', ['Pilot\\A', 'Pilot\\A', 'Pilot\\B']);

    expect(findMany.mock.calls[0][0].where).toEqual({
      projectVersionId: 'version-1',
      symbolKind: 'CONSTRUCTOR',
      parentSymbolName: { in: ['Pilot\\A', 'Pilot\\B'] },
      filePath: { endsWith: '.php' },
      partIndex: 1,
    });
    expect(findMany.mock.calls[0][0].select).toMatchObject({ content: true, importsUsed: true });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { parentSymbolName: 'asc' },
      { filePath: 'asc' },
      { partIndex: 'asc' },
    ]);
  });

  it('returns one constructor per parent and omits parents declared in different files (ambiguous)', async () => {
    const { repository } = makeRepository([
      { parentSymbolName: 'Pilot\\A', filePath: 'src/A.php', content: 'public function __construct(int $a) {}', importsUsed: [], partIndex: 1 },
      { parentSymbolName: 'Pilot\\A', filePath: 'src/Other/A.php', content: 'public function __construct() {}', importsUsed: [], partIndex: 1 },
      { parentSymbolName: 'Pilot\\B', filePath: 'src/B.php', content: 'public function __construct(string $b) {}', importsUsed: [], partIndex: 1 },
    ]);

    await expect(repository.findPhpConstructorDeclarations('version-1', ['Pilot\\A', 'Pilot\\B'])).resolves.toEqual([
      { parentSymbolName: 'Pilot\\B', content: 'public function __construct(string $b) {}', importsUsed: [] },
    ]);
  });

  it('ignores non-first parts so they do not count as another constructor', async () => {
    const { repository } = makeRepository([
      { parentSymbolName: 'Pilot\\A', filePath: 'src/A.php', content: 'public function __construct(int $a', importsUsed: [], partIndex: 1 },
      { parentSymbolName: 'Pilot\\A', filePath: 'src/A.php', content: '{}) {}', importsUsed: [], partIndex: 2 },
    ]);

    await expect(repository.findPhpConstructorDeclarations('version-1', ['Pilot\\A'])).resolves.toEqual([
      { parentSymbolName: 'Pilot\\A', content: 'public function __construct(int $a', importsUsed: [] },
    ]);
  });
});

describe('CodeChunksRepository.findPhpStaticMethodDeclarations (WI-CORE-104)', () => {
  function makeRepository(rows: unknown[] = []) {
    const findMany = vi.fn().mockResolvedValue(rows);
    const repository = new CodeChunksRepository({ codeChunk: { findMany } } as unknown as PrismaService);
    return { findMany, repository };
  }

  it('does not query when the class list is empty', async () => {
    const { findMany, repository } = makeRepository();

    await expect(repository.findPhpStaticMethodDeclarations('version-1', [])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('is a read-only query of part 1 of PHP METHOD chunks that mention static, in deterministic order and bounded', async () => {
    const { findMany, repository } = makeRepository();

    await repository.findPhpStaticMethodDeclarations('version-1', ['Pilot\\A', 'Pilot\\A', 'Pilot\\B']);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      projectVersionId: 'version-1',
      symbolKind: 'METHOD',
      parentSymbolName: { in: ['Pilot\\A', 'Pilot\\B'] },
      filePath: { endsWith: '.php' },
      partIndex: 1,
      content: { contains: 'static' },
    });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { parentSymbolName: 'asc' },
      { symbolName: 'asc' },
      { filePath: 'asc' },
    ]);
    expect(findMany.mock.calls[0][0].take).toBe(400);
  });

  it('returns parent, method name and content, skipping rows without parent', async () => {
    const { repository } = makeRepository([
      { parentSymbolName: 'Pilot\\A', symbolName: 'Pilot\\A::of', filePath: 'src/A.php', content: 'public static function of(): static {}' },
      { parentSymbolName: null, symbolName: 'helper', filePath: 'src/h.php', content: 'static function helper() {}' },
    ]);

    await expect(repository.findPhpStaticMethodDeclarations('version-1', ['Pilot\\A'])).resolves.toEqual([
      { parentSymbolName: 'Pilot\\A', symbolName: 'Pilot\\A::of', content: 'public static function of(): static {}' },
    ]);
  });
});

describe('CodeChunksRepository.findPhpTypeDeclarationParts (WI-CORE-106)', () => {
  function makeRepository(rows: unknown[] = []) {
    const findMany = vi.fn().mockResolvedValue(rows);
    const repository = new CodeChunksRepository({ codeChunk: { findMany } } as unknown as PrismaService);
    return { findMany, repository };
  }

  const row = (overrides: Record<string, unknown>) => ({
    symbolName: 'Pilot\\A',
    symbolKind: 'CLASS',
    filePath: 'src/A.php',
    partIndex: 1,
    content: 'abstract class A {',
    importsUsed: [],
    ...overrides,
  });

  it('does not query when the symbol list is empty', async () => {
    const { findMany, repository } = makeRepository();

    await expect(repository.findPhpTypeDeclarationParts('version-1', [])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('is a bounded read-only query of all parts of PHP type chunks of one version, for the unique names', async () => {
    const { findMany, repository } = makeRepository();

    await repository.findPhpTypeDeclarationParts('version-1', ['Pilot\\A', 'Pilot\\A', 'Pilot\\B']);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      projectVersionId: 'version-1',
      symbolKind: { in: ['CLASS', 'INTERFACE', 'TRAIT', 'ENUM'] },
      symbolName: { in: ['Pilot\\A', 'Pilot\\B'] },
      filePath: { endsWith: '.php' },
    });
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('partIndex');
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ symbolName: 'asc' }, { filePath: 'asc' }, { partIndex: 'asc' }]);
    expect(findMany.mock.calls[0][0].take).toBe(400);
  });

  it('returns the parts of each symbol ordered by partIndex even if the rows arrive out of order', async () => {
    const { repository } = makeRepository([
      row({ partIndex: 3, content: 'third' }),
      row({ partIndex: 1, content: 'first', importsUsed: ['Pilot\\Dep'] }),
      row({ partIndex: 2, content: 'second' }),
      row({ symbolName: 'Pilot\\B', symbolKind: 'INTERFACE', filePath: 'src/B.php', content: 'interface B {' }),
    ]);

    await expect(repository.findPhpTypeDeclarationParts('version-1', ['Pilot\\A', 'Pilot\\B'])).resolves.toEqual([
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', partIndex: 1, content: 'first', importsUsed: ['Pilot\\Dep'] },
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', partIndex: 2, content: 'second', importsUsed: [] },
      { symbolName: 'Pilot\\A', symbolKind: 'CLASS', partIndex: 3, content: 'third', importsUsed: [] },
      { symbolName: 'Pilot\\B', symbolKind: 'INTERFACE', partIndex: 1, content: 'interface B {', importsUsed: [] },
    ]);
  });

  it('omits a symbol declared in two different files (ambiguous) and keeps the others', async () => {
    const { repository } = makeRepository([
      row({ filePath: 'src/A.php' }),
      row({ filePath: 'src/Other/A.php' }),
      row({ symbolName: 'Pilot\\B', filePath: 'src/B.php', content: 'class B {' }),
    ]);

    const parts = await repository.findPhpTypeDeclarationParts('version-1', ['Pilot\\A', 'Pilot\\B']);

    expect(parts.map((part) => part.symbolName)).toEqual(['Pilot\\B']);
  });

  it('omits a symbol declared with two different kinds even in the same file (ambiguous)', async () => {
    const { repository } = makeRepository([
      row({ symbolKind: 'CLASS' }),
      row({ symbolKind: 'INTERFACE' }),
      row({ symbolName: 'Pilot\\B', filePath: 'src/B.php' }),
    ]);

    const parts = await repository.findPhpTypeDeclarationParts('version-1', ['Pilot\\A', 'Pilot\\B']);

    expect(parts.map((part) => part.symbolName)).toEqual(['Pilot\\B']);
  });

  it('skips rows without symbolName', async () => {
    const { repository } = makeRepository([row({ symbolName: null })]);

    await expect(repository.findPhpTypeDeclarationParts('version-1', ['Pilot\\A'])).resolves.toEqual([]);
  });

  it('throws PhpDeclarationQueryLimitError when the query reaches its row limit (possibly incomplete)', async () => {
    const { repository } = makeRepository([row({ partIndex: 1 }), row({ partIndex: 2 })]);

    await expect(repository.findPhpTypeDeclarationParts('version-1', ['Pilot\\A'], 2)).rejects.toBeInstanceOf(PhpDeclarationQueryLimitError);
    await expect(repository.findPhpTypeDeclarationParts('version-1', ['Pilot\\A'], 3)).resolves.toHaveLength(2);
  });
});

describe('CodeChunksRepository.findPhpMethodDeclarations (WI-CORE-106)', () => {
  function makeRepository(rows: unknown[] = []) {
    const findMany = vi.fn().mockResolvedValue(rows);
    const repository = new CodeChunksRepository({ codeChunk: { findMany } } as unknown as PrismaService);
    return { findMany, repository };
  }

  const row = (overrides: Record<string, unknown>) => ({
    parentSymbolName: 'Pilot\\A',
    symbolName: 'Pilot\\A::run',
    filePath: 'src/A.php',
    content: 'public function run(): void {}',
    ...overrides,
  });

  it('does not query when the class list is empty', async () => {
    const { findMany, repository } = makeRepository();

    await expect(repository.findPhpMethodDeclarations('version-1', [])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('is a bounded read-only query of part 1 of PHP METHOD and CONSTRUCTOR chunks of one version', async () => {
    const { findMany, repository } = makeRepository();

    await repository.findPhpMethodDeclarations('version-1', ['Pilot\\A', 'Pilot\\A', 'Pilot\\B']);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      projectVersionId: 'version-1',
      symbolKind: { in: ['METHOD', 'CONSTRUCTOR'] },
      parentSymbolName: { in: ['Pilot\\A', 'Pilot\\B'] },
      filePath: { endsWith: '.php' },
      partIndex: 1,
    });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ parentSymbolName: 'asc' }, { filePath: 'asc' }, { symbolName: 'asc' }]);
    expect(findMany.mock.calls[0][0].take).toBe(600);
  });

  it('returns parent, method name and content, skipping rows without parent', async () => {
    const { repository } = makeRepository([
      row({}),
      row({ symbolName: 'Pilot\\A::stop', content: 'protected function stop(): void {}' }),
      row({ parentSymbolName: null, symbolName: 'helper' }),
    ]);

    await expect(repository.findPhpMethodDeclarations('version-1', ['Pilot\\A'])).resolves.toEqual([
      { parentSymbolName: 'Pilot\\A', symbolName: 'Pilot\\A::run', content: 'public function run(): void {}' },
      { parentSymbolName: 'Pilot\\A', symbolName: 'Pilot\\A::stop', content: 'protected function stop(): void {}' },
    ]);
  });

  it('omits a parent whose methods come from two different files (ambiguous) and keeps the others', async () => {
    const { repository } = makeRepository([
      row({ filePath: 'src/A.php' }),
      row({ filePath: 'src/Other/A.php', symbolName: 'Pilot\\A::other' }),
      row({ parentSymbolName: 'Pilot\\B', symbolName: 'Pilot\\B::run', filePath: 'src/B.php' }),
    ]);

    const methods = await repository.findPhpMethodDeclarations('version-1', ['Pilot\\A', 'Pilot\\B']);

    expect(methods.map((method) => method.parentSymbolName)).toEqual(['Pilot\\B']);
  });

  it('throws PhpDeclarationQueryLimitError when the query reaches its row limit (possibly incomplete)', async () => {
    const { repository } = makeRepository([row({}), row({ symbolName: 'Pilot\\A::stop' })]);

    await expect(repository.findPhpMethodDeclarations('version-1', ['Pilot\\A'], 2)).rejects.toBeInstanceOf(PhpDeclarationQueryLimitError);
    await expect(repository.findPhpMethodDeclarations('version-1', ['Pilot\\A'], 3)).resolves.toHaveLength(2);
  });
});
