import { describe, expect, it } from 'vitest';
import { ContextBuilder } from './context-builder.service.js';
import { PromptBuilder } from '../generation/prompt-builder.service.js';
import type {
  RetrievalCandidate,
  RetrievalResult,
} from './retrieval.service.js';
import type { CodeChunk } from '../generated/prisma/client.js';
import type { FunctionalRule } from './generation-context.js';
import { countFunctionalRuleTokens, renderFunctionalRule } from './functional-rule-format.js';

function makeConfigService(overrides: Record<string, number | string> = {}) {
  return {
    get: (key: string, fallback: number | string) => overrides[key] ?? fallback,
  } as never;
}

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

function makeCandidate(
  overrides: Partial<RetrievalCandidate> = {},
): RetrievalCandidate {
  return {
    chunk: makeChunk(),
    semanticScore: null,
    structuralMatch: null,
    ...overrides,
  };
}

const target = {
  filePath: 'src/foo.ts',
  symbolName: 'foo',
  methodName: null,
  targetType: 'FUNCTION' as const,
};

describe('ContextBuilder', () => {
  it('always includes the target content and reports retrieval/selection counters', () => {
    const builder = new ContextBuilder(makeConfigService());
    const result: RetrievalResult = {
      targetChunks: [
        makeChunk({ content: 'function foo() { return 1; }', tokenCount: 8 }),
      ],
      candidates: [],
    };

    const context = builder.build(result, target, { framework: 'VITEST' });

    expect(context.target.content).toBe('function foo() { return 1; }');
    expect(context.metadata).toEqual({
      language: 'typescript',
      framework: 'VITEST',
    });
    expect(context.retrievedChunks).toBe(0);
    expect(context.selectedChunks).toBe(0);
    expect(context.contextTokens).toBe(8);
    expect(context.audit?.target.chunkIds).toEqual(['chunk-id']);
    expect(context.audit?.configuration).toEqual({
      minimumScore: 0,
      topK: 10,
      maxContextTokens: 8000,
      semanticWeight: 0.7,
      structuralWeight: 0.3,
      // WI-CORE-103: `language` ausente es TypeScript, que siempre usa RANKED.
      strategy: 'RANKED',
      relevanceThreshold: 0.6,
      declaringClassMaxTokens: 4000,
      targetEvidenceMaxTokens: 2000,
    });
  });

  it('ranks candidates by weighted semantic + structural score and labels matchedVia', () => {
    const builder = new ContextBuilder(makeConfigService());
    const semanticOnly = makeCandidate({
      chunk: makeChunk({ id: 'semantic', tokenCount: 5 }),
      semanticScore: 0.9,
    });
    const structuralOnly = makeCandidate({
      chunk: makeChunk({ id: 'structural', tokenCount: 5 }),
      structuralMatch: 'IMPORTS',
    });
    const result: RetrievalResult = {
      targetChunks: [makeChunk({ tokenCount: 1 })],
      candidates: [structuralOnly, semanticOnly],
    };

    const context = builder.build(result, target, { framework: null });

    expect(context.relatedChunks.map((chunk) => chunk.filePath)).toEqual([
      'src/foo.ts',
      'src/foo.ts',
    ]);
    expect(context.relatedChunks[0].matchedVia).toEqual(['SEMANTIC']);
    expect(context.relatedChunks[1].matchedVia).toEqual(['IMPORTS']);
    // 0.7 * 0.9 (semantic) > 0.3 * 1 (structural) con los pesos default
    expect(context.relatedChunks[0].score).toBeGreaterThan(
      context.relatedChunks[1].score,
    );
  });

  it('drops candidates below minimumScore', () => {
    const builder = new ContextBuilder(
      makeConfigService({ RETRIEVAL_MINIMUM_SCORE: 0.5 }),
    );
    const weak = makeCandidate({ semanticScore: 0.1 });
    const result: RetrievalResult = {
      targetChunks: [makeChunk({ tokenCount: 1 })],
      candidates: [weak],
    };

    const context = builder.build(result, target, { framework: null });

    expect(context.relatedChunks).toEqual([]);
    expect(context.retrievedChunks).toBe(1);
    expect(context.selectedChunks).toBe(0);
  });

  it('respects topK even when more candidates pass the score threshold', () => {
    const builder = new ContextBuilder(
      makeConfigService({ RETRIEVAL_TOP_K: 1 }),
    );
    const first = makeCandidate({
      chunk: makeChunk({ id: 'a', tokenCount: 1 }),
      semanticScore: 0.9,
    });
    const second = makeCandidate({
      chunk: makeChunk({ id: 'b', tokenCount: 1 }),
      semanticScore: 0.8,
    });
    const result: RetrievalResult = {
      targetChunks: [makeChunk({ tokenCount: 1 })],
      candidates: [first, second],
    };

    const context = builder.build(result, target, { framework: null });

    expect(context.selectedChunks).toBe(1);
  });

  it('stops adding candidates once maxContextTokens would be exceeded, trying smaller ones after', () => {
    const builder = new ContextBuilder(
      makeConfigService({
        RETRIEVAL_MAX_CONTEXT_TOKENS: 15,
        RETRIEVAL_TOP_K: 10,
      }),
    );
    const target1 = { targetChunks: [makeChunk({ tokenCount: 10 })] };
    const tooBig = makeCandidate({
      chunk: makeChunk({ id: 'big', tokenCount: 100 }),
      semanticScore: 0.9,
    });
    const fits = makeCandidate({
      chunk: makeChunk({ id: 'small', tokenCount: 5 }),
      semanticScore: 0.5,
    });
    const result: RetrievalResult = { ...target1, candidates: [tooBig, fits] };

    const context = builder.build(result, target, { framework: null });

    expect(context.selectedChunks).toBe(1);
    expect(context.relatedChunks[0].content).toBe(fits.chunk.content);
    expect(context.contextTokens).toBe(15);
  });

  it('audits every candidate with the observed discard reason and does not change the prompt', () => {
    const builder = new ContextBuilder(makeConfigService());
    const promptBuilder = new PromptBuilder();
    const options = { minimumScore: 0.5, topK: 2, maxContextTokens: 2 };
    const targetChunk = makeChunk({ id: 'target', tokenCount: 1 });
    const budget = makeCandidate({
      chunk: makeChunk({
        id: 'budget',
        filePath: 'src/budget.ts',
        tokenCount: 5,
      }),
      semanticScore: 1,
    });
    const selected = makeCandidate({
      chunk: makeChunk({
        id: 'selected',
        filePath: 'src/selected.ts',
        tokenCount: 1,
      }),
      semanticScore: 0.9,
    });
    const topK = makeCandidate({
      chunk: makeChunk({
        id: 'top-k',
        filePath: 'src/top-k.ts',
        tokenCount: 1,
      }),
      semanticScore: 0.8,
    });
    const below = makeCandidate({
      chunk: makeChunk({
        id: 'below',
        filePath: 'src/below.ts',
        tokenCount: 1,
      }),
      semanticScore: 0.1,
    });
    const context = builder.build(
      {
        targetChunks: [targetChunk],
        candidates: [below, topK, selected, budget],
      },
      target,
      { framework: 'VITEST' },
      options,
    );

    expect(
      context.audit?.candidates.map((candidate) => [
        candidate.chunkId,
        candidate.rank,
      ]),
    ).toEqual([
      ['budget', 1],
      ['selected', 2],
      ['top-k', 3],
      ['below', 4],
    ]);
    expect(
      context.audit?.candidates.map(({ chunkId, decision, discardReason }) => [
        chunkId,
        decision,
        discardReason,
      ]),
    ).toEqual([
      ['budget', 'DISCARDED', 'TOKEN_BUDGET'],
      ['selected', 'SELECTED', null],
      ['top-k', 'DISCARDED', 'TOP_K_LIMIT'],
      ['below', 'DISCARDED', 'BELOW_MINIMUM_SCORE'],
    ]);
    expect(context.relatedChunks.map((chunk) => chunk.filePath)).toEqual([
      'src/selected.ts',
    ]);

    const ordinaryPrompt = promptBuilder.build({
      ...context,
      audit: undefined,
    });
    const auditedPrompt = promptBuilder.build(context);
    expect(auditedPrompt).toBe(ordinaryPrompt);
    expect(auditedPrompt).not.toContain('BELOW_MINIMUM_SCORE');
    expect(auditedPrompt).not.toContain('src/below.ts');
  });

  it('keeps a candidate whose score equals minimumScore and rejects one just below it', () => {
    const builder = new ContextBuilder(makeConfigService());
    const atMinimum = makeCandidate({
      chunk: makeChunk({ id: 'at-minimum', tokenCount: 1 }),
      semanticScore: 1,
    });
    const belowMinimum = makeCandidate({
      chunk: makeChunk({ id: 'below-minimum', tokenCount: 1 }),
      semanticScore: 0.99,
    });

    const context = builder.build(
      {
        targetChunks: [makeChunk({ tokenCount: 1 })],
        candidates: [belowMinimum, atMinimum],
      },
      target,
      { framework: null },
      { minimumScore: 0.7, topK: 10, maxContextTokens: 100 },
    );

    expect(
      context.audit?.candidates.map(({ chunkId, decision, discardReason }) => [
        chunkId,
        decision,
        discardReason,
      ]),
    ).toEqual([
      ['at-minimum', 'SELECTED', null],
      ['below-minimum', 'DISCARDED', 'BELOW_MINIMUM_SCORE'],
    ]);
    expect(context.selectedChunks).toBe(1);
  });

  it('breaks equal scores by retrieval order and reports the loser as TOP_K_LIMIT', () => {
    const builder = new ContextBuilder(makeConfigService());
    const firstRetrieved = makeCandidate({
      chunk: makeChunk({ id: 'first-retrieved', tokenCount: 1 }),
      semanticScore: 0.5,
    });
    const secondRetrieved = makeCandidate({
      chunk: makeChunk({ id: 'second-retrieved', tokenCount: 1 }),
      semanticScore: 0.5,
    });

    const context = builder.build(
      {
        targetChunks: [makeChunk({ tokenCount: 1 })],
        candidates: [firstRetrieved, secondRetrieved],
      },
      target,
      { framework: null },
      { minimumScore: 0, topK: 1, maxContextTokens: 100 },
    );

    expect(
      context.audit?.candidates.map(
        ({ chunkId, rank, decision, discardReason }) => [
          chunkId,
          rank,
          decision,
          discardReason,
        ],
      ),
    ).toEqual([
      ['first-retrieved', 1, 'SELECTED', null],
      ['second-retrieved', 2, 'DISCARDED', 'TOP_K_LIMIT'],
    ]);
    expect(context.relatedChunks).toHaveLength(1);
    expect(context.relatedChunks[0].score).toBeCloseTo(0.35);
  });

  it('marks an oversized candidate TOKEN_BUDGET and still selects a smaller one that fits after it', () => {
    const builder = new ContextBuilder(makeConfigService());
    const oversized = makeCandidate({
      chunk: makeChunk({ id: 'oversized', filePath: 'src/big.ts', tokenCount: 100 }),
      semanticScore: 0.9,
    });
    const smaller = makeCandidate({
      chunk: makeChunk({ id: 'smaller', filePath: 'src/small.ts', tokenCount: 5 }),
      semanticScore: 0.5,
    });

    const context = builder.build(
      {
        targetChunks: [makeChunk({ tokenCount: 10 })],
        candidates: [smaller, oversized],
      },
      target,
      { framework: null },
      { minimumScore: 0, topK: 10, maxContextTokens: 15 },
    );

    expect(
      context.audit?.candidates.map(
        ({ chunkId, rank, decision, discardReason }) => [
          chunkId,
          rank,
          decision,
          discardReason,
        ],
      ),
    ).toEqual([
      ['oversized', 1, 'DISCARDED', 'TOKEN_BUDGET'],
      ['smaller', 2, 'SELECTED', null],
    ]);
    expect(context.relatedChunks.map((chunk) => chunk.filePath)).toEqual([
      'src/small.ts',
    ]);
    expect(context.contextTokens).toBe(15);
  });
});

