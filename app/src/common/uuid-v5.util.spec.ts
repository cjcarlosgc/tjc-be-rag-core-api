import { describe, expect, it } from 'vitest';
import { uuidV5 } from './uuid-v5.util.js';

describe('uuidV5', () => {
  it('matches the standard RFC 4122 test vector (DNS namespace, www.example.com)', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('is deterministic: same namespace + name always produces the same id', () => {
    const first = uuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'urn:tjc:sandbox-execution:v1:generation:job-1:target-1');
    const second = uuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'urn:tjc:sandbox-execution:v1:generation:job-1:target-1');

    expect(first).toBe(second);
  });

  it('differs when the name differs', () => {
    const a = uuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'urn:tjc:sandbox-execution:v1:generation:job-1:target-1');
    const b = uuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'urn:tjc:sandbox-execution:v1:generation:job-1:target-2');

    expect(a).not.toBe(b);
  });

  it('sets the version (5) and variant (RFC4122) bits correctly', () => {
    const id = uuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'anything');
    const [, , third, fourth] = id.split('-');

    expect(third[0]).toBe('5');
    expect(['8', '9', 'a', 'b']).toContain(fourth[0]);
  });
});
