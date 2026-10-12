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
