import { describe, expect, it } from 'vitest';
import {
  buildSandboxEvidenceFacts,
  SANDBOX_EVIDENCE_FACT_KEYS,
  toAcceptedSandboxEvidence,
  toSandboxExecutionEvidence,
  type SandboxEvidenceInput,
} from './sandbox-evidence-facts.js';
import { SandboxAcceptedExecutionError } from './sandbox-execution.service.js';
import type { RunnerFacts, SandboxExecutionResult } from './sandbox.types.js';

const SECRET_LINE = 'token=abc123secret';

const RUNNER_FACTS: RunnerFacts = {
  runner: 'JEST',
  compiled: true,
  executed: true,
  passed: false,
  totalTests: 3,
  passedTests: 2,
  failedTests: 1,
  skippedTests: 0,
  testCases: [
    { suitePath: 'suite', name: 'falla', status: 'FAILED', durationMs: 4, errorMessage: `expected 1 ${SECRET_LINE}` },
  ],
  testCasesTruncated: true,
};

const FAILURE_FACT = {
  stage: 'COMPILING' as const,
  category: 'COMPILATION' as const,
  code: 'TS2304',
  message: `Cannot find name 'foo' ${SECRET_LINE}`,
};

function input(overrides: Partial<SandboxEvidenceInput> = {}): SandboxEvidenceInput {
  return {
    executionProfile: 'NODE_TYPESCRIPT',
    status: 'COMPLETED',
    facts: RUNNER_FACTS,
    failureType: 'TEST_ASSERTION',
    failure: null,
    ...overrides,
  };
}

function resultOf(overrides: Partial<SandboxExecutionResult> = {}): SandboxExecutionResult {
  return {
    status: 'COMPLETED',
    facts: RUNNER_FACTS,
    failure: null,
    stageDurations: [],
    executionId: 'exec-1',
    executionProfile: 'NODE_TYPESCRIPT',
    requestId: 'req-1',
    correlationId: 'corr-1',
    durationMs: 12,
    ...overrides,
  };
}

