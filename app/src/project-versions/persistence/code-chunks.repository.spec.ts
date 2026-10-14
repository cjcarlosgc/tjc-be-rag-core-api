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
