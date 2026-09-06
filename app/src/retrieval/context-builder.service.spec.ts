import { describe, expect, it } from 'vitest';
import { ContextBuilder } from './context-builder.service.js';
import type { RetrievalCandidate, RetrievalResult } from './retrieval.service.js';
import type { CodeChunk } from '../generated/prisma/client.js';

function makeConfigService(overrides: Record<string, number> = {}) {
  return { get: (key: string, fallback: number) => overrides[key] ?? fallback } as never;
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

function makeCandidate(overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
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
      targetChunks: [makeChunk({ content: 'function foo() { return 1; }', tokenCount: 8 })],
      candidates: [],
    };

    const context = builder.build(result, target, { framework: 'VITEST' });

    expect(context.target.content).toBe('function foo() { return 1; }');
    expect(context.metadata).toEqual({ language: 'typescript', framework: 'VITEST' });
    expect(context.retrievedChunks).toBe(0);
    expect(context.selectedChunks).toBe(0);
    expect(context.contextTokens).toBe(8);
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

    expect(context.relatedChunks.map((chunk) => chunk.filePath)).toEqual(['src/foo.ts', 'src/foo.ts']);
    expect(context.relatedChunks[0].matchedVia).toEqual(['SEMANTIC']);
    expect(context.relatedChunks[1].matchedVia).toEqual(['IMPORTS']);
    // 0.7 * 0.9 (semantic) > 0.3 * 1 (structural) con los pesos default
    expect(context.relatedChunks[0].score).toBeGreaterThan(context.relatedChunks[1].score);
  });

  it('drops candidates below minimumScore', () => {
    const builder = new ContextBuilder(makeConfigService({ RETRIEVAL_MINIMUM_SCORE: 0.5 }));
    const weak = makeCandidate({ semanticScore: 0.1 });
    const result: RetrievalResult = { targetChunks: [makeChunk({ tokenCount: 1 })], candidates: [weak] };

    const context = builder.build(result, target, { framework: null });

    expect(context.relatedChunks).toEqual([]);
    expect(context.retrievedChunks).toBe(1);
    expect(context.selectedChunks).toBe(0);
  });

  it('respects topK even when more candidates pass the score threshold', () => {
    const builder = new ContextBuilder(makeConfigService({ RETRIEVAL_TOP_K: 1 }));
    const first = makeCandidate({ chunk: makeChunk({ id: 'a', tokenCount: 1 }), semanticScore: 0.9 });
    const second = makeCandidate({ chunk: makeChunk({ id: 'b', tokenCount: 1 }), semanticScore: 0.8 });
    const result: RetrievalResult = {
      targetChunks: [makeChunk({ tokenCount: 1 })],
      candidates: [first, second],
    };

    const context = builder.build(result, target, { framework: null });

    expect(context.selectedChunks).toBe(1);
  });

  it('stops adding candidates once maxContextTokens would be exceeded, trying smaller ones after', () => {
    const builder = new ContextBuilder(
      makeConfigService({ RETRIEVAL_MAX_CONTEXT_TOKENS: 15, RETRIEVAL_TOP_K: 10 }),
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
});
