import { describe, expect, it, vi } from 'vitest';
import { CodeChunksRepository } from './code-chunks.repository.js';
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