function makeRule(overrides: Partial<FunctionalRule> = {}): FunctionalRule {
  return {
    knowledgeId: 'rule-1',
    scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    normalizedRule: 'Devuelve 1 cuando el valor es válido.',
    scope: 'SYMBOL',
    targetRef: 'src/foo.ts::foo',
    source: 'HUMAN_ANSWER',
    provenance: {
      confirmedByUserId: 'user-secret',
      confirmedRole: 'MAINTAINER',
      originHeadSha: 'head-sha',
      sourceRef: null,
    },
    ...overrides,
  };
}

describe('ContextBuilder functional rules (WI-CORE-021)', () => {
  const targetResult: RetrievalResult = {
    targetChunks: [makeChunk({ id: 'target', content: 'function foo() {}', tokenCount: 10 })],
    candidates: [
      makeCandidate({
        chunk: makeChunk({ id: 'related', filePath: 'src/related.ts', symbolName: 'helper', tokenCount: 10 }),
        semanticScore: 0.9,
      }),
    ],
  };

  it('includes all rules in the given order and counts them with the chunk tokenizer', () => {
    const builder = new ContextBuilder(makeConfigService());
    const first = makeRule({ knowledgeId: 'rule-a' });
    const second = makeRule({ knowledgeId: 'rule-b', scenarioKey: 'BOUNDARY:bbbbbbbbbbbbbbbb' });

    const context = builder.build(targetResult, target, { framework: null }, {}, [first, second]);

    expect(context.functionalRules.map((rule) => rule.knowledgeId)).toEqual(['rule-a', 'rule-b']);
    const ruleTokens = countFunctionalRuleTokens(first) + countFunctionalRuleTokens(second);
    expect(context.audit?.functionalRules).toEqual({
      retrieved: 2,
      selected: 2,
      tokenCount: ruleTokens,
      omitted: [],
    });
    expect(context.contextTokens).toBe(10 + ruleTokens + 10);
  });

  it('subtracts rule tokens before chunks and omits rules that do not fit, keeping the ones that do', () => {
    const builder = new ContextBuilder(makeConfigService());
    const fits = makeRule({ knowledgeId: 'rule-fits', normalizedRule: 'Sí.' });
    const huge = makeRule({
      knowledgeId: 'rule-huge',
      normalizedRule: Array.from({ length: 400 }, (_, index) => `palabra${index}`).join(' '),
    });
    const tail = makeRule({ knowledgeId: 'rule-tail', normalizedRule: 'No.' });
    const budget = 10 + countFunctionalRuleTokens(fits) + countFunctionalRuleTokens(tail);

    const context = builder.build(targetResult, target, { framework: null }, { maxContextTokens: budget }, [
      fits,
      huge,
      tail,
    ]);

    expect(context.functionalRules.map((rule) => rule.knowledgeId)).toEqual(['rule-fits', 'rule-tail']);
    expect(context.audit?.functionalRules.omitted).toEqual([
      {
        knowledgeId: 'rule-huge',
        tokenCount: countFunctionalRuleTokens(huge),
        reason: 'TOKEN_BUDGET',
      },
    ]);
    expect(context.audit?.functionalRules.selected).toBe(2);
    expect(context.relatedChunks).toEqual([]);
    expect(context.audit?.candidates[0]).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOKEN_BUDGET' });
  });

  it('never exposes the confirming user identifier in the rendered rule', () => {
    expect(renderFunctionalRule(makeRule())).not.toContain('user-secret');
    expect(renderFunctionalRule(makeRule())).toContain('confirmada por rol MAINTAINER');
  });

  it('reports zero retrieved rules when none are passed', () => {
    const builder = new ContextBuilder(makeConfigService());

    const context = builder.build(targetResult, target, { framework: null });

    expect(context.functionalRules).toEqual([]);
    expect(context.audit?.functionalRules).toEqual({ retrieved: 0, selected: 0, tokenCount: 0, omitted: [] });
  });
});

