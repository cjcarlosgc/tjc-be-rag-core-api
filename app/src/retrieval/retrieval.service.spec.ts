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


describe('RetrievalService PHP structural relations (WI-CORE-028, DEC-PHP-RET-001)', () => {
  const PHP_FILE = 'app/Pricing/OrderPricingService.php';
  const anchorMethod = makeChunk({
    id: 'anchor',
    filePath: PHP_FILE,
    symbolKind: 'METHOD',
    symbolName: 'total',
    parentSymbolName: 'App\\Pricing\\OrderPricingService',
    content: 'public function total() { return (new Discount())->apply(); }',
    importsUsed: ['App\\Money\\Money'],
  });
  const target = {
    filePath: PHP_FILE,
    symbolName: 'OrderPricingService',
    methodName: 'total',
    targetType: 'METHOD' as const,
  };

  function phpService(allChunks: CodeChunk[], options: { anchor?: CodeChunk; semantic?: CodeChunk[] } = {}) {
    return new RetrievalService({
      findBySymbol: vi.fn().mockResolvedValue([options.anchor ?? anchorMethod]),
      findSimilarByEmbedding: vi.fn().mockResolvedValue(options.semantic ?? []),
      findByProjectVersion: vi.fn().mockResolvedValue(allChunks),
    } as never);
  }

  function labels(candidates: Array<{ chunk: CodeChunk; semanticScore: number | null; structuralMatch: string | null }>) {
    return candidates.map((candidate) => [candidate.chunk.id, candidate.structuralMatch]);
  }

  it('R-PHP1 IMPORTS: labels a candidate whose class is imported by the target with use', async () => {
    const money = makeChunk({
      id: 'money',
      filePath: 'app/Money/Money.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Money\\Money',
      parentSymbolName: null,
    });

    const result = await phpService([anchorMethod, money]).retrieve('version-1', target);

    expect(labels(result.candidates)).toEqual([['money', 'IMPORTS']]);
  });

  it('R-PHP2 IMPORTED_BY: labels a candidate that imports the class declaring the target', async () => {
    const controller = makeChunk({
      id: 'controller',
      filePath: 'app/Http/OrderController.php',
      symbolKind: 'METHOD',
      symbolName: 'show',
      parentSymbolName: 'App\\Http\\OrderController',
      importsUsed: ['\\App\\Pricing\\OrderPricingService'],
    });

    const result = await phpService([anchorMethod, controller]).retrieve('version-1', target);

    expect(labels(result.candidates)).toEqual([['controller', 'IMPORTED_BY']]);
  });

  it('R-PHP3 SAME_NAMESPACE: labels a same-namespace class whose short name the target mentions', async () => {
    const discount = makeChunk({
      id: 'discount',
      filePath: 'app/Pricing/Discount.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Pricing\\Discount',
      parentSymbolName: null,
    });

    const result = await phpService([anchorMethod, discount]).retrieve('version-1', target);

    expect(labels(result.candidates)).toEqual([['discount', 'SAME_NAMESPACE']]);
  });

  it('R-PHP3 does not label a same-namespace class that the target does not mention', async () => {
    const coupon = makeChunk({
      id: 'coupon',
      filePath: 'app/Pricing/Coupon.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Pricing\\Coupon',
      parentSymbolName: null,
    });
    const discountPolicy = makeChunk({
      id: 'discount-policy',
      filePath: 'app/Pricing/DiscountPolicy.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Pricing\\DiscountPolicy',
      parentSymbolName: null,
    });
    const policyOnlyAnchor = makeChunk({
      ...anchorMethod,
      id: 'anchor',
      content: 'public function total() { return new DiscountPolicy(); }',
      importsUsed: [],
    });

    const result = await phpService([policyOnlyAnchor, coupon, discountPolicy], {
      anchor: policyOnlyAnchor,
    }).retrieve('version-1', target);

    expect(labels(result.candidates)).toEqual([['discount-policy', 'SAME_NAMESPACE']]);
  });

  it('R-PHP4 FULLY_QUALIFIED_REFERENCE: labels a class referenced with a leading backslash', async () => {
    const mailer = makeChunk({
      id: 'mailer',
      filePath: 'app/Legacy/Mailer.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Legacy\\Mailer',
      parentSymbolName: null,
    });
    const anchor = makeChunk({ ...anchorMethod, id: 'anchor', content: 'return new \\App\\Legacy\\Mailer();', importsUsed: [] });

    const result = await phpService([anchor, mailer], { anchor }).retrieve('version-1', target);

    expect(labels(result.candidates)).toEqual([['mailer', 'FULLY_QUALIFIED_REFERENCE']]);
  });

  it('R-PHP4 does not label a reference without a leading backslash or a longer identifier', async () => {
    const mailer = makeChunk({
      id: 'mailer',
      filePath: 'app/Legacy/Mailer.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Legacy\\Mailer',
      parentSymbolName: null,
    });
    const withoutSlash = makeChunk({ ...anchorMethod, id: 'anchor', content: 'return new App\\Legacy\\Mailer();', importsUsed: [] });
    const longerName = makeChunk({ ...anchorMethod, id: 'anchor', content: 'return new \\App\\Legacy\\MailerX();', importsUsed: [] });

    const resultWithoutSlash = await phpService([withoutSlash, mailer], { anchor: withoutSlash }).retrieve('version-1', target);
    const resultLongerName = await phpService([longerName, mailer], { anchor: longerName }).retrieve('version-1', target);

    expect(resultWithoutSlash.candidates).toEqual([]);
    expect(resultLongerName.candidates).toEqual([]);
  });

  it('R-PHP5 DECLARING_CLASS: labels the declaration chunk of the class that declares the target', async () => {
    const declaration = makeChunk({
      id: 'declaration',
      filePath: PHP_FILE,
      symbolKind: 'CLASS',
      symbolName: 'App\\Pricing\\OrderPricingService',
      parentSymbolName: null,
    });

    const result = await phpService([anchorMethod, declaration]).retrieve('version-1', target);

    expect(labels(result.candidates)).toEqual([['declaration', 'DECLARING_CLASS']]);
  });

  it('applies priority R-PHP1 over R-PHP4 when both hold for the same candidate', async () => {
    const money = makeChunk({
      id: 'money',
      filePath: 'app/Money/Money.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Money\\Money',
      parentSymbolName: null,
    });
    const anchor = makeChunk({ ...anchorMethod, id: 'anchor', content: 'return new \\App\\Money\\Money();' });

    const result = await phpService([anchor, money], { anchor }).retrieve('version-1', target);

    expect(labels(result.candidates)).toEqual([['money', 'IMPORTS']]);
  });

  it('applies priority R-PHP3 over R-PHP4 when both hold for the same candidate', async () => {
    const discount = makeChunk({
      id: 'discount',
      filePath: 'app/Pricing/Discount.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Pricing\\Discount',
      parentSymbolName: null,
    });
    const anchor = makeChunk({ ...anchorMethod, id: 'anchor', content: 'return new \\App\\Pricing\\Discount();', importsUsed: [] });

    const result = await phpService([anchor, discount], { anchor }).retrieve('version-1', target);

    expect(labels(result.candidates)).toEqual([['discount', 'SAME_NAMESPACE']]);
  });

  it('uses the namespace of the anchor function when the anchor is a top-level function', async () => {
    const functionAnchor = makeChunk({
      id: 'anchor',
      filePath: 'app/Pricing/helpers.php',
      symbolKind: 'FUNCTION',
      symbolName: 'App\\Pricing\\computeTotal',
      parentSymbolName: null,
      content: 'function computeTotal() { return new Discount(); }',
      importsUsed: [],
    });
    const discount = makeChunk({
      id: 'discount',
      filePath: 'app/Pricing/Discount.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Pricing\\Discount',
      parentSymbolName: null,
    });
    const functionTarget = { filePath: functionAnchor.filePath, symbolName: 'computeTotal', methodName: null, targetType: 'FUNCTION' as const };

    const result = await phpService([functionAnchor, discount], { anchor: functionAnchor }).retrieve('version-1', functionTarget);

    expect(labels(result.candidates)).toEqual([['discount', 'SAME_NAMESPACE']]);
  });

  it('does not apply R-PHP2 or R-PHP5 to a top-level function anchor, which has no declaring class', async () => {
    const functionAnchor = makeChunk({
      id: 'anchor',
      filePath: 'app/Pricing/helpers.php',
      symbolKind: 'FUNCTION',
      symbolName: 'App\\Pricing\\computeTotal',
      parentSymbolName: null,
      content: 'return 1;',
      importsUsed: [],
    });
    const importer = makeChunk({
      id: 'importer',
      filePath: 'app/Http/Ctl.php',
      symbolKind: 'METHOD',
      symbolName: 'show',
      parentSymbolName: 'App\\Http\\Ctl',
      importsUsed: ['App\\Pricing\\computeTotal'],
    });
    const sameNameClass = makeChunk({
      id: 'same-name',
      filePath: 'app/Pricing/computeTotal.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Pricing\\computeTotal',
      parentSymbolName: null,
    });
    const functionTarget = { filePath: functionAnchor.filePath, symbolName: 'computeTotal', methodName: null, targetType: 'FUNCTION' as const };

    const result = await phpService([functionAnchor, importer, sameNameClass], { anchor: functionAnchor }).retrieve('version-1', functionTarget);

    expect(result.candidates).toEqual([]);
  });

  it('keeps a semantic candidate that is also structural in one entry with both values', async () => {
    const discount = makeChunk({
      id: 'discount',
      filePath: 'app/Pricing/Discount.php',
      symbolKind: 'CLASS',
      symbolName: 'App\\Pricing\\Discount',
      parentSymbolName: null,
    });

    const result = await phpService([anchorMethod, discount], {
      semantic: [{ ...discount, semanticScore: 0.7 } as CodeChunk],
    }).retrieve('version-1', target);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ semanticScore: 0.7, structuralMatch: 'SAME_NAMESPACE' });
  });

  it('only considers .php candidates when the anchor is PHP', async () => {
    const tsMoney = makeChunk({
      id: 'ts-money',
      filePath: 'src/money.ts',
      symbolKind: 'CLASS',
      symbolName: 'App\\Money\\Money',
      parentSymbolName: null,
    });

    const result = await phpService([anchorMethod, tsMoney]).retrieve('version-1', target);

    expect(result.candidates).toEqual([]);
  });
});
