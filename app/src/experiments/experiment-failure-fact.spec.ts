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

  describe('code (WI-CORE-027, DEC-EVID-004): forma validada, sin truncar ni redactar', () => {
    it('keeps a code of exactly 64 characters of the allowed alphabet', () => {
      const code = `E_${'C'.repeat(62)}`;
      expect(code).toHaveLength(64);
      expect(toExperimentRepetitionFailure({ ...VALID, code })?.code).toBe(code);
    });

    it('answers null for a code longer than 64 characters, without truncating it', () => {
      expect(toExperimentRepetitionFailure({ ...VALID, code: 'C'.repeat(100) })).toBeNull();
      expect(toExperimentRepetitionFailure({ ...VALID, code: 'C'.repeat(65) })).toBeNull();
    });

    it('accepts identifiers with letters, digits, dot, colon, dash and underscore', () => {
      for (const code of ['TS2304', 'NPM_INSTALL_FAILED', 'E1.2:x-y', ' TS2304 ']) {
        expect(toExperimentRepetitionFailure({ ...VALID, code })?.code).toBe(code.trim());
      }
    });

    it('answers null for a code with characters outside the alphabet, not redacted', () => {
      for (const code of ['TS 2304', 'a/b', 'code=1', 'línea', 'x\ny', 'a"b']) {
        expect(toExperimentRepetitionFailure({ ...VALID, code })).toBeNull();
      }
    });

    it('answers null for a code that has the shape of a secret', () => {
      expect(toExperimentRepetitionFailure({ ...VALID, code: 'ghp_0123456789abcdefABCDEF' })).toBeNull();
      expect(toExperimentRepetitionFailure({ ...VALID, code: 'sk-abcdefgh1234' })).toBeNull();
    });
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