describe('sandbox evidence facts (WI-CORE-027, DEC-EVID-003)', () => {
  it('declares exactly the 14 closed keys of §6.16 in their contract order', () => {
    expect([...SANDBOX_EVIDENCE_FACT_KEYS]).toEqual([
      'executionProfile',
      'runner',
      'compiled',
      'executed',
      'passed',
      'totalTests',
      'passedTests',
      'failedTests',
      'skippedTests',
      'testCasesTruncated',
      'failureStage',
      'failureCategory',
      'failureCode',
      'failureMessage',
    ]);
  });

  it('builds an object with exactly the closed keys and never with testCases or their messages', () => {
    const facts = buildSandboxEvidenceFacts(input());

    expect(Object.keys(facts).sort()).toEqual([...SANDBOX_EVIDENCE_FACT_KEYS].sort());
    expect(JSON.stringify(facts)).not.toContain('"testCases"');
    expect(JSON.stringify(facts)).not.toContain(SECRET_LINE);
    expect(JSON.stringify(facts)).not.toContain('falla');
  });

  it('copies only counts and flags, mapped one by one', () => {
    expect(buildSandboxEvidenceFacts(input())).toEqual({
      executionProfile: 'NODE_TYPESCRIPT',
      runner: 'JEST',
      compiled: true,
      executed: true,
      passed: false,
      totalTests: 3,
      passedTests: 2,
      failedTests: 1,
      skippedTests: 0,
      testCasesTruncated: true,
      failureStage: null,
      failureCategory: 'TEST_ASSERTION',
      failureCode: null,
      failureMessage: null,
    });
  });

  it('keeps the PHPUNIT runner reported by the Sandbox (WI-CORE-029) and nulls any other runner', () => {
    expect(buildSandboxEvidenceFacts(input({ facts: { ...RUNNER_FACTS, runner: 'PHPUNIT' } })).runner).toBe('PHPUNIT');
    expect(buildSandboxEvidenceFacts(input({ facts: { ...RUNNER_FACTS, runner: 'PEST' as never } })).runner).toBeNull();
  });

  it('answers null for every count or flag that is not an observed value, never zero', () => {
    const facts = buildSandboxEvidenceFacts(
      input({
        facts: {
          ...RUNNER_FACTS,
          runner: 'MOCHA' as never,
          compiled: 'yes' as never,
          totalTests: -1,
          passedTests: 1.5,
          failedTests: undefined as never,
          skippedTests: Number.NaN,
          testCasesTruncated: null as never,
        },
      }),
    );

    expect(facts).toMatchObject({
      runner: null,
      compiled: null,
      totalTests: null,
      passedTests: null,
      failedTests: null,
      skippedTests: null,
      testCasesTruncated: null,
    });
  });

  it('answers null for every field when there are no facts (sandbox never reported a result)', () => {
    const facts = buildSandboxEvidenceFacts(input({ status: 'TIMED_OUT', facts: null, failureType: 'INFRASTRUCTURE' }));

    expect(facts).toEqual({
      executionProfile: 'NODE_TYPESCRIPT',
      runner: null,
      compiled: null,
      executed: null,
      passed: null,
      totalTests: null,
      passedTests: null,
      failedTests: null,
      skippedTests: null,
      testCasesTruncated: null,
      failureStage: null,
      failureCategory: null,
      failureCode: null,
      failureMessage: null,
    });
  });

  it('takes the failure category from the mapped failureType only for COMPLETED with failing tests (DEC-EVID-006)', () => {
    expect(buildSandboxEvidenceFacts(input({ failureType: 'COMPILATION' })).failureCategory).toBe('COMPILATION');
    expect(buildSandboxEvidenceFacts(input({ failureType: 'NONE' })).failureCategory).toBeNull();
    expect(
      buildSandboxEvidenceFacts(input({ facts: { ...RUNNER_FACTS, passed: true }, failureType: 'NONE' })).failureCategory,
    ).toBeNull();
    expect(buildSandboxEvidenceFacts(input({ status: 'TIMED_OUT', failureType: 'INFRASTRUCTURE' })).failureCategory).toBeNull();
    expect(buildSandboxEvidenceFacts(input({ status: 'FAILED', failureType: 'UNKNOWN' })).failureCategory).toBeNull();
  });

  it('takes stage, category, code and message from the validated failure, and sanitizes the message again', () => {
    const facts = buildSandboxEvidenceFacts(
      input({
        status: 'FAILED',
        facts: null,
        failureType: 'COMPILATION',
        failure: { ...FAILURE_FACT, message: `Cannot find name 'foo' ${SECRET_LINE}` },
      }),
    );

    expect(facts).toMatchObject({
      failureStage: 'COMPILING',
      failureCategory: 'COMPILATION',
      failureCode: 'TS2304',
      failureMessage: "Cannot find name 'foo' token=[REDACTED]",
    });
    expect(JSON.stringify(facts)).not.toContain('abc123secret');
  });

  it('is pure: the same input gives the same output and the input is not mutated', () => {
    const source = input();
    const snapshot = JSON.stringify(source);

    expect(buildSandboxEvidenceFacts(source)).toEqual(buildSandboxEvidenceFacts(source));
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  describe('toSandboxExecutionEvidence', () => {
    it('keeps the identity of the real call and the validated failure only for a non-COMPLETED result', () => {
      const evidence = toSandboxExecutionEvidence(
        resultOf({ status: 'FAILED', facts: null, failure: FAILURE_FACT }),
        'COMPILATION',
      );

      expect(evidence).toMatchObject({
        executionId: 'exec-1',
        executionProfile: 'NODE_TYPESCRIPT',
        requestId: 'req-1',
        correlationId: 'corr-1',
        durationMs: 12,
      });
      expect(evidence.failure).toEqual({ ...FAILURE_FACT, message: "Cannot find name 'foo' token=[REDACTED]" });
      expect(evidence.facts.failureCode).toBe('TS2304');
    });

    it('ignores a failure fact carried by a COMPLETED result, as the failure column does', () => {
      const evidence = toSandboxExecutionEvidence(resultOf({ failure: FAILURE_FACT }), 'TEST_ASSERTION');

      expect(evidence.failure).toBeNull();
      expect(evidence.facts.failureCategory).toBe('TEST_ASSERTION');
      expect(evidence.facts.failureStage).toBeNull();
    });

    it('rejects an invalid failure fact (stage outside the closed set) without throwing', () => {
      const evidence = toSandboxExecutionEvidence(
        resultOf({ status: 'FAILED', facts: null, failure: { ...FAILURE_FACT, stage: 'BOGUS' as never } }),
        'INFRASTRUCTURE',
      );

      expect(evidence.failure).toBeNull();
      expect(evidence.facts.failureStage).toBeNull();
      expect(evidence.facts.failureCategory).toBeNull();
    });
  });

  describe('toAcceptedSandboxEvidence', () => {
    it('keeps the executionId and the profile, and leaves the identifiers null when the error carries none', () => {
      const evidence = toAcceptedSandboxEvidence(new SandboxAcceptedExecutionError('no terminó', 'exec-9', 'NODE_TYPESCRIPT'));

      expect(evidence).toEqual({
        executionId: 'exec-9',
        executionProfile: 'NODE_TYPESCRIPT',
        requestId: null,
        correlationId: null,
        durationMs: null,
        facts: buildSandboxEvidenceFacts({
          executionProfile: 'NODE_TYPESCRIPT',
          status: null,
          facts: null,
          failureType: null,
          failure: null,
        }),
        failure: null,
      });
      expect(evidence.facts.passed).toBeNull();
    });

    it('carries the identifiers and the duration when the error includes them', () => {
      const evidence = toAcceptedSandboxEvidence(
        new SandboxAcceptedExecutionError('no terminó', 'exec-8', 'NODE_TYPESCRIPT', 'req-8', 'corr-8', 33),
      );

      expect(evidence).toMatchObject({ executionId: 'exec-8', requestId: 'req-8', correlationId: 'corr-8', durationMs: 33 });
    });
  });
});
