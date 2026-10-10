import { describe, expect, it } from 'vitest';
import { computeRetrievalMetrics, type RankedForMetrics } from './retrieval-comparison-metrics.js';

const ranked = (entries: Array<[number, string, string | null]>): RankedForMetrics[] =>
  entries.map(([rank, filePath, symbolQualifiedName]) => ({ rank, filePath, symbolQualifiedName }));

describe('computeRetrievalMetrics', () => {
  it('returns null without ground truth or with an empty one', () => {
    const top = ranked([[1, 'a.ts', 'f']]);

    expect(computeRetrievalMetrics(top, undefined)).toBeNull();
    expect(computeRetrievalMetrics(top, null)).toBeNull();
    expect(computeRetrievalMetrics(top, [])).toBeNull();
  });

  it('computes precision and recall at 5 and 10 with exact (filePath, symbolQualifiedName) matches', () => {
    const top = ranked([
      [1, 'a.ts', 'A.run'],
      [2, 'b.ts', 'b'],
      [3, 'c.ts', 'c'],
      [4, 'd.ts', 'd'],
      [5, 'e.ts', 'e'],
      [6, 'f.ts', 'f'],
      [7, 'g.ts', 'A.run'], // mismo símbolo en otro archivo: no coincide
      [8, 'h.ts', 'h'],
      [9, 'i.ts', 'i'],
      [10, 'a.ts', 'A.other'],
    ]);
    const truth = [
      { filePath: 'a.ts', symbolQualifiedName: 'A.run' }, // hit en top5 y top10
      { filePath: 'a.ts', symbolQualifiedName: 'A.other' }, // hit solo en top10
      { filePath: 'z.ts', symbolQualifiedName: 'missing' }, // no recuperado
    ];

    expect(computeRetrievalMetrics(top, truth)).toEqual({
      precisionAt5: 1 / 5,
      recallAt5: 1 / 3,
      precisionAt10: 2 / 10,
      recallAt10: 2 / 3,
    });
  });

  it('fixes k even when there are fewer candidates than k', () => {
    const metrics = computeRetrievalMetrics(ranked([[1, 'a.ts', 'f']]), [{ filePath: 'a.ts', symbolQualifiedName: 'f' }]);

    expect(metrics).toEqual({ precisionAt5: 1 / 5, recallAt5: 1, precisionAt10: 1 / 10, recallAt10: 1 });
  });

  it('deduplicates the ground truth before counting the recall denominator', () => {
    const metrics = computeRetrievalMetrics(ranked([[1, 'a.ts', 'f']]), [
      { filePath: 'a.ts', symbolQualifiedName: 'f' },
      { filePath: 'a.ts', symbolQualifiedName: 'f' },
    ]);

    expect(metrics?.recallAt10).toBe(1);
  });

  it('never counts a candidate without symbolQualifiedName as a hit', () => {
    const metrics = computeRetrievalMetrics(ranked([[1, 'a.ts', null]]), [{ filePath: 'a.ts', symbolQualifiedName: 'a' }]);

    expect(metrics).toEqual({ precisionAt5: 0, recallAt5: 0, precisionAt10: 0, recallAt10: 0 });
  });

  it('bounds the metrics in [0, 1] when several chunks of the same ground-truth symbol are retrieved', () => {
    const metrics = computeRetrievalMetrics(ranked([[1, 'a.ts', 'f'], [2, 'a.ts', 'f'], [3, 'a.ts', 'f']]), [
      { filePath: 'a.ts', symbolQualifiedName: 'f' },
    ]);

    expect(metrics?.recallAt10).toBe(1);
    expect(metrics?.precisionAt10).toBe(1 / 10);
  });
});
