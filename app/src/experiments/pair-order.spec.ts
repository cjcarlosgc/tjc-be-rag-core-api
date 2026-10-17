import { describe, expect, it } from 'vitest';
import {
  experimentPairId,
  generateRandomizationSeed,
  pairOrder,
} from './pair-order.js';

const SEED_A = '0'.repeat(64);

function findSeedWithOrder(first: 'RAG' | 'GENERALIST_AGENT'): string {
  for (let n = 0; n < 1000; n++) {
    const seed = `seed-${n}`;
    if (pairOrder(seed, 1)[0] === first) return seed;
  }
  throw new Error('no seed found');
}

describe('pairOrder (WI-CORE-025)', () => {
  it('matches the fixed vectors (SHA-256 of seed:i, parity of the first uint32)', () => {
    // 'abc:1' -> readUInt32BE(0) = 3218017180 (even) => RAG first.
    expect(pairOrder('abc', 1)).toEqual(['RAG', 'GENERALIST_AGENT']);
    // 'abc:2' -> 373645064 (even) => RAG first.
    expect(pairOrder('abc', 2)).toEqual(['RAG', 'GENERALIST_AGENT']);
    // 'abc:3' -> 268096270 (even) => RAG first.
    expect(pairOrder('abc', 3)).toEqual(['RAG', 'GENERALIST_AGENT']);
    // 'seed-0:1' -> readUInt32BE(0) = 31717841 (odd) => inverse order.
    expect(pairOrder('seed-0', 1)).toEqual(['GENERALIST_AGENT', 'RAG']);
  });

  it('is deterministic: the same seed and index always yield the same order', () => {
    for (const i of [1, 2, 3]) {
      expect(pairOrder(SEED_A, i)).toEqual(pairOrder(SEED_A, i));
    }
  });

  it('returns a permutation of both strategies', () => {
    for (const i of [1, 2, 3]) {
      expect([...pairOrder('some-seed', i)].sort()).toEqual(['GENERALIST_AGENT', 'RAG']);
    }
  });

  it('makes both orders reachable across seeds', () => {
    expect(pairOrder(findSeedWithOrder('RAG'), 1)[0]).toBe('RAG');
    expect(pairOrder(findSeedWithOrder('GENERALIST_AGENT'), 1)[0]).toBe('GENERALIST_AGENT');
  });
});

describe('experimentPairId (WI-CORE-025)', () => {
  const EXP = '11111111-2222-4333-8444-555555555555';

  it('is a stable UUID v5 for the experiment and pair index', () => {
    const a = experimentPairId(EXP, 1);
    expect(a).toBe(experimentPairId(EXP, 1));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('differs between pair indexes and between experiments', () => {
    expect(experimentPairId(EXP, 1)).not.toBe(experimentPairId(EXP, 2));
    expect(experimentPairId(EXP, 1)).not.toBe(experimentPairId('99999999-2222-4333-8444-555555555555', 1));
  });
});

describe('generateRandomizationSeed (WI-CORE-025)', () => {
  it('returns 64 lowercase hex characters, distinct across calls', () => {
    const a = generateRandomizationSeed();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateRandomizationSeed()).not.toBe(a);
  });
});
