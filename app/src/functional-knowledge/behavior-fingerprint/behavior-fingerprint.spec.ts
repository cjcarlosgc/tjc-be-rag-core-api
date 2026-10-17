import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  diffBehaviorConstructs,
  extractBehaviorConstructs,
  scenarioKeyFor,
  type BehaviorConstruct,
} from './behavior-fingerprint.js';

const ACCOUNT_SOURCE = `
class Account {
  private balance = 0;
  constructor(private limit: number) {}
  withdraw(amount: number): number {
    if (amount <= 0) {
      throw new Error('invalid');
    }
    const next = this.balance - amount;
    if (next < -this.limit) throw new RangeError('limit');
    this.balance = next;
    return this.balance;
  }
}
`;

function kindsOf(source: string, qualifiedName: string): string[] {
  return extractBehaviorConstructs(source, qualifiedName).map(
    (construct) => construct.scenarioKind,
  );
}

function hashesOf(source: string, qualifiedName: string): string[] {
  return extractBehaviorConstructs(source, qualifiedName).map(
    (construct) => construct.formHash,
  );
}

function construct(
  overrides: Partial<BehaviorConstruct> = {},
): BehaviorConstruct {
  return {
    scenarioKind: 'EXPECTED_RESULT',
    form: 'IfStatement(Id:x)',
    formHash: createHash('sha256')
      .update('IfStatement(Id:x)', 'utf8')
      .digest('hex'),
    order: 0,
    snippet: 'if (x)',
    ...overrides,
  };
}

