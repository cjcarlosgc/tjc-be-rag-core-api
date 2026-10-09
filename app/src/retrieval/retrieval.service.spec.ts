import { describe, expect, it, vi } from 'vitest';
import { RetrievalService } from './retrieval.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { CodeChunk } from '../generated/prisma/client.js';

function makeChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id: 'chunk-id',
    projectVersionId: 'version-1',
    filePath: 'src/foo.ts',
    symbolKind: 'FUNCTION',
    symbolName: 'foo',
    parentSymbolName: null,
    startLine: 1,
    endLine: 5,
    content: 'function foo() {}',
    importsUsed: [],
    tokenCount: 10,
    partIndex: 1,
    partsTotal: 1,
    createdAt: new Date(),
    ...overrides,
  } as CodeChunk;
}

describe('RetrievalService', () => {
  it('throws UNRESOLVABLE_TARGET when no chunk matches the requested symbol', async () => {
    const codeChunksRepository = {
      findBySymbol: vi.fn().mockResolvedValue([]),
      findSimilarByEmbedding: vi.fn(),
      findByProjectVersion: vi.fn(),
    };
    const service = new RetrievalService(codeChunksRepository as never);

    await expect(
      service.retrieve('version-1', {
        filePath: 'src/foo.ts',
        symbolName: 'foo',
        methodName: null,
        targetType: 'FUNCTION',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.UNRESOLVABLE_TARGET });
  });

  it('resolves METHOD targets by parentSymbolName and returns semantic candidates', async () => {
    const anchor = makeChunk({
      id: 'anchor',
      symbolKind: 'METHOD',
      symbolName: 'greet',
      parentSymbolName: 'Greeter',
      filePath: 'src/greeter.ts',
    });
    const semanticMatch = makeChunk({ id: 'semantic-1', symbolName: 'other', filePath: 'src/other.ts' });
    const findBySymbol = vi.fn().mockResolvedValue([anchor]);
    const findSimilarByEmbedding = vi
      .fn()
      .mockResolvedValue([{ ...semanticMatch, semanticScore: 0.8 }]);
    const findByProjectVersion = vi.fn().mockResolvedValue([anchor, semanticMatch]);
    const service = new RetrievalService({
      findBySymbol,
      findSimilarByEmbedding,
      findByProjectVersion,
    } as never);

    const result = await service.retrieve('version-1', {
      filePath: 'src/greeter.ts',
      symbolName: 'Greeter',
      methodName: 'greet',
      targetType: 'METHOD',
    });

    expect(findBySymbol).toHaveBeenCalledWith('version-1', 'src/greeter.ts', 'METHOD', 'greet', 'Greeter');
    expect(result.targetChunks).toEqual([anchor]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ semanticScore: 0.8, structuralMatch: null });
  });

  it('marks a chunk imported by the target file as an IMPORTS structural match', async () => {
    const anchor = makeChunk({
      id: 'anchor',
      filePath: 'src/service.ts',
      importsUsed: ['./helper.js'],
    });
    const helperChunk = makeChunk({ id: 'helper', filePath: 'src/helper.ts', symbolName: 'help' });
    const service = new RetrievalService({
      findBySymbol: vi.fn().mockResolvedValue([anchor]),
      findSimilarByEmbedding: vi.fn().mockResolvedValue([]),
      findByProjectVersion: vi.fn().mockResolvedValue([anchor, helperChunk]),
    } as never);

    const result = await service.retrieve('version-1', {
      filePath: 'src/service.ts',
      symbolName: 'foo',
      methodName: null,
      targetType: 'FUNCTION',
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({ chunk: helperChunk, structuralMatch: 'IMPORTS', semanticScore: null }),
    ]);
  });

  it('marks a chunk that imports the target file as an IMPORTED_BY structural match', async () => {
    const anchor = makeChunk({ id: 'anchor', filePath: 'src/helper.ts', symbolName: 'help' });
    const consumerChunk = makeChunk({
      id: 'consumer',
      filePath: 'src/service.ts',
      symbolName: 'foo',
      importsUsed: ['./helper.js'],
    });
    const service = new RetrievalService({
      findBySymbol: vi.fn().mockResolvedValue([anchor]),
      findSimilarByEmbedding: vi.fn().mockResolvedValue([]),
      findByProjectVersion: vi.fn().mockResolvedValue([anchor, consumerChunk]),
    } as never);

    const result = await service.retrieve('version-1', {
      filePath: 'src/helper.ts',
      symbolName: 'help',
      methodName: null,
      targetType: 'FUNCTION',
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({ chunk: consumerChunk, structuralMatch: 'IMPORTED_BY' }),
    ]);
  });

  it('merges a candidate found by both semantic and structural signals into a single entry', async () => {
    const anchor = makeChunk({ id: 'anchor', filePath: 'src/service.ts', importsUsed: ['./helper.js'] });
    const helperChunk = makeChunk({ id: 'helper', filePath: 'src/helper.ts', symbolName: 'help' });
    const service = new RetrievalService({
      findBySymbol: vi.fn().mockResolvedValue([anchor]),
      findSimilarByEmbedding: vi.fn().mockResolvedValue([{ ...helperChunk, semanticScore: 0.6 }]),
      findByProjectVersion: vi.fn().mockResolvedValue([anchor, helperChunk]),
    } as never);

    const result = await service.retrieve('version-1', {
      filePath: 'src/service.ts',
      symbolName: 'foo',
      methodName: null,
      targetType: 'FUNCTION',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ semanticScore: 0.6, structuralMatch: 'IMPORTS' });
  });

  it('excludes sibling parts of an oversized target symbol from its own candidate list', async () => {
    const part1 = makeChunk({ id: 'part-1', symbolName: 'big', partIndex: 1, partsTotal: 2 });
    const part2 = makeChunk({ id: 'part-2', symbolName: 'big', partIndex: 2, partsTotal: 2 });
    const service = new RetrievalService({
      findBySymbol: vi.fn().mockResolvedValue([part1, part2]),
      findSimilarByEmbedding: vi.fn().mockResolvedValue([{ ...part2, semanticScore: 0.99 }]),
      findByProjectVersion: vi.fn().mockResolvedValue([part1, part2]),
    } as never);

    const result = await service.retrieve('version-1', {
      filePath: 'src/foo.ts',
      symbolName: 'big',
      methodName: null,
      targetType: 'FUNCTION',
    });

    expect(result.targetChunks).toEqual([part1, part2]);
    expect(result.candidates).toEqual([]);
  });
});

