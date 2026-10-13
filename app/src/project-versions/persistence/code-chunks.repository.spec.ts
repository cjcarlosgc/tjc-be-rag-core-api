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
