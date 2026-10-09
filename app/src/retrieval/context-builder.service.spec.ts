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

function makeConfigService(overrides: Record<string, number> = {}) {
  return {
    get: (key: string, fallback: number) => overrides[key] ?? fallback,
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
      maxContextTokens: 6000,
      semanticWeight: 0.7,
      structuralWeight: 0.3,
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