describe('RetrievalService modes (WI-CORE-022)', () => {
  const anchor = makeChunk({ id: 'anchor', filePath: 'src/service.ts', importsUsed: ['./helper.js'] });
  const helper = makeChunk({ id: 'helper', filePath: 'src/helper.ts', symbolName: 'help' });
  const semanticOther = makeChunk({ id: 'other', filePath: 'src/other.ts', symbolName: 'other' });
  const target = { filePath: 'src/service.ts', symbolName: 'foo', methodName: null, targetType: 'FUNCTION' as const };

  function makeRepository() {
    return {
      findBySymbol: vi.fn().mockResolvedValue([anchor]),
      findSimilarByEmbedding: vi.fn().mockResolvedValue([
        { ...helper, semanticScore: 0.6 },
        { ...semanticOther, semanticScore: 0.9 },
      ]),
      findByProjectVersion: vi.fn().mockResolvedValue([anchor, helper, semanticOther]),
    };
  }

  it('uses SE when no mode is given, with the same candidates as an explicit SE', async () => {
    const defaultRepository = makeRepository();
    const explicitRepository = makeRepository();
    const defaultResult = await new RetrievalService(defaultRepository as never).retrieve('version-1', target);
    const explicitResult = await new RetrievalService(explicitRepository as never).retrieve('version-1', target, 20, 'SE');

    expect(explicitResult).toEqual(defaultResult);
    expect(defaultResult.candidates.map((candidate) => [candidate.chunk.id, candidate.semanticScore, candidate.structuralMatch])).toEqual([
      ['helper', 0.6, 'IMPORTS'],
      ['other', 0.9, null],
    ]);
    expect(defaultRepository.findByProjectVersion).toHaveBeenCalledTimes(1);
  });

  it('SEM returns only semantic candidates with no structural match and does not read project chunks', async () => {
    const repository = makeRepository();
    const result = await new RetrievalService(repository as never).retrieve('version-1', target, 20, 'SEM');

    expect(result.candidates.map((candidate) => [candidate.chunk.id, candidate.semanticScore, candidate.structuralMatch])).toEqual([
      ['helper', 0.6, null],
      ['other', 0.9, null],
    ]);
    expect(repository.findByProjectVersion).not.toHaveBeenCalled();
    expect(repository.findSimilarByEmbedding).toHaveBeenCalledWith('version-1', 'anchor', 20);
  });

  it('SEM semantic candidates equal the semantic subset of SE for the same anchor', async () => {
    const se = await new RetrievalService(makeRepository() as never).retrieve('version-1', target, 20, 'SE');
    const sem = await new RetrievalService(makeRepository() as never).retrieve('version-1', target, 20, 'SEM');
    const semanticSubsetOfSe = se.candidates
      .filter((candidate) => candidate.semanticScore !== null)
      .map((candidate) => candidate.chunk.id)
      .sort();

    expect(sem.candidates.map((candidate) => candidate.chunk.id).sort()).toEqual(semanticSubsetOfSe);
  });

  it('SEM still throws UNRESOLVABLE_TARGET when the symbol has no chunk', async () => {
    const service = new RetrievalService({
      findBySymbol: vi.fn().mockResolvedValue([]),
      findSimilarByEmbedding: vi.fn(),
      findByProjectVersion: vi.fn(),
    } as never);

    await expect(service.retrieve('version-1', target, 20, 'SEM')).rejects.toMatchObject({
      code: ErrorCode.UNRESOLVABLE_TARGET,
    });
  });
});

