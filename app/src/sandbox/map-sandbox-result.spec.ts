import { describe, expect, it } from 'vitest';
import { mapSandboxResult } from './map-sandbox-result.js';
import type { SandboxExecutionResult } from './sandbox.types.js';

function makeFacts(overrides: Partial<SandboxExecutionResult['facts']> = {}) {
  return {
    runner: 'VITEST' as const,
    compiled: true,
    executed: true,
    passed: true,
    totalTests: 1,
    passedTests: 1,
    failedTests: 0,
    skippedTests: 0,
    testCases: [],
    testCasesTruncated: false,
    ...overrides,
  };
}

describe('mapSandboxResult', () => {
  it('maps TIMED_OUT to FAILED/INFRASTRUCTURE', () => {
    const outcome = mapSandboxResult({ status: 'TIMED_OUT', facts: null, failure: null });

    expect(outcome).toMatchObject({ status: 'FAILED', valid: false, failureType: 'INFRASTRUCTURE' });
  });

  it('maps a FAILED status using the failure category', () => {
    const outcome = mapSandboxResult({
      status: 'FAILED',
      facts: null,
      failure: { stage: 'INSTALLING_DEPENDENCIES', category: 'DEPENDENCY', code: 'E1', message: 'npm install failed' },
    });

    expect(outcome).toMatchObject({ status: 'FAILED', failureType: 'DEPENDENCY', errorSummary: 'npm install failed' });
  });

  it('maps a passing execution to VALID/NONE', () => {
    const outcome = mapSandboxResult({ status: 'COMPLETED', facts: makeFacts(), failure: null });

    expect(outcome).toEqual({
      status: 'VALID',
      compiled: true,
      executed: true,
      passed: true,
      valid: true,
      failureType: 'NONE',
      errorSummary: null,
    });
  });

  it('maps a compilation failure to INVALID/COMPILATION', () => {
    const outcome = mapSandboxResult({
      status: 'COMPLETED',
      facts: makeFacts({ compiled: false, executed: false, passed: false }),
      failure: null,
    });

    expect(outcome).toMatchObject({ status: 'INVALID', failureType: 'COMPILATION' });
  });

  it('maps a failed assertion to INVALID/TEST_ASSERTION with the failed case message', () => {
    const outcome = mapSandboxResult({
      status: 'COMPLETED',
      facts: makeFacts({
        passed: false,
        testCases: [
          { suitePath: null, name: 'x', status: 'FAILED', durationMs: 1, errorMessage: 'expected true' },
        ],
      }),
      failure: null,
    });

    expect(outcome).toMatchObject({
      status: 'INVALID',
      failureType: 'TEST_ASSERTION',
      errorSummary: 'expected true',
    });
  });
});
