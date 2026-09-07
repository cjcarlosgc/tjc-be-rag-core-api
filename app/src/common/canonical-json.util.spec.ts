import { describe, expect, it } from 'vitest';
import { canonicalJsonStringify } from './canonical-json.util.js';

describe('canonicalJsonStringify', () => {
  it('produces the same string regardless of object key insertion order', () => {
    const a = canonicalJsonStringify({ mode: 'TARGET', projectId: 'p1', targetId: 't1' });
    const b = canonicalJsonStringify({ targetId: 't1', mode: 'TARGET', projectId: 'p1' });

    expect(a).toBe(b);
  });

  it('sorts keys recursively in nested objects', () => {
    const a = canonicalJsonStringify({ outer: { z: 1, a: 2 } });
    const b = canonicalJsonStringify({ outer: { a: 2, z: 1 } });

    expect(a).toBe(b);
  });

  it('preserves array order (order-significant)', () => {
    const a = canonicalJsonStringify({ items: [1, 2, 3] });
    const b = canonicalJsonStringify({ items: [3, 2, 1] });

    expect(a).not.toBe(b);
  });

  it('omits undefined-valued keys, same as JSON.stringify, without coercing them to null', () => {
    const withUndefined = canonicalJsonStringify({ projectId: 'p1', targetId: undefined });
    const withoutField = canonicalJsonStringify({ projectId: 'p1' });
    const withNull = canonicalJsonStringify({ projectId: 'p1', targetId: null });

    expect(withUndefined).toBe(withoutField);
    expect(withUndefined).not.toBe(withNull);
  });

  it('differs when a value differs', () => {
    const a = canonicalJsonStringify({ projectId: 'p1' });
    const b = canonicalJsonStringify({ projectId: 'p2' });

    expect(a).not.toBe(b);
  });
});
