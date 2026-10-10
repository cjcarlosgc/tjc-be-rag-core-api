import type { SandboxExecutionResult } from './sandbox.types.js';

export type FailureTypeValue =
  | 'NONE'
  | 'COMPILATION'
  | 'TEST_ASSERTION'
  | 'TEST_RUNTIME'
  | 'DEPENDENCY'
  | 'CONFIGURATION'
  | 'INFRASTRUCTURE'
  | 'UNKNOWN';

/**
 * Texto de `errorSummary` para una ejecución que agotó el tiempo límite del Sandbox (WI-CORE-025).
 * Solo es texto para mostrar: el discriminador de timeout de la redelivery es la columna interna
 * `ExperimentRepetition.sandboxTimedOut`, no este texto.
 */
export const SANDBOX_TIMED_OUT_ERROR_SUMMARY = 'La ejecución en el Sandbox agotó el tiempo límite.';

export interface MappedSandboxOutcome {
  status: 'VALID' | 'INVALID' | 'FAILED';
  compiled: boolean | null;
  executed: boolean | null;
  passed: boolean | null;
  valid: boolean | null;
  failureType: FailureTypeValue | null;
  errorSummary: string | null;
}

/**
 * Normaliza el resultado factual del Sandbox (RunnerFacts/SandboxFailureFact)
 * a un veredicto de producto (VALID/INVALID/FAILED + FailureType), compartido
 * por 005-test-generation y 008-experimental-comparison.
 */
export function mapSandboxResult(result: SandboxExecutionResult): MappedSandboxOutcome {
  if (result.status === 'TIMED_OUT') {
    return {
      status: 'FAILED',
      compiled: result.facts?.compiled ?? null,
      executed: result.facts?.executed ?? null,
      passed: result.facts?.passed ?? null,
      valid: false,
      failureType: 'INFRASTRUCTURE',
      errorSummary: SANDBOX_TIMED_OUT_ERROR_SUMMARY,
    };
  }

  if (result.status === 'FAILED' || !result.facts) {
    return {
      status: 'FAILED',
      compiled: result.facts?.compiled ?? null,
      executed: result.facts?.executed ?? null,
      passed: result.facts?.passed ?? null,
      valid: false,
      failureType: result.failure?.category ?? 'UNKNOWN',
      errorSummary: result.failure?.message ?? 'El Sandbox no pudo completar la ejecución.',
    };
  }

  const { facts } = result;

  if (facts.passed) {
    return {
      status: 'VALID',
      compiled: true,
      executed: true,
      passed: true,
      valid: true,
      failureType: 'NONE',
      errorSummary: null,
    };
  }

  const failedCases = facts.testCases.filter((testCase) => testCase.status === 'FAILED');
  // DEC-PHP-GEN-002: un caso fallido con failureKind ERROR es fallo técnico y gana sobre las aserciones.
  // Sin failureKind (Sandbox anterior) o solo con ASSERTION se conserva la clasificación previa.
  const errorCase = facts.compiled && facts.executed
    ? failedCases.find((testCase) => testCase.failureKind === 'ERROR')
    : undefined;
  const failureType = !facts.compiled
    ? 'COMPILATION'
    : !facts.executed || errorCase
      ? 'TEST_RUNTIME'
      : 'TEST_ASSERTION';
  const failedCase = errorCase ?? failedCases[0];

  return {
    status: 'INVALID',
    compiled: facts.compiled,
    executed: facts.executed,
    passed: facts.passed,
    valid: false,
    failureType,
    errorSummary: failedCase?.errorMessage ?? 'La prueba generada no pasó en el Sandbox.',
  };
}