describe('ContextBuilder scoring API (WI-CORE-022)', () => {
  it('resolveWeights uses 0.7/0.3 by default, env values when set, and explicit options first', () => {
    const defaults = new ContextBuilder(makeConfigService());
    const fromEnv = new ContextBuilder(
      makeConfigService({ RETRIEVAL_SEMANTIC_WEIGHT: 0.5, RETRIEVAL_STRUCTURAL_WEIGHT: 0.5 }),
    );

    expect(defaults.resolveWeights()).toEqual({ semanticWeight: 0.7, structuralWeight: 0.3 });
    expect(fromEnv.resolveWeights()).toEqual({ semanticWeight: 0.5, structuralWeight: 0.5 });
    expect(fromEnv.resolveWeights({ semanticWeight: 0.1 })).toEqual({ semanticWeight: 0.1, structuralWeight: 0.5 });
  });

  it('scoreCandidate applies the product formula and the same score build() reports', () => {
    const builder = new ContextBuilder(makeConfigService());
    const weights = builder.resolveWeights();

    expect(builder.scoreCandidate(weights, 0.9, null)).toBeCloseTo(0.63);
    expect(builder.scoreCandidate(weights, null, 'IMPORTS')).toBeCloseTo(0.3);
    expect(builder.scoreCandidate(weights, 0.5, 'IMPORTED_BY')).toBeCloseTo(0.65);

    const context = builder.build(
      {
        targetChunks: [makeChunk({ tokenCount: 1 })],
        candidates: [makeCandidate({ chunk: makeChunk({ id: 'c', tokenCount: 1 }), semanticScore: 0.5, structuralMatch: 'IMPORTED_BY' })],
      },
      target,
      { framework: null },
    );

    expect(context.relatedChunks[0].score).toBeCloseTo(builder.scoreCandidate(weights, 0.5, 'IMPORTED_BY'));
  });
  it('propagates language and PHPUNIT framework to the generation context metadata', () => {
    const builder = new ContextBuilder(makeConfigService());
    const result: RetrievalResult = {
      targetChunks: [makeChunk({ content: '<?php function foo() {}', tokenCount: 8 })],
      candidates: [],
    };

    const php = builder.build(result, target, { framework: 'PHPUNIT', language: 'php' });
    const defaulted = builder.build(result, target, { framework: 'JEST' });

    expect(php.metadata).toEqual({ language: 'php', framework: 'PHPUNIT' });
    expect(defaulted.metadata).toEqual({ language: 'typescript', framework: 'JEST' });
  });
});


