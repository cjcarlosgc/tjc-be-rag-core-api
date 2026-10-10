import { sanitizeFailureMessage } from '../common/sanitize-failure-message.util.js';
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
 * Valores de `FailureType` que puede producir un fallo del Sandbox: el enum sin `NONE` (un fallo nunca es
 * `NONE`, DEC-EVID-006). Cualquier otro valor, ausente o no textual, se convierte en `UNKNOWN` (IDEA-015).
 */
const SANDBOX_FAILURE_TYPES: readonly FailureTypeValue[] = [
  'COMPILATION',
  'TEST_ASSERTION',
  'TEST_RUNTIME',
  'DEPENDENCY',
  'CONFIGURATION',
  'INFRASTRUCTURE',
  'UNKNOWN',
];

function toSandboxFailureType(category: unknown): FailureTypeValue {
  return typeof category === 'string' && (SANDBOX_FAILURE_TYPES as readonly string[]).includes(category)
    ? (category as FailureTypeValue)
    : 'UNKNOWN';
}

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
    const failureMessage = result.failure?.message;
    return {
      status: 'FAILED',
      compiled: result.facts?.compiled ?? null,
      executed: result.facts?.executed ?? null,
      passed: result.facts?.passed ?? null,
      valid: false,
      failureType: toSandboxFailureType(result.failure?.category),
      // WI-CORE-027 (IDEA-015): el mensaje del Sandbox se sanea antes de llegar a errorSummary.
      errorSummary:
        typeof failureMessage === 'string'
          ? sanitizeFailureMessage(failureMessage)
          : 'El Sandbox no pudo completar la ejecución.',
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

  const failureType = !facts.compiled ? 'COMPILATION' : !facts.executed ? 'TEST_RUNTIME' : 'TEST_ASSERTION';
  const failedCase = facts.testCases.find((testCase) => testCase.status === 'FAILED');
  const failedMessage = failedCase?.errorMessage;

  return {
    status: 'INVALID',
    compiled: facts.compiled,
    executed: facts.executed,
    passed: facts.passed,
    valid: false,
    failureType,
    // WI-CORE-027 (IDEA-015): el mensaje de la prueba fallida se sanea antes de llegar a errorSummary.
    errorSummary:
      typeof failedMessage === 'string'
        ? sanitizeFailureMessage(failedMessage)
        : 'La prueba generada no pasó en el Sandbox.',
  };
}
