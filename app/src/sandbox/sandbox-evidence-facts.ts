import { sanitizeFailureMessage } from '../common/sanitize-failure-message.util.js';
import {
  toExperimentRepetitionFailure,
  type ExperimentRepetitionFailure,
} from '../experiments/experiment-failure-fact.js';
import type { FailureTypeValue } from './map-sandbox-result.js';
import type { SandboxAcceptedExecutionError } from './sandbox-execution.service.js';
import type {
  ExecutionProfile,
  RunnerFacts,
  SandboxExecutionResult,
  SandboxFailureCategory,
  SandboxStage,
} from './sandbox.types.js';

/**
 * WI-CORE-027 (DEC-EVID-003; INTEROP-2.7 §6.16): hechos del Sandbox que se persisten como evidencia. Son
 * exactamente las 14 claves cerradas de `sandbox.facts`; contienen solo conteos, banderas y el hecho de fallo
 * ya validado. Nunca incluyen `testCases` ni sus mensajes, logs, URLs ni claves de almacenamiento.
 */
export const SANDBOX_EVIDENCE_FACT_KEYS = [
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
] as const;

/** Forma de `sandboxFacts` / `facts`. Alias de tipo (no interfaz) para que sea asignable al JSON de Prisma. */
export type SandboxEvidenceFacts = {
  executionProfile: ExecutionProfile | null;
  runner: RunnerFacts['runner'] | null;
  compiled: boolean | null;
  executed: boolean | null;
  passed: boolean | null;
  totalTests: number | null;
  passedTests: number | null;
  failedTests: number | null;
  skippedTests: number | null;
  testCasesTruncated: boolean | null;
  failureStage: SandboxStage | null;
  failureCategory: SandboxFailureCategory | null;
  failureCode: string | null;
  failureMessage: string | null;
};

export interface SandboxEvidenceInput {
  executionProfile: ExecutionProfile;
  /** Estado del resultado; `null` cuando la ejecución fue aceptada pero no hubo resultado. */
  status: SandboxExecutionResult['status'] | null;
  facts: RunnerFacts | null;
  /** `FailureType` mapeado por `mapSandboxResult`; solo informa la categoría de un COMPLETED con pruebas fallidas. */
  failureType: FailureTypeValue | null;
  /** Hecho de fallo ya validado con `toExperimentRepetitionFailure`; `null` si no lo hay. */
  failure: ExperimentRepetitionFailure | null;
}

/**
 * Evidencia de una ejecución aceptada por el Sandbox. Los campos de identidad son `null` cuando no se
 * observaron (p. ej. un fallo posterior a la aceptación sin `requestId` propio), nunca cero ni cadena vacía.
 */
export interface SandboxExecutionEvidence {
  executionId: string;
  /** Siempre conocido: una ejecución aceptada tiene perfil (lo envió Core y lo devuelve el Sandbox). */
  executionProfile: ExecutionProfile;
  requestId: string | null;
  correlationId: string | null;
  durationMs: number | null;
  facts: SandboxEvidenceFacts;
  failure: ExperimentRepetitionFailure | null;
}

const SANDBOX_FAILURE_CATEGORIES: readonly SandboxFailureCategory[] = [
  'COMPILATION',
  'TEST_ASSERTION',
  'TEST_RUNTIME',
  'DEPENDENCY',
  'CONFIGURATION',
  'INFRASTRUCTURE',
  'UNKNOWN',
];

/** Conteo observado: entero no negativo; cualquier otro valor se lee como no observado (`null`). */
function observedCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Bandera observada: solo un booleano real; el resto es no observado (`null`). */
function observedFlag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * DEC-EVID-006: una ejecución COMPLETED con pruebas fallidas no trae hecho de fallo; su categoría es el
 * `failureType` observado (sin `NONE`). Cualquier otro caso sin hecho deja la categoría en `null`.
 */
function completedFailureCategory(input: SandboxEvidenceInput): SandboxFailureCategory | null {
  if (input.status !== 'COMPLETED' || input.facts === null || input.facts.passed !== false) {
    return null;
  }
  const { failureType } = input;
  return failureType !== null && (SANDBOX_FAILURE_CATEGORIES as readonly string[]).includes(failureType)
    ? (failureType as SandboxFailureCategory)
    : null;
}

/**
 * Construye `sandboxFacts` por mapeo explícito de las 14 claves (nunca por spread del resultado del Sandbox).
 * Función pura y sin efectos: no lanza y no conserva `testCases`, sus mensajes ni otros campos de la respuesta.
 */
export function buildSandboxEvidenceFacts(input: SandboxEvidenceInput): SandboxEvidenceFacts {
  const { facts, failure } = input;
  const runner = facts?.runner;

  return {
    executionProfile: input.executionProfile,
    runner: runner === 'JEST' || runner === 'VITEST' || runner === 'PHPUNIT' ? runner : null,
    compiled: observedFlag(facts?.compiled),
    executed: observedFlag(facts?.executed),
    passed: observedFlag(facts?.passed),
    totalTests: observedCount(facts?.totalTests),
    passedTests: observedCount(facts?.passedTests),
    failedTests: observedCount(facts?.failedTests),
    skippedTests: observedCount(facts?.skippedTests),
    testCasesTruncated: observedFlag(facts?.testCasesTruncated),
    failureStage: failure?.stage ?? null,
    failureCategory: failure ? failure.category : completedFailureCategory(input),
    failureCode: failure?.code ?? null,
    failureMessage: failure ? sanitizeFailureMessage(failure.message) : null,
  };
}

/**
 * Evidencia de un resultado del Sandbox. El hecho de fallo solo se toma de un resultado no COMPLETED (misma
 * regla que la columna `failure` de WI-CORE-007) y se valida antes de salir de aquí.
 */
export function toSandboxExecutionEvidence(
  result: SandboxExecutionResult,
  failureType: FailureTypeValue | null,
): SandboxExecutionEvidence {
  const failure = result.status === 'COMPLETED' ? null : toExperimentRepetitionFailure(result.failure);

  return {
    executionId: result.executionId,
    executionProfile: result.executionProfile,
    requestId: result.requestId,
    correlationId: result.correlationId,
    durationMs: result.durationMs,
    facts: buildSandboxEvidenceFacts({
      executionProfile: result.executionProfile,
      status: result.status,
      facts: result.facts,
      failureType,
      failure,
    }),
    failure,
  };
}

/**
 * Evidencia de una ejecución aceptada que no llegó a un resultado (sondeo agotado, fallo de red posterior).
 * Solo se conocen el `executionId`, el perfil y, si el error los lleva, los identificadores y la duración.
 */
export function toAcceptedSandboxEvidence(error: SandboxAcceptedExecutionError): SandboxExecutionEvidence {
  return {
    executionId: error.executionId,
    executionProfile: error.executionProfile,
    requestId: error.requestId,
    correlationId: error.correlationId,
    durationMs: error.durationMs,
    facts: buildSandboxEvidenceFacts({
      executionProfile: error.executionProfile,
      status: null,
      facts: null,
      failureType: null,
      failure: null,
    }),
    failure: null,
  };
}