describe('ContextBuilder dependencyContext (WI-CORE-057)', () => {
  it('copies dependencyContext without changing selection, order, audit or counters', () => {
    const builder = new ContextBuilder(makeConfigService());
    const result: RetrievalResult = {
      targetChunks: [makeChunk({ id: 'target', symbolName: 'foo', content: 'target body', tokenCount: 4 })],
      candidates: [
        makeCandidate({ chunk: makeChunk({ id: 'c1', filePath: 'src/a.ts', tokenCount: 10 }), semanticScore: 0.9 }),
        makeCandidate({
          chunk: makeChunk({ id: 'c2', filePath: 'src/b.ts', tokenCount: 10 }),
          semanticScore: 0.5,
          structuralMatch: 'IMPORTS',
        }),
      ],
    };
    const dependencyContext = {
      entries: [
        {
          typeName: 'Policy',
          fqcn: 'App\\Policy',
          origin: 'CONSTRUCTOR' as const,
          resolvedBy: 'IMPORT' as const,
        },
      ],
      unresolvedCount: 1,
      tokenCount: 12,
      truncated: false,
      text: 'Dependencias del código objetivo: App\\Policy',
    };
    const metadata = { framework: null, language: 'php' as const };
    const options = { maxContextTokens: 25 };

    const without = builder.build(result, target, metadata, options, []);
    const withDependencies = builder.build(result, target, metadata, options, [], dependencyContext);

    expect(without.dependencyContext).toBeUndefined();
    expect(withDependencies.dependencyContext).toEqual(dependencyContext);
    const copy = { ...withDependencies };
    delete copy.dependencyContext;
    expect(copy).toEqual(without);
    expect(withDependencies.contextTokens).toBe(without.contextTokens);
    expect(withDependencies.selectedChunks).toBe(without.selectedChunks);
    expect(withDependencies.retrievedChunks).toBe(without.retrievedChunks);
    expect(withDependencies.relatedChunks).toEqual(without.relatedChunks);
    expect(withDependencies.audit).toEqual(without.audit);
  });
});

describe('ContextBuilder dependencyContext signature (WI-CORE-065)', () => {
  it('keeps contextTokens and selectedChunks identical with and without constructor signatures', () => {
    const builder = new ContextBuilder(makeConfigService());
    const result: RetrievalResult = {
      targetChunks: [makeChunk({ id: 'target', symbolName: 'foo', content: 'target body', tokenCount: 4 })],
      candidates: [
        makeCandidate({ chunk: makeChunk({ id: 'c1', filePath: 'src/a.ts', tokenCount: 10 }), semanticScore: 0.9 }),
      ],
    };
    const withSignature = {
      entries: [
        {
          typeName: 'Plan',
          fqcn: 'App\\Plan',
          origin: 'CONSTRUCTOR' as const,
          resolvedBy: 'IMPORT' as const,
          signature: '(public string $code, public float $monthlyPrice)',
        },
      ],
      unresolvedCount: 0,
      tokenCount: 40,
      truncated: false,
      text: 'Dependencias del código objetivo: App\\Plan — constructor(public string $code, public float $monthlyPrice)',
    };
    const metadata = { framework: null, language: 'php' as const };
    const options = { maxContextTokens: 25 };

    const without = builder.build(result, target, metadata, options, []);
    const withDependencies = builder.build(result, target, metadata, options, [], withSignature);

    expect(withDependencies.contextTokens).toBe(without.contextTokens);
    expect(withDependencies.selectedChunks).toEqual(without.selectedChunks);
  });
});

/* ------------------------------------------------------------------------------------------------
 * WI-CORE-103: estrategia LAYERED (PHP) y RANKED como línea base
 * ---------------------------------------------------------------------------------------------- */

const phpMetadata = { framework: 'PHPUNIT' as const, language: 'php' as const };
const phpTarget = {
  filePath: 'src/Money.php',
  symbolName: 'Money',
  methodName: 'add',
  targetType: 'METHOD' as const,
};

function phpCandidate(
  id: string,
  overrides: {
    tokens?: number;
    semantic?: number | null;
    match?: RetrievalCandidate['structuralMatch'];
    filePath?: string;
    startLine?: number;
    endLine?: number;
  } = {},
): RetrievalCandidate {
  const startLine = overrides.startLine ?? 1;
  return makeCandidate({
    chunk: makeChunk({
      id,
      filePath: overrides.filePath ?? `src/${id}.php`,
      symbolName: id,
      tokenCount: overrides.tokens ?? 10,
      startLine,
      endLine: overrides.endLine ?? startLine + 4,
      content: `// ${id}`,
    }),
    semanticScore: overrides.semantic === undefined ? null : overrides.semantic,
    structuralMatch: overrides.match ?? null,
  });
}

function phpResult(candidates: RetrievalCandidate[], targetTokens = 100): RetrievalResult {
  return {
    targetChunks: [makeChunk({ id: 'target', filePath: 'src/Money.php', tokenCount: targetTokens, content: '<?php // target' })],
    candidates,
  };
}

function buildPhp(
  candidates: RetrievalCandidate[],
  options: Parameters<ContextBuilder['build']>[3] = {},
  env: Record<string, number | string> = {},
  rules: FunctionalRule[] = [],
  targetTokens = 100,
) {
  return new ContextBuilder(makeConfigService(env)).build(
    phpResult(candidates, targetTokens),
    phpTarget,
    phpMetadata,
    options,
    rules,
  );
}

