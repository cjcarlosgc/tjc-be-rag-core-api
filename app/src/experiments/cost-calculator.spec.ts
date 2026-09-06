import { describe, expect, it } from 'vitest';
import { estimateCost } from './cost-calculator.js';

const rates = { inputCostPer1kTokens: 0.001, outputCostPer1kTokens: 0.002 };

describe('estimateCost', () => {
  it('computes the weighted cost from input/output tokens', () => {
    expect(estimateCost(1000, 500, rates)).toBeCloseTo(0.001 + 0.001, 6);
  });

  it('returns null (not zero) when inputTokens is unknown', () => {
    expect(estimateCost(null, 500, rates)).toBeNull();
  });

  it('returns null (not zero) when outputTokens is unknown', () => {
    expect(estimateCost(1000, null, rates)).toBeNull();
  });
});
