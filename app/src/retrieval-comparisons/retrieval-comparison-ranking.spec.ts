import { describe, expect, it } from 'vitest';
import type { CodeChunk } from '../generated/prisma/client.js';
import type { RetrievalCandidate } from '../retrieval/retrieval.service.js';
import { COMPARISON_FINAL_TOP_K, rankComparisonCandidates, symbolQualifiedNameOf } from './retrieval-comparison-ranking.js';

function chunk(id: string, overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id,
    filePath: `src/${id}.ts`,
    symbolKind: 'FUNCTION',
    symbolName: id,
    parentSymbolName: null,
    ...overrides,
  } as CodeChunk;
}

function candidate(id: string, semanticScore: number | null, structuralMatch: RetrievalCandidate['structuralMatch'] = null): RetrievalCandidate {
  return { chunk: chunk(id), semanticScore, structuralMatch };
}

/** Score de prueba con la forma del producto: 0.7·semántico + 0.3·estructural. */
const score = (c: RetrievalCandidate) => 0.7 * (c.semanticScore ?? 0) + 0.3 * (c.structuralMatch ? 1 : 0);

describe('symbolQualifiedNameOf', () => {
  it('uses parent.symbol for methods, symbol alone for functions, and null without a name', () => {
    expect(symbolQualifiedNameOf({ symbolName: 'greet', parentSymbolName: 'Greeter' })).toBe('Greeter.greet');
    expect(symbolQualifiedNameOf({ symbolName: 'foo', parentSymbolName: null })).toBe('foo');
    expect(symbolQualifiedNameOf({ symbolName: null, parentSymbolName: 'Greeter' })).toBeNull();
  });
});

describe('rankComparisonCandidates (SE)', () => {
  it('orders by combined score desc, then semanticScore desc, then chunkId asc', () => {
    const ranked = rankComparisonCandidates(
      [
        candidate('b', 0.5),
        candidate('a', 0.5),
        candidate('c', 0.9, 'IMPORTS'),
        candidate('d', null, 'IMPORTED_BY'),
      ],
      'SE',
      score,
    );

    expect(ranked.map((entry) => entry.chunkId)).toEqual(['c', 'a', 'b', 'd']);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
  });

  it('breaks an exact combined-score tie by semanticScore before chunkId', () => {
    // scoreOf constante fuerza un empate exacto de score combinado: decide semanticScore antes que chunkId.
    const ranked = rankComparisonCandidates([candidate('z', 0.2), candidate('m', 0.6)], 'SE', () => 0.3);

    expect(ranked.map((entry) => entry.chunkId)).toEqual(['m', 'z']);
  });

  it('puts a structural-only candidate after a semantic one with the same combined score', () => {
    const ranked = rankComparisonCandidates(
      [candidate('struct', null, 'IMPORTS'), candidate('sem', 0.1)],
      'SE',
      () => 0.3,
    );

    expect(ranked.map((entry) => entry.chunkId)).toEqual(['sem', 'struct']);
  });

  it('marks selected = rank <= 10 and reports combinedScore and structuralMatch', () => {
    const many = Array.from({ length: 12 }, (_, index) => candidate(`c${String(index).padStart(2, '0')}`, 1 - index / 100));
    const ranked = rankComparisonCandidates(many, 'SE', score);

    expect(ranked).toHaveLength(12);
    expect(ranked.filter((entry) => entry.selected)).toHaveLength(COMPARISON_FINAL_TOP_K);
    expect(ranked.at(9)?.selected).toBe(true);
    expect(ranked.at(10)?.selected).toBe(false);
    expect(ranked[0]).toMatchObject({ rank: 1, filePath: 'src/c00.ts', semanticScore: 1, structuralMatch: null });
    expect(ranked[0].combinedScore).toBeCloseTo(0.7);
  });

  it('keeps the structural match of a candidate that is also semantic', () => {
    const [entry] = rankComparisonCandidates([candidate('x', 0.8, 'IMPORTED_BY')], 'SE', score);

    expect(entry).toMatchObject({ structuralMatch: 'IMPORTED_BY', semanticScore: 0.8 });
  });
});

describe('rankComparisonCandidates (SEM)', () => {
  it('uses only semantic candidates, ordered by semanticScore, with no structural relation and no combinedScore', () => {
    const ranked = rankComparisonCandidates(
      [candidate('low', 0.2), candidate('struct', null, 'IMPORTS'), candidate('high', 0.9, 'IMPORTS'), candidate('mid', 0.5)],
      'SEM',
      score,
    );

    expect(ranked.map((entry) => entry.chunkId)).toEqual(['high', 'mid', 'low']);
    expect(ranked.every((entry) => entry.structuralMatch === null)).toBe(true);
    expect(ranked.every((entry) => entry.combinedScore === null)).toBe(true);
    expect(ranked.map((entry) => entry.semanticScore)).toEqual([0.9, 0.5, 0.2]);
  });

  it('ignores the structural boost: a structural-only candidate never ranks in SEM', () => {
    const ranked = rankComparisonCandidates([candidate('s', null, 'IMPORTS')], 'SEM', score);

    expect(ranked).toEqual([]);
  });

  it('selects the first 10 of the semantic candidates', () => {
    const semantic = Array.from({ length: 20 }, (_, index) => candidate(`s${String(index).padStart(2, '0')}`, 1 - index / 100));
    const ranked = rankComparisonCandidates(semantic, 'SEM', score);

    expect(ranked.filter((entry) => entry.selected).map((entry) => entry.chunkId)).toEqual(
      semantic.slice(0, 10).map((entry) => entry.chunk.id),
    );
  });
});
