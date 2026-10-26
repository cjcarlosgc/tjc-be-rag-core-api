import { describe, expect, it, vi } from 'vitest';
import type { CodeChunk } from '../generated/prisma/client.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import type { RetrievalCandidate } from '../retrieval/retrieval.service.js';
import { rankComparisonCandidates } from './retrieval-comparison-ranking.js';

/**
 * Prueba dorada de OE2 (WI-CORE-103): el ranking, los pesos y el score del retrieval no cambian con la
 * estrategia por capas del ContextBuilder. Los valores literales son los que producía el código antes del
 * WI; si cambian, la comparación OE2 dejó de ser comparable.
 */

function chunk(id: string, overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id,
    projectVersionId: 'version-1',
    filePath: `src/${id}.php`,
    symbolKind: 'METHOD',
    symbolName: id,
    parentSymbolName: 'Money',
    startLine: 1,
    endLine: 5,
    content: `// ${id}`,
    importsUsed: [],
    tokenCount: 10,
    partIndex: 1,
    partsTotal: 1,
    createdAt: new Date(0),
    ...overrides,
  } as CodeChunk;
}

const FIXED: RetrievalCandidate[] = [
  { chunk: chunk('alpha'), semanticScore: 0.9, structuralMatch: null },
  { chunk: chunk('beta'), semanticScore: 0.5, structuralMatch: 'IMPORTS' },
  { chunk: chunk('gamma'), semanticScore: null, structuralMatch: 'DECLARING_CLASS' },
  { chunk: chunk('delta'), semanticScore: 0.7, structuralMatch: 'SAME_NAMESPACE' },
  { chunk: chunk('epsilon'), semanticScore: 0.2, structuralMatch: null },
  { chunk: chunk('zeta'), semanticScore: null, structuralMatch: 'IMPORTED_BY' },
];

function builder(env: Record<string, unknown> = {}) {
  return new ContextBuilder({ get: (key: string, fallback: unknown) => env[key] ?? fallback } as never);
}

describe('OE2 golden: pesos y score no cambian con LAYERED/RANKED (WI-CORE-103)', () => {
  it('resolveWeights keeps 0.7/0.3 and ignores the context strategy variables', () => {
    for (const env of [
      {},
      { RETRIEVAL_CONTEXT_STRATEGY: 'LAYERED', RETRIEVAL_RELEVANCE_THRESHOLD: 0.9 },
      { RETRIEVAL_CONTEXT_STRATEGY: 'RANKED', RETRIEVAL_DECLARING_CLASS_MAX_TOKENS: 1 },
    ]) {
      expect(builder(env).resolveWeights()).toEqual({ semanticWeight: 0.7, structuralWeight: 0.3 });
    }
  });

  it('scoreCandidate returns the same literal scores as before', () => {
    const context = builder();
    const weights = context.resolveWeights();

    expect(FIXED.map((candidate) => context.scoreCandidate(weights, candidate.semanticScore, candidate.structuralMatch))).toEqual([
      0.7 * 0.9,
      0.7 * 0.5 + 0.3,
      0.3,
      0.7 * 0.7 + 0.3,
      0.7 * 0.2,
      0.3,
    ]);
    expect(context.scoreCandidate(weights, 0.9, null)).toBeCloseTo(0.63, 12);
    expect(context.scoreCandidate(weights, null, 'DECLARING_CLASS')).toBeCloseTo(0.3, 12);
    expect(context.scoreCandidate({ semanticWeight: 0.5, structuralWeight: 0.5 }, 0.4, 'IMPORTS')).toBeCloseTo(0.7, 12);
  });

  it('the SE and SEM comparison rankings keep the exact order, ranks and selection', () => {
    const context = builder({ RETRIEVAL_CONTEXT_STRATEGY: 'LAYERED' });
    const weights = context.resolveWeights();
    const scoreOf = (candidate: RetrievalCandidate) =>
      context.scoreCandidate(weights, candidate.semanticScore, candidate.structuralMatch);

    const se = rankComparisonCandidates(FIXED, 'SE', scoreOf);
    const sem = rankComparisonCandidates(FIXED, 'SEM', scoreOf);

    expect(se.map((entry) => [entry.rank, entry.chunkId, entry.structuralMatch, entry.selected])).toEqual([
      [1, 'delta', 'SAME_NAMESPACE', true],
      [2, 'beta', 'IMPORTS', true],
      [3, 'alpha', null, true],
      [4, 'gamma', 'DECLARING_CLASS', true],
      [5, 'zeta', 'IMPORTED_BY', true],
      [6, 'epsilon', null, true],
    ]);
    const expectedScores = [0.79, 0.65, 0.63, 0.3, 0.3, 0.14];
    se.forEach((entry, index) => expect(entry.combinedScore).toBeCloseTo(expectedScores[index], 12));
    expect(sem.map((entry) => [entry.rank, entry.chunkId, entry.structuralMatch, entry.combinedScore, entry.selected])).toEqual([
      [1, 'alpha', null, null, true],
      [2, 'delta', null, null, true],
      [3, 'beta', null, null, true],
      [4, 'epsilon', null, null, true],
    ]);
  });

  it('retrieve keeps the RetrievalResult shape: targetChunks and candidates with chunk, semanticScore and structuralMatch', async () => {
    const anchor = chunk('anchor', { filePath: 'src/greeter.ts', symbolName: 'greet', parentSymbolName: 'Greeter' });
    const semanticMatch = chunk('semantic-1', { filePath: 'src/other.ts' });
    const service = new RetrievalService({
      findBySymbol: vi.fn().mockResolvedValue([anchor]),
      findSimilarByEmbedding: vi.fn().mockResolvedValue([{ ...semanticMatch, semanticScore: 0.8 }]),
      findByProjectVersion: vi.fn().mockResolvedValue([anchor, semanticMatch]),
    } as never);

    const result = await service.retrieve('version-1', {
      filePath: 'src/greeter.ts',
      symbolName: 'Greeter',
      methodName: 'greet',
      targetType: 'METHOD',
    });

    expect(Object.keys(result).sort()).toEqual(['candidates', 'targetChunks']);
    expect(result.targetChunks).toEqual([anchor]);
    expect(result.candidates).toHaveLength(1);
    expect(Object.keys(result.candidates[0]).sort()).toEqual(['chunk', 'semanticScore', 'structuralMatch']);
    expect(result.candidates[0].semanticScore).toBe(0.8);
    expect(result.candidates[0].structuralMatch).toBeNull();
    expect(result.candidates[0].chunk.id).toBe('semantic-1');
  });
});