function decisionOf(context: ReturnType<typeof buildPhp>, chunkId: string) {
  const found = context.audit?.candidates.find((candidate) => candidate.chunkId === chunkId);
  if (!found) throw new Error(`candidate ${chunkId} not in audit`);
  return found;
}

function selectedIds(context: ReturnType<typeof buildPhp>): string[] {
  return (context.audit?.candidates ?? [])
    .filter((candidate) => candidate.decision === 'SELECTED')
    .map((candidate) => candidate.chunkId);
}

describe('ContextBuilder LAYERED (WI-CORE-103)', () => {
  it('registers the defaults LAYERED, 0.6, 4000 and 2000 for a PHP project', () => {
    const context = buildPhp([]);

    expect(context.audit?.configuration).toEqual({
      minimumScore: 0,
      topK: 10,
      maxContextTokens: 8000,
      semanticWeight: 0.7,
      structuralWeight: 0.3,
      strategy: 'LAYERED',
      relevanceThreshold: 0.6,
      declaringClassMaxTokens: 4000,
      targetEvidenceMaxTokens: 2000,
    });
  });

  it('takes the strategy and limits from the environment and lets options win', () => {
    const fromEnv = buildPhp([], {}, {
      RETRIEVAL_CONTEXT_STRATEGY: 'RANKED',
      RETRIEVAL_RELEVANCE_THRESHOLD: 0.75,
      RETRIEVAL_DECLARING_CLASS_MAX_TOKENS: 1234,
      RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS: 567,
    });
    expect(fromEnv.audit?.configuration).toMatchObject({
      strategy: 'RANKED',
      relevanceThreshold: 0.75,
      declaringClassMaxTokens: 1234,
      targetEvidenceMaxTokens: 567,
    });

    const fromOptions = buildPhp(
      [],
      {
        strategy: 'LAYERED',
        relevanceThreshold: 0.9,
        declaringClassMaxTokens: 11,
        targetEvidenceMaxTokens: 22,
      },
      {
        RETRIEVAL_CONTEXT_STRATEGY: 'RANKED',
        RETRIEVAL_RELEVANCE_THRESHOLD: 0.75,
        RETRIEVAL_DECLARING_CLASS_MAX_TOKENS: 1234,
        RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS: 567,
      },
    );
    expect(fromOptions.audit?.configuration).toMatchObject({
      strategy: 'LAYERED',
      relevanceThreshold: 0.9,
      declaringClassMaxTokens: 11,
      targetEvidenceMaxTokens: 22,
    });
  });

  it('selects by layers 3, 4 and 5 in that order and labels every selected candidate', () => {
    const context = buildPhp([
      phpCandidate('semantic-high', { semantic: 0.95, tokens: 10 }),
      phpCandidate('evidence-imports', { match: 'IMPORTS', semantic: 0.2, tokens: 20 }),
      phpCandidate('declaring', { match: 'DECLARING_CLASS', tokens: 30, startLine: 1 }),
      phpCandidate('evidence-fq', { match: 'FULLY_QUALIFIED_REFERENCE', tokens: 5 }),
      phpCandidate('semantic-mid', { semantic: 0.7, tokens: 10 }),
    ]);

    expect(context.relatedChunks.map((chunk) => chunk.symbolName)).toEqual([
      'declaring',
      'evidence-imports',
      'evidence-fq',
      'semantic-high',
      'semantic-mid',
    ]);
    expect(decisionOf(context, 'declaring')).toMatchObject({ decision: 'SELECTED', layer: 'DECLARING_CLASS' });
    expect(decisionOf(context, 'evidence-imports')).toMatchObject({ decision: 'SELECTED', layer: 'TARGET_EVIDENCE' });
    expect(decisionOf(context, 'evidence-fq')).toMatchObject({ decision: 'SELECTED', layer: 'TARGET_EVIDENCE' });
    expect(decisionOf(context, 'semantic-high')).toMatchObject({ decision: 'SELECTED', layer: 'RELEVANT_SEMANTIC' });
    expect(decisionOf(context, 'semantic-mid')).toMatchObject({ decision: 'SELECTED', layer: 'RELEVANT_SEMANTIC' });
    expect(context.selectedChunks).toBe(5);
    expect(context.retrievedChunks).toBe(5);
    expect(context.contextTokens).toBe(100 + 30 + 20 + 5 + 10 + 10);
    // score y matchedVia se calculan como siempre
    expect(context.relatedChunks[0]).toMatchObject({ score: 0.3, matchedVia: ['DECLARING_CLASS'] });
  });

  it('includes the SAME_NAMESPACE relation in the target evidence layer', () => {
    const context = buildPhp([phpCandidate('ns', { match: 'SAME_NAMESPACE', tokens: 10 })]);

    expect(decisionOf(context, 'ns')).toMatchObject({ decision: 'SELECTED', layer: 'TARGET_EVIDENCE' });
  });

  it('orders the declaring class parts by startLine, then endLine, then chunk id', () => {
    const context = buildPhp([
      phpCandidate('p-late', { match: 'DECLARING_CLASS', tokens: 10, startLine: 100, endLine: 120 }),
      phpCandidate('p-tie-b', { match: 'DECLARING_CLASS', tokens: 10, startLine: 50, endLine: 60 }),
      phpCandidate('p-first', { match: 'DECLARING_CLASS', tokens: 10, startLine: 10, endLine: 49 }),
      phpCandidate('p-tie-a', { match: 'DECLARING_CLASS', tokens: 10, startLine: 50, endLine: 60 }),
      phpCandidate('p-tie-short', { match: 'DECLARING_CLASS', tokens: 10, startLine: 50, endLine: 55 }),
    ]);

    expect(context.relatedChunks.map((chunk) => chunk.symbolName)).toEqual([
      'p-first',
      'p-tie-short',
      'p-tie-a',
      'p-tie-b',
      'p-late',
    ]);
  });

  it('caps the declaring class layer, discards the part that does not fit as TOKEN_BUDGET and keeps going', () => {
    const context = buildPhp(
      [
        phpCandidate('part-1', { match: 'DECLARING_CLASS', tokens: 60, startLine: 1 }),
        phpCandidate('part-2-big', { match: 'DECLARING_CLASS', tokens: 60, startLine: 20 }),
        phpCandidate('part-3-small', { match: 'DECLARING_CLASS', tokens: 30, startLine: 40 }),
      ],
      { declaringClassMaxTokens: 100 },
    );

    expect(selectedIds(context).sort()).toEqual(['part-1', 'part-3-small']);
    expect(decisionOf(context, 'part-2-big')).toMatchObject({
      decision: 'DISCARDED',
      discardReason: 'TOKEN_BUDGET',
      layer: null,
    });
    expect(context.contextTokens).toBe(100 + 60 + 30);
  });

  it('does not reconsider a candidate dropped by a layer cap for the semantic fill', () => {
    const context = buildPhp(
      [
        phpCandidate('part-1', { match: 'DECLARING_CLASS', tokens: 80, startLine: 1 }),
        phpCandidate('part-2', { match: 'DECLARING_CLASS', tokens: 80, startLine: 20, semantic: 0.99 }),
      ],
      { declaringClassMaxTokens: 100 },
    );

    expect(decisionOf(context, 'part-2')).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOKEN_BUDGET' });
  });

  it('caps the target evidence layer and discards what does not fit as TOKEN_BUDGET', () => {
    const context = buildPhp(
      [
        phpCandidate('ev-1', { match: 'IMPORTS', semantic: 0.9, tokens: 70 }),
        phpCandidate('ev-2', { match: 'IMPORTS', semantic: 0.8, tokens: 70 }),
        phpCandidate('ev-3', { match: 'SAME_NAMESPACE', semantic: 0.7, tokens: 20 }),
      ],
      { targetEvidenceMaxTokens: 100 },
    );

    expect(decisionOf(context, 'ev-1')).toMatchObject({ decision: 'SELECTED', layer: 'TARGET_EVIDENCE' });
    expect(decisionOf(context, 'ev-2')).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOKEN_BUDGET' });
    expect(decisionOf(context, 'ev-3')).toMatchObject({ decision: 'SELECTED', layer: 'TARGET_EVIDENCE' });
  });

  it('keeps IMPORTED_BY and test files out of the evidence layer and sends them to the semantic fill', () => {
    const context = buildPhp([
      phpCandidate('imported-by-relevant', { match: 'IMPORTED_BY', semantic: 0.8 }),
      phpCandidate('imported-by-weak', { match: 'IMPORTED_BY', semantic: 0.2 }),
      phpCandidate('test-relevant', { match: 'IMPORTS', semantic: 0.8, filePath: 'tests/MoneyTest.php' }),
      phpCandidate('test-weak', { match: 'SAME_NAMESPACE', semantic: 0.1, filePath: 'tests/OtherTest.php' }),
    ]);

    expect(decisionOf(context, 'imported-by-relevant')).toMatchObject({ layer: 'RELEVANT_SEMANTIC' });
    expect(decisionOf(context, 'imported-by-weak')).toMatchObject({
      decision: 'DISCARDED',
      discardReason: 'BELOW_RELEVANCE_THRESHOLD',
      layer: null,
    });
    expect(decisionOf(context, 'test-relevant')).toMatchObject({ layer: 'RELEVANT_SEMANTIC' });
    expect(decisionOf(context, 'test-weak')).toMatchObject({
      decision: 'DISCARDED',
      discardReason: 'BELOW_RELEVANCE_THRESHOLD',
    });
  });

  it('applies the relevance threshold to the semantic fill: 0.59 out, 0.60 in, null out', () => {
    const context = buildPhp([
      phpCandidate('s-059', { semantic: 0.59 }),
      phpCandidate('s-060', { semantic: 0.6 }),
      phpCandidate('s-null', { semantic: null }),
    ]);

    expect(decisionOf(context, 's-060')).toMatchObject({ decision: 'SELECTED', layer: 'RELEVANT_SEMANTIC' });
    expect(decisionOf(context, 's-059')).toMatchObject({ decision: 'DISCARDED', discardReason: 'BELOW_RELEVANCE_THRESHOLD' });
    expect(decisionOf(context, 's-null')).toMatchObject({ decision: 'DISCARDED', discardReason: 'BELOW_RELEVANCE_THRESHOLD' });
    expect(context.selectedChunks).toBe(1);
  });

  it('uses topK as the ceiling of the semantic fill only and reports the rest as TOP_K_LIMIT', () => {
    const candidates = [
      phpCandidate('declaring', { match: 'DECLARING_CLASS', tokens: 10 }),
      phpCandidate('evidence', { match: 'IMPORTS', tokens: 10 }),
      ...Array.from({ length: 5 }, (_, index) => phpCandidate(`sem-${index}`, { semantic: 0.9 - index * 0.01 })),
    ];

    const context = buildPhp(candidates, { topK: 2 });

    expect(context.selectedChunks).toBe(4);
    expect(selectedIds(context)).toEqual(expect.arrayContaining(['declaring', 'evidence', 'sem-0', 'sem-1']));
    for (const id of ['sem-2', 'sem-3', 'sem-4']) {
      expect(decisionOf(context, id)).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOP_K_LIMIT', layer: null });
    }
  });

  it('honors the global maxContextTokens in every layer', () => {
    const context = buildPhp(
      [
        phpCandidate('declaring', { match: 'DECLARING_CLASS', tokens: 50 }),
        phpCandidate('evidence', { match: 'IMPORTS', tokens: 40 }),
        phpCandidate('sem-fits-later', { semantic: 0.9, tokens: 5 }),
        phpCandidate('sem-too-big', { semantic: 0.95, tokens: 60 }),
      ],
      { maxContextTokens: 200 },
      {},
      [],
      100,
    );

    // 100 target + 50 declaring + 40 evidence = 190; the 60-token one is out, the 5-token one still fits
    expect(decisionOf(context, 'sem-too-big')).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOKEN_BUDGET' });
    expect(decisionOf(context, 'sem-fits-later')).toMatchObject({ decision: 'SELECTED', layer: 'RELEVANT_SEMANTIC' });
    expect(context.contextTokens).toBe(195);
    expect(context.contextTokens).toBeLessThanOrEqual(200);

    const tight = buildPhp(
      [
        phpCandidate('declaring', { match: 'DECLARING_CLASS', tokens: 50 }),
        phpCandidate('evidence', { match: 'IMPORTS', tokens: 40 }),
      ],
      { maxContextTokens: 145 },
    );
    expect(decisionOf(tight, 'declaring')).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOKEN_BUDGET' });
    expect(decisionOf(tight, 'evidence')).toMatchObject({ decision: 'SELECTED', layer: 'TARGET_EVIDENCE' });
    expect(tight.contextTokens).toBe(140);
  });

  it('subtracts the functional rules before any chunk, in every layer', () => {
    const rule: FunctionalRule = {
      knowledgeId: 'k1',
      scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
      normalizedRule: 'La suma conserva la moneda.',
      scope: 'METHOD',
      targetRef: 'src/Money.php::Money.add',
      source: 'HUMAN_ANSWER',
      provenance: { confirmedByUserId: null, confirmedRole: null, originHeadSha: null, sourceRef: null },
    } as FunctionalRule;
    const ruleTokens = countFunctionalRuleTokens(rule);
    const maxContextTokens = 100 + ruleTokens + 50;

    const context = buildPhp(
      [
        phpCandidate('declaring', { match: 'DECLARING_CLASS', tokens: 50 }),
        phpCandidate('sem', { semantic: 0.9, tokens: 1 }),
      ],
      { maxContextTokens },
      {},
      [rule],
    );

    expect(context.functionalRules).toHaveLength(1);
    expect(decisionOf(context, 'declaring')).toMatchObject({ decision: 'SELECTED', layer: 'DECLARING_CLASS' });
    expect(decisionOf(context, 'sem')).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOKEN_BUDGET' });
    expect(context.contextTokens).toBe(100 + ruleTokens + 50);

    // sin presupuesto para la clase tras descontar la regla, la regla sigue primero
    const squeezed = buildPhp(
      [phpCandidate('declaring', { match: 'DECLARING_CLASS', tokens: 50 })],
      { maxContextTokens: 100 + ruleTokens + 49 },
      {},
      [rule],
    );
    expect(squeezed.functionalRules).toHaveLength(1);
    expect(decisionOf(squeezed, 'declaring')).toMatchObject({ discardReason: 'TOKEN_BUDGET' });
  });

  it('reports BELOW_MINIMUM_SCORE before the layers and keeps those candidates out of them', () => {
    const context = buildPhp(
      [
        phpCandidate('declaring-weak', { match: 'DECLARING_CLASS', semantic: null }),
        phpCandidate('sem-ok', { semantic: 0.9 }),
      ],
      { minimumScore: 0.5 },
    );

    expect(decisionOf(context, 'declaring-weak')).toMatchObject({
      decision: 'DISCARDED',
      discardReason: 'BELOW_MINIMUM_SCORE',
      layer: null,
    });
    expect(decisionOf(context, 'sem-ok')).toMatchObject({ decision: 'SELECTED', layer: 'RELEVANT_SEMANTIC' });
  });

  it('keeps every candidate in the audit in global rank order, without duplicates, with layer null when discarded', () => {
    const candidates = [
      phpCandidate('a', { semantic: 0.9 }),
      phpCandidate('b', { match: 'DECLARING_CLASS', startLine: 5 }),
      phpCandidate('c', { match: 'IMPORTED_BY', semantic: 0.3 }),
      phpCandidate('d', { match: 'IMPORTS', semantic: 0.7 }),
      phpCandidate('e', { semantic: 0.65 }),
      phpCandidate('f', { semantic: null }),
    ];

    const context = buildPhp(candidates, { topK: 1 });
    const audit = context.audit?.candidates ?? [];

    expect(audit).toHaveLength(candidates.length);
    expect(new Set(audit.map((candidate) => candidate.chunkId)).size).toBe(candidates.length);
    expect(audit.map((candidate) => candidate.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    const scores = audit.map((candidate) => candidate.combinedScore);
    expect(scores).toEqual(scores.toSorted((x, y) => y - x));
    for (const candidate of audit) {
      if (candidate.decision === 'DISCARDED') {
        expect(candidate.layer).toBeNull();
        expect(candidate.discardReason).not.toBeNull();
      } else {
        expect(candidate.layer).not.toBeNull();
        expect(candidate.discardReason).toBeNull();
      }
    }
    const relatedKeys = context.relatedChunks.map((chunk) => `${chunk.filePath}`);
    expect(new Set(relatedKeys).size).toBe(relatedKeys.length);
    expect(context.selectedChunks).toBe(context.relatedChunks.length);
    expect(context.selectedChunks).toBe(selectedIds(context).length);
  });

  it('puts the abstract declaring class in the context even with score 0.30 behind 20 semantic candidates (persistence-c1 shape)', () => {
    const candidates = [
      phpCandidate('AbstractClassMetadataFactory', {
        match: 'DECLARING_CLASS',
        tokens: 1239,
        startLine: 1,
        endLine: 400,
      }),
      ...Array.from({ length: 20 }, (_, index) =>
        phpCandidate(`sem-${index}`, { semantic: 0.9 - index * 0.01, tokens: 20 }),
      ),
    ];

    const layered = buildPhp(candidates, {}, {}, [], 100);
    const ranked = buildPhp(candidates, { strategy: 'RANKED' }, {}, [], 100);

    expect(decisionOf(layered, 'AbstractClassMetadataFactory')).toMatchObject({
      decision: 'SELECTED',
      layer: 'DECLARING_CLASS',
      combinedScore: 0.3,
    });
    expect(layered.contextTokens).toBeGreaterThan(542);
    expect(layered.contextTokens).toBe(100 + 1239 + 10 * 20);
    expect(layered.selectedChunks).toBe(11);
    // la línea base RANKED reproduce el fallo observado: la clase queda fuera por TOP_K_LIMIT
    expect(decisionOf(ranked, 'AbstractClassMetadataFactory')).toMatchObject({
      decision: 'DISCARDED',
      discardReason: 'TOP_K_LIMIT',
      rank: 21,
    });
    expect(ranked.contextTokens).toBe(100 + 10 * 20);
  });

  it('selects the Money class parts by startLine up to the 4000-token cap (money-c2 shape)', () => {
    const parts = [
      phpCandidate('part-4', { match: 'DECLARING_CLASS', tokens: 1500, startLine: 600, endLine: 800 }),
      phpCandidate('part-2', { match: 'DECLARING_CLASS', tokens: 1500, startLine: 221, endLine: 400 }),
      phpCandidate('part-3', { match: 'DECLARING_CLASS', tokens: 1500, startLine: 401, endLine: 599 }),
      phpCandidate('part-1', { match: 'DECLARING_CLASS', tokens: 1500, startLine: 43, endLine: 220 }),
    ];
    const context = buildPhp([...parts, phpCandidate('sem', { semantic: 0.9, tokens: 50 })]);

    expect(context.relatedChunks.slice(0, 2).map((chunk) => chunk.symbolName)).toEqual(['part-1', 'part-2']);
    expect(decisionOf(context, 'part-1')).toMatchObject({ decision: 'SELECTED', layer: 'DECLARING_CLASS' });
    expect(decisionOf(context, 'part-2')).toMatchObject({ decision: 'SELECTED', layer: 'DECLARING_CLASS' });
    expect(decisionOf(context, 'part-3')).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOKEN_BUDGET' });
    expect(decisionOf(context, 'part-4')).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOKEN_BUDGET' });
    expect(context.contextTokens).toBe(100 + 3000 + 50);
  });
});

describe('ContextBuilder RANKED como línea base (WI-CORE-103)', () => {
  const scenario = () => [
    phpCandidate('declaring', { match: 'DECLARING_CLASS', tokens: 30 }),
    ...Array.from({ length: 12 }, (_, index) =>
      phpCandidate(`sem-${index}`, { semantic: 0.95 - index * 0.02, tokens: 10 }),
    ),
    phpCandidate('weak', { semantic: 0.1 }),
  ];

  it('uses RANKED for TypeScript and an absent language even when LAYERED is configured', () => {
    const builder = new ContextBuilder(makeConfigService({ RETRIEVAL_CONTEXT_STRATEGY: 'LAYERED' }));
    const result = phpResult(scenario());

    const typescript = builder.build(result, phpTarget, { framework: 'VITEST', language: 'typescript' }, { strategy: 'LAYERED' });
    const absent = builder.build(result, phpTarget, { framework: 'VITEST' }, { strategy: 'LAYERED' });

    expect(typescript.audit?.configuration.strategy).toBe('RANKED');
    expect(absent.audit?.configuration.strategy).toBe('RANKED');
    expect(typescript.audit?.candidates.every((candidate) => candidate.layer === null)).toBe(true);
    expect(typescript.selectedChunks).toBe(10);
    expect(
      typescript.audit?.candidates.find((candidate) => candidate.chunkId === 'declaring'),
    ).toMatchObject({ decision: 'DISCARDED', discardReason: 'TOP_K_LIMIT' });
    expect(typescript.relatedChunks).toEqual(absent.relatedChunks);
  });

  it('reproduces the previous behavior when RANKED is set by option or by environment', () => {
    const byOption = buildPhp(scenario(), { strategy: 'RANKED' });
    const byEnv = buildPhp(scenario(), {}, { RETRIEVAL_CONTEXT_STRATEGY: 'RANKED' });
    const typescript = new ContextBuilder(makeConfigService()).build(
      phpResult(scenario()),
      phpTarget,
      { framework: null, language: 'typescript' },
    );

    for (const context of [byOption, byEnv]) {
      expect(context.audit?.configuration.strategy).toBe('RANKED');
      expect(context.relatedChunks).toEqual(typescript.relatedChunks);
      expect(context.audit?.candidates).toEqual(typescript.audit?.candidates);
      expect(context.contextTokens).toBe(typescript.contextTokens);
      expect(context.selectedChunks).toBe(10);
      expect(context.audit?.candidates.map((candidate) => [candidate.rank, candidate.decision, candidate.discardReason])).toEqual(
        typescript.audit?.candidates.map((candidate) => [candidate.rank, candidate.decision, candidate.discardReason]),
      );
    }
    const reasons = new Set(byOption.audit?.candidates.map((candidate) => candidate.discardReason));
    expect(reasons.has('BELOW_RELEVANCE_THRESHOLD')).toBe(false);
    expect(byOption.audit?.candidates.find((candidate) => candidate.chunkId === 'weak')).toMatchObject({
      discardReason: 'TOP_K_LIMIT',
    });
  });
});

describe('ContextBuilder LAYERED con minimumScore (WI-CORE-103)', () => {
  it('discards a structural-only declaring class below minimumScore as BELOW_MINIMUM_SCORE, outside layer 3, within maxContextTokens', () => {
    const context = buildPhp(
      [
        phpCandidate('declaring', { match: 'DECLARING_CLASS', tokens: 50, startLine: 1 }),
        phpCandidate('sem', { semantic: 0.9, tokens: 20 }),
      ],
      { minimumScore: 0.5, maxContextTokens: 200 },
      {},
      [],
      100,
    );

    expect(decisionOf(context, 'declaring')).toMatchObject({
      combinedScore: 0.3,
      decision: 'DISCARDED',
      discardReason: 'BELOW_MINIMUM_SCORE',
      layer: null,
    });
    expect(selectedIds(context)).toEqual(['sem']);
    expect(context.relatedChunks.map((chunk) => chunk.symbolName)).toEqual(['sem']);
    expect(decisionOf(context, 'sem')).toMatchObject({ layer: 'RELEVANT_SEMANTIC' });
    expect(context.contextTokens).toBe(120);
    expect(context.contextTokens).toBeLessThanOrEqual(200);
  });
});
