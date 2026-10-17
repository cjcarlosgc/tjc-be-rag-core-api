import { describe, expect, it } from 'vitest';
import { mapSandboxResult, SANDBOX_TIMED_OUT_ERROR_SUMMARY } from './map-sandbox-result.js';
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
    const outcome = mapSandboxResult({ status: 'TIMED_OUT', facts: null, failure: null, stageDurations: [], executionId: 'exec-1', executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1 });

    expect(outcome).toMatchObject({ status: 'FAILED', valid: false, failureType: 'INFRASTRUCTURE' });
  });

  it('keeps the timeout text only as errorSummary and exposes no timeout flag in the outcome (WI-CORE-025 (1))', () => {
    const outcome = mapSandboxResult({ status: 'TIMED_OUT', facts: null, failure: null, stageDurations: [], executionId: 'exec-1', executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1 });

    expect(outcome.errorSummary).toBe(SANDBOX_TIMED_OUT_ERROR_SUMMARY);
    expect(Object.keys(outcome).sort()).toEqual(
      ['compiled', 'errorSummary', 'executed', 'failureType', 'passed', 'status', 'valid'],
    );
  });

  it('maps a FAILED status using the failure category', () => {
    const outcome = mapSandboxResult({
      status: 'FAILED',
      facts: null,
      failure: { stage: 'INSTALLING_DEPENDENCIES', category: 'DEPENDENCY', code: 'E1', message: 'npm install failed' },
      stageDurations: [],
      executionId: 'exec-1',
      executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1,
    });

    expect(outcome).toMatchObject({ status: 'FAILED', failureType: 'DEPENDENCY', errorSummary: 'npm install failed' });
  });

  it('maps a passing execution to VALID/NONE', () => {
    const outcome = mapSandboxResult({ status: 'COMPLETED', facts: makeFacts(), failure: null, stageDurations: [], executionId: 'exec-1', executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1 });

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
      stageDurations: [],
      executionId: 'exec-1',
      executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1,
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
      stageDurations: [],
      executionId: 'exec-1',
      executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1,
    });

    expect(outcome).toMatchObject({
      status: 'INVALID',
      failureType: 'TEST_ASSERTION',
      errorSummary: 'expected true',
    });
  });

  describe('WI-CORE-027 (IDEA-015): failure.category validada y errorSummary saneado', () => {
    const failedSandbox = (
      failure: Record<string, unknown> | null,
    ): SandboxExecutionResult =>
      ({
        status: 'FAILED',
        facts: null,
        failure,
        stageDurations: [],
        executionId: 'exec-1',
        executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1,
      }) as unknown as SandboxExecutionResult;

    it.each(['COMPILATION', 'TEST_ASSERTION', 'TEST_RUNTIME', 'DEPENDENCY', 'CONFIGURATION', 'INFRASTRUCTURE', 'UNKNOWN'])(
      'conserva la categoría válida %s',
      (category) => {
        const outcome = mapSandboxResult(
          failedSandbox({ stage: 'COMPILING', category, code: 'E1', message: 'x' }),
        );
        expect(outcome.failureType).toBe(category);
      },
    );

    it.each([
      ['un valor fuera del enum', 'SOMETHING_ELSE'],
      ['NONE, que nunca es un fallo', 'NONE'],
      ['una categoría en minúsculas', 'dependency'],
      ['un valor no textual', 42],
      ['un null', null],
    ])('convierte %s en UNKNOWN', (_name, category) => {
      const outcome = mapSandboxResult(
        failedSandbox({ stage: 'COMPILING', category, code: 'E1', message: 'x' }),
      );
      expect(outcome.failureType).toBe('UNKNOWN');
    });

    it('convierte una categoría ausente en UNKNOWN cuando no hay hecho de fallo', () => {
      const outcome = mapSandboxResult(failedSandbox(null));
      expect(outcome).toMatchObject({
        failureType: 'UNKNOWN',
        errorSummary: 'El Sandbox no pudo completar la ejecución.',
      });
    });

    it('sanea el mensaje de un fallo FAILED antes de errorSummary, sin cambiar el texto de la forma', () => {
      const outcome = mapSandboxResult(
        failedSandbox({
          stage: 'INSTALLING_DEPENDENCIES',
          category: 'DEPENDENCY',
          code: 'NPM',
          message: 'npm ERR! registry https://user:hunter@registry.example/pkg?token=abc123 password hunter2',
        }),
      );
      expect(outcome.errorSummary).toBe(
        'npm ERR! registry https://[REDACTED]@registry.example/pkg password [REDACTED]',
      );
      expect(Object.keys(outcome).sort()).toEqual(
        ['compiled', 'errorSummary', 'executed', 'failureType', 'passed', 'status', 'valid'],
      );
    });

    it('sanea errorMessage de la prueba fallida y limita errorSummary a 500 caracteres', () => {
      const outcome = mapSandboxResult({
        status: 'COMPLETED',
        facts: makeFacts({
          passed: false,
          testCases: [
            {
              suitePath: null,
              name: 'x',
              status: 'FAILED',
              durationMs: 1,
              errorMessage: `Authorization: Bearer abc.def-123 ${'z'.repeat(900)}`,
            },
          ],
        }),
        failure: null,
        stageDurations: [],
        executionId: 'exec-1',
        executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1,
      });
      expect(outcome.errorSummary?.startsWith('Authorization: [REDACTED] ')).toBe(true);
      expect(outcome.errorSummary).not.toContain('abc.def-123');
      expect(outcome.errorSummary).toHaveLength(500);
    });

    it('mantiene los textos constantes y null tal como estaban', () => {
      const passing = mapSandboxResult({
        status: 'COMPLETED',
        facts: makeFacts(),
        failure: null,
        stageDurations: [],
        executionId: 'exec-1',
        executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1,
      });
      expect(passing.errorSummary).toBeNull();
      const timedOut = mapSandboxResult({
        status: 'TIMED_OUT',
        facts: null,
        failure: null,
        stageDurations: [],
        executionId: 'exec-1',
        executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 1,
      });
      expect(timedOut.errorSummary).toBe(SANDBOX_TIMED_OUT_ERROR_SUMMARY);
      const failed = mapSandboxResult(
        failedSandbox({ stage: 'COMPILING', category: 'COMPILATION', code: 'E1', message: 'Cannot find name' }),
      );
      expect(failed.errorSummary).toBe('Cannot find name');
    });
  });

  describe('failureKind (DEC-PHP-GEN-002)', () => {
    const failingFacts = (testCases: Array<{ name: string; failureKind?: 'ASSERTION' | 'ERROR' | null; errorMessage: string | null }>) =>
      makeFacts({
        runner: 'PHPUNIT',
        passed: false,
        testCases: testCases.map((testCase) => ({
          suitePath: null,
          status: 'FAILED' as const,
          durationMs: 1,
          ...testCase,
        })),
      });

    it('classifies a failed case with failureKind ERROR as TEST_RUNTIME and uses its message, even when other cases are ASSERTION', () => {
      const outcome = mapSandboxResult({
        status: 'COMPLETED',
        facts: failingFacts([
          { name: 'asserts', failureKind: 'ASSERTION', errorMessage: 'expected 1, got 2' },
          { name: 'calls missing class', failureKind: 'ERROR', errorMessage: 'Class "Foo" not found' },
        ]),
        failure: null,
        stageDurations: [],
        executionId: 'exec-1',
        executionProfile: 'PHP_LARAVEL_PHPUNIT',
        requestId: 'req-1',
        correlationId: 'corr-1',
        durationMs: 1,
      });

      expect(outcome).toMatchObject({
        status: 'INVALID',
        valid: false,
        failureType: 'TEST_RUNTIME',
        errorSummary: 'Class "Foo" not found',
      });
    });

    it('keeps TEST_ASSERTION when every failed case is ASSERTION', () => {
      const outcome = mapSandboxResult({
        status: 'COMPLETED',
        facts: failingFacts([
          { name: 'a', failureKind: 'ASSERTION', errorMessage: 'first' },
          { name: 'b', failureKind: 'ASSERTION', errorMessage: 'second' },
        ]),
        failure: null,
        stageDurations: [],
        executionId: 'exec-1',
        executionProfile: 'PHP_LARAVEL_PHPUNIT',
        requestId: 'req-1',
        correlationId: 'corr-1',
        durationMs: 1,
      });

      expect(outcome).toMatchObject({ failureType: 'TEST_ASSERTION', errorSummary: 'first', valid: false });
    });

    it('applies the previous rule when no failed case carries failureKind', () => {
      const outcome = mapSandboxResult({
        status: 'COMPLETED',
        facts: failingFacts([
          { name: 'a', errorMessage: 'expected true' },
          { name: 'b', failureKind: null, errorMessage: 'other' },
        ]),
        failure: null,
        stageDurations: [],
        executionId: 'exec-1',
        executionProfile: 'NODE_TYPESCRIPT',
        requestId: 'req-1',
        correlationId: 'corr-1',
        durationMs: 1,
      });

      expect(outcome).toMatchObject({ failureType: 'TEST_ASSERTION', errorSummary: 'expected true', valid: false });
    });

    it('ignores failureKind on passed cases and keeps VALID for passing executions', () => {
      const outcome = mapSandboxResult({
        status: 'COMPLETED',
        facts: makeFacts({
          testCases: [{ suitePath: null, name: 'ok', status: 'PASSED', durationMs: 1, errorMessage: null, failureKind: 'ERROR' }],
        }),
        failure: null,
        stageDurations: [],
        executionId: 'exec-1',
        executionProfile: 'PHP_LARAVEL_PHPUNIT',
        requestId: 'req-1',
        correlationId: 'corr-1',
        durationMs: 1,
      });

      expect(outcome).toMatchObject({ status: 'VALID', valid: true, failureType: 'NONE' });
    });
  });
});
