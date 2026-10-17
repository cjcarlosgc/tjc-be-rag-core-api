import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.util.js';

describe('mapWithConcurrency', () => {
  it('keeps the input order and never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 8 - value));
      active -= 1;
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
  });

  it('returns an empty list without running the worker', async () => {
    await expect(mapWithConcurrency([], 5, () => Promise.reject(new Error('no'))))
      .resolves.toEqual([]);
  });
});
