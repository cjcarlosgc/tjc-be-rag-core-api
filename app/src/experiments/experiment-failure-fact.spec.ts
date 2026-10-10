import { describe, expect, it } from 'vitest';
import { toExperimentRepetitionFailure } from './experiment-failure-fact.js';
import type { SandboxFailureFact } from '../sandbox/sandbox.types.js';

const VALID: SandboxFailureFact = {
  stage: 'COMPILING',
  category: 'COMPILATION',
  code: 'TS2304',
  message: "Cannot find name 'foo'",
};

describe('toExperimentRepetitionFailure (WI-CORE-007)', () => {
  it('keeps exactly {stage, category, code, message} from a valid Sandbox fact', () => {
    expect(
      toExperimentRepetitionFailure({ ...VALID, extra: 'ignored' } as unknown as SandboxFailureFact),
    ).toEqual(VALID);
  });

  it('answers null when the Sandbox returned no fact', () => {
    expect(toExperimentRepetitionFailure(null)).toBeNull();
    expect(toExperimentRepetitionFailure(undefined)).toBeNull();
  });

  it('answers null for a stage or category outside the closed sets, without coercion', () => {
    expect(toExperimentRepetitionFailure({ ...VALID, stage: 'BOGUS' } as never)).toBeNull();
    expect(toExperimentRepetitionFailure({ ...VALID, category: 'SOMETHING' } as never)).toBeNull();
    expect(toExperimentRepetitionFailure({ ...VALID, stage: undefined } as never)).toBeNull();
  });

  it('answers null for an empty code and for a code that is only spaces', () => {
    expect(toExperimentRepetitionFailure({ ...VALID, code: '' })).toBeNull();
    expect(toExperimentRepetitionFailure({ ...VALID, code: '   ' })).toBeNull();
  });

  it('answers null when message or code is not text', () => {
    expect(toExperimentRepetitionFailure({ ...VALID, message: 42 } as never)).toBeNull();
    expect(toExperimentRepetitionFailure({ ...VALID, code: 7 } as never)).toBeNull();
  });

  it('truncates code to 64 characters', () => {
    const result = toExperimentRepetitionFailure({ ...VALID, code: 'C'.repeat(100) });
    expect(result?.code).toBe('C'.repeat(64));
  });

  it('redacts secrets in message and truncates it to 500 characters', () => {
    const result = toExperimentRepetitionFailure({
      ...VALID,
      message: `Authorization: Bearer abc.def-123 ${'z'.repeat(600)}`,
    });
    expect(result?.message.startsWith('Authorization: [REDACTED] ')).toBe(true);
    expect(result?.message).not.toContain('abc.def-123');
    expect(result?.message).toHaveLength(500);
  });
});