describe('extractBehaviorConstructs', () => {
  it('classifies each qualifying construct with the expected scenarioKind', () => {
    const constructs = extractBehaviorConstructs(
      ACCOUNT_SOURCE,
      'Account.withdraw',
    );

    expect(constructs.map((item) => item.scenarioKind)).toEqual([
      'BOUNDARY',
      'EXCEPTION',
      'BOUNDARY',
      'EXCEPTION',
      'STATE_TRANSITION',
    ]);
    expect(constructs.map((item) => item.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('uses EXPECTED_RESULT for branches whose condition has no comparison operator', () => {
    const source = `
      function status(flag: boolean, code: number) {
        if (flag === true) { return 'on'; }
        return code === 1 ? 'one' : 'other';
      }
    `;

    expect(kindsOf(source, 'status')).toEqual([
      'EXPECTED_RESULT',
      'EXPECTED_RESULT',
    ]);
  });

  it('classifies a ternary with a comparison as BOUNDARY and a switch as EXPECTED_RESULT', () => {
    const source = `
      function grade(score: number, kind: string) {
        const label = score >= 50 ? 'pass' : 'fail';
        switch (kind) {
          case 'a': return label;
          default: return 'none';
        }
      }
    `;

    expect(kindsOf(source, 'grade')).toEqual(['BOUNDARY', 'EXPECTED_RESULT']);
  });

  it('detects member writes, compound assignments and update operators on members', () => {
    const source = `
      class Counter {
        total = 0;
        bump(amount: number, box: { value: number }, slots: number[], key: number) {
          this.total += amount;
          box.value = 1;
          slots[key] = 2;
          this.total++;
          --box.value;
        }
      }
    `;

    expect(kindsOf(source, 'Counter.bump')).toEqual([
      'STATE_TRANSITION',
      'STATE_TRANSITION',
      'STATE_TRANSITION',
      'STATE_TRANSITION',
      'STATE_TRANSITION',
    ]);
  });

  it('detects assignments and updates to variables that are not declared in the symbol', () => {
    const source = `
      let globalCounter = 0;
      function bump(step: number) {
        globalCounter = globalCounter + step;
        globalCounter++;
        globalCounter *= 2;
      }
    `;

    expect(kindsOf(source, 'bump')).toEqual([
      'STATE_TRANSITION',
      'STATE_TRANSITION',
      'STATE_TRANSITION',
    ]);
  });

  it('does not produce constructs for writes to locals or parameters', () => {
    const source = `
      function compute(input: number) {
        let total = 0;
        const items = [input];
        for (const item of items) {
          total += item;
        }
        input = input + 1;
        input++;
        return total;
      }
    `;

    expect(extractBehaviorConstructs(source, 'compute')).toEqual([]);
  });

  it('does not produce constructs for getters, pure delegations or returns alone', () => {
    const source = `
      class Facade {
        private _value = 1;
        get value(): number { return this._value; }
        delegate(input: number) { return helper(input); }
        only(input: number) { return input * 2; }
      }
      function helper(input: number) { return input; }
    `;

    expect(extractBehaviorConstructs(source, 'Facade.value')).toEqual([]);
    expect(extractBehaviorConstructs(source, 'Facade.delegate')).toEqual([]);
    expect(extractBehaviorConstructs(source, 'Facade.only')).toEqual([]);
  });

  it('keeps the fingerprint stable under formatting, quotes, parentheses and comments', () => {
    const compact = `
      class Shop {
        apply(price: number, state: string) {
          if (price<=0) throw new Error("bad price");
          if (state === 'open') { this.total = price; }
        }
      }
    `;
    const reformatted = `
      class Shop {
        apply(price: number, state: string) {
          // leading comment
          if ( ( price <= 0 ) ) {
            /* block comment */
            throw new Error('bad price') // trailing
          }
          if ((state === "open")) {
            this.total   =   price;
          }
        }
      }
    `;

    expect(hashesOf(reformatted, 'Shop.apply')).toEqual(
      hashesOf(compact, 'Shop.apply'),
    );
    expect(hashesOf(compact, 'Shop.apply')).toHaveLength(4);
  });

  it('keeps the fingerprint stable when local variables are renamed', () => {
    const original = `
      function price(amount: number) {
        const discount = amount > 100 ? 10 : 0;
        if (discount > 5) throw new Error('too big');
        return amount - discount;
      }
    `;
    const renamed = `
      function price(amount: number) {
        const reduction = amount > 100 ? 10 : 0;
        if (reduction > 5) throw new Error('too big');
        return amount - reduction;
      }
    `;

    expect(hashesOf(renamed, 'price')).toEqual(hashesOf(original, 'price'));
  });

  it('keeps the fingerprint stable when a return inside an existing branch changes', () => {
    const original = `
      function pick(value: number) {
        if (value === 1) { return 'one'; }
        return 'other';
      }
    `;
    const changedReturn = `
      function pick(value: number) {
        if (value === 1) { return 'uno'; }
        return 'otro';
      }
    `;

    expect(hashesOf(changedReturn, 'pick')).toEqual(hashesOf(original, 'pick'));
  });

  it('changes the fingerprint when the condition, operator or literal changes', () => {
    const base = hashesOf(
      `function f(x: number) { if (x <= 0) throw new Error('e'); }`,
      'f',
    );
    const otherLiteral = hashesOf(
      `function f(x: number) { if (x <= 1) throw new Error('e'); }`,
      'f',
    );
    const otherOperator = hashesOf(
      `function f(x: number) { if (x < 0) throw new Error('e'); }`,
      'f',
    );
    const otherCondition = hashesOf(
      `function f(y: number) { if (y <= 0) throw new Error('e'); }`,
      'f',
    );

    expect(otherLiteral).not.toEqual(base);
    expect(otherOperator).not.toEqual(base);
    expect(otherCondition).not.toEqual(base);
  });

  it('changes the fingerprint when a parameter name or a member name changes', () => {
    const base = hashesOf(
      `class A { run(amount: number) { this.balance = amount; } }`,
      'A.run',
    );
    const otherParameter = hashesOf(
      `class A { run(value: number) { this.balance = value; } }`,
      'A.run',
    );
    const otherMember = hashesOf(
      `class A { run(amount: number) { this.saldo = amount; } }`,
      'A.run',
    );

    expect(otherParameter).not.toEqual(base);
    expect(otherMember).not.toEqual(base);
  });

  it('returns constructs for a constructor and a class method, and for a free function', () => {
    const source = `
      class Box {
        constructor(private size: number) {
          if (size < 0) throw new Error('negative');
          this.size = size;
        }
        grow(by: number) {
          this.size += by;
        }
      }
      function clamp(value: number, max: number) {
        if (value > max) { return max; }
        return value;
      }
    `;

    expect(kindsOf(source, 'Box.constructor')).toEqual([
      'BOUNDARY',
      'EXCEPTION',
      'STATE_TRANSITION',
    ]);
    expect(kindsOf(source, 'Box.grow')).toEqual(['STATE_TRANSITION']);
    expect(kindsOf(source, 'clamp')).toEqual(['BOUNDARY']);
  });

  it('uses the implementation declaration when the symbol has overloads', () => {
    const source = `
      function pick(value: string): string;
      function pick(value: any) {
        if (value === 1) return 'x';
        return value;
      }
    `;

    expect(kindsOf(source, 'pick')).toEqual(['EXPECTED_RESULT']);
  });

  it('returns an empty list for a missing symbol or invalid TypeScript and never throws', () => {
    expect(
      extractBehaviorConstructs(ACCOUNT_SOURCE, 'Account.missing'),
    ).toEqual([]);
    expect(
      extractBehaviorConstructs(ACCOUNT_SOURCE, 'Missing.withdraw'),
    ).toEqual([]);
    expect(
      extractBehaviorConstructs(ACCOUNT_SOURCE, 'missingFunction'),
    ).toEqual([]);
    expect(extractBehaviorConstructs('class A { m( { if (', 'A.m')).toEqual([]);
    expect(() => extractBehaviorConstructs('function ((', 'x')).not.toThrow();
  });

  it('is deterministic and keeps snippets in one line of at most 160 characters', () => {
    const longCondition = Array.from(
      { length: 60 },
      (_, index) => `value === ${index}`,
    ).join(' ||\n   ');
    const source = `function longer(value: number) {\n  if (${longCondition}) throw new Error('x');\n}`;

    const first = extractBehaviorConstructs(source, 'longer');
    const second = extractBehaviorConstructs(source, 'longer');

    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first[0].snippet.length).toBeLessThanOrEqual(160);
    expect(first[0].snippet).not.toContain('\n');
    expect(first[0].formHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first[0].formHash).toBe(
      createHash('sha256').update(first[0].form, 'utf8').digest('hex'),
    );
  });
});

describe('diffBehaviorConstructs', () => {
  const a = construct({ form: 'A', formHash: 'hash-a', order: 0 });
  const b = construct({
    form: 'B',
    formHash: 'hash-b',
    order: 1,
    scenarioKind: 'EXCEPTION',
  });
  const c = construct({ form: 'C', formHash: 'hash-c', order: 2 });

  it('returns every head construct when the base is empty', () => {
    expect(diffBehaviorConstructs([], [a, b])).toEqual([a, b]);
  });

  it('returns nothing when base and head have the same fingerprints', () => {
    expect(diffBehaviorConstructs([a, b], [a, b])).toEqual([]);
  });

  it('returns new and modified constructs but not removed ones, in head order', () => {
    const modified = construct({ form: 'B2', formHash: 'hash-b2', order: 0 });

    expect(diffBehaviorConstructs([a, b], [modified, a, c])).toEqual([
      modified,
      c,
    ]);
  });

  it('deduplicates by formHash keeping the first occurrence', () => {
    const duplicate = construct({ form: 'C', formHash: 'hash-c', order: 5 });

    expect(diffBehaviorConstructs([], [c, a, duplicate])).toEqual([c, a]);
  });
});

describe('scenarioKeyFor', () => {
  const sample = construct({
    scenarioKind: 'BOUNDARY',
    form: 'IfStatement(Id:x)',
  });

  it('is deterministic, prefixed by the kind and followed by 16 hexadecimal characters', () => {
    const key = scenarioKeyFor('src/a.ts::Account.withdraw', sample);

    expect(key).toBe(scenarioKeyFor('src/a.ts::Account.withdraw', sample));
    expect(key).toMatch(/^BOUNDARY:[0-9a-f]{16}$/);
  });

  it('follows DEC-FK-004: sha256(targetRef + newline + form) truncated to 16 hex characters', () => {
    const expected = createHash('sha256')
      .update('src/a.ts::Account.withdraw\nIfStatement(Id:x)', 'utf8')
      .digest('hex')
      .slice(0, 16);

    expect(scenarioKeyFor('src/a.ts::Account.withdraw', sample)).toBe(
      `BOUNDARY:${expected}`,
    );
  });

  it('changes when the targetRef changes', () => {
    expect(scenarioKeyFor('src/a.ts::Account.withdraw', sample)).not.toBe(
      scenarioKeyFor('src/a.ts::Account.deposit', sample),
    );
  });
});
