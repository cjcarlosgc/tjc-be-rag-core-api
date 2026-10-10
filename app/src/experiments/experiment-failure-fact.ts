import { sanitizeFailureMessage } from '../common/sanitize-failure-message.util.js';
import type {
  SandboxFailureCategory,
  SandboxFailureFact,
  SandboxStage,
} from '../sandbox/sandbox.types.js';

/**
 * WI-CORE-007 (HU12/HU17; INTEROP-2.7 §6.16): hecho de fallo que se persiste por repetición en la columna
 * interna `ExperimentRepetition.failure`. `message` ya viene saneado. Tipo de alias (no interfaz) para que
 * sea asignable al JSON de Prisma.
 */
export type ExperimentRepetitionFailure = {
  stage: SandboxStage;
  category: SandboxFailureCategory;
  code: string;
  message: string;
};

export const EXPERIMENT_FAILURE_CODE_MAX_LENGTH = 64;

const SANDBOX_STAGES: readonly SandboxStage[] = [
  'PREPARING',
  'INSTALLING_DEPENDENCIES',
  'COMPILING',
  'RUNNING_TESTS',
  'FINALIZING',
];

const SANDBOX_FAILURE_CATEGORIES: readonly SandboxFailureCategory[] = [
  'COMPILATION',
  'TEST_ASSERTION',
  'TEST_RUNTIME',
  'DEPENDENCY',
  'CONFIGURATION',
  'INFRASTRUCTURE',
  'UNKNOWN',
];

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function truncateToCodePoints(text: string, maxLength: number): string {
  return Array.from(text).slice(0, maxLength).join('');
}

/**
 * Traduce el hecho de fallo del Sandbox al que se persiste. No inventa valores: devuelve `null` si no hay
 * hecho, si `stage` o `category` están fuera de su conjunto, si `code` queda vacío tras recortar espacios o
 * si `message` no es texto. `code` se trunca a 64 caracteres; `message` se redacta y después se trunca a 500
 * (`sanitizeFailureMessage`). Ningún otro campo de la respuesta del Sandbox se conserva.
 */
export function toExperimentRepetitionFailure(
  failure: SandboxFailureFact | null | undefined,
): ExperimentRepetitionFailure | null {
  if (!failure) return null;

  // Se lee como `unknown`: la respuesta del Sandbox llega como JSON y no se fía del tipo estático.
  const { stage, category, code, message } = failure as unknown as Record<string, unknown>;
  if (!isOneOf(SANDBOX_STAGES, stage) || !isOneOf(SANDBOX_FAILURE_CATEGORIES, category)) {
    return null;
  }
  if (typeof code !== 'string' || typeof message !== 'string') return null;

  const trimmedCode = code.trim();
  if (trimmedCode.length === 0) return null;

  return {
    stage,
    category,
    code: truncateToCodePoints(trimmedCode, EXPERIMENT_FAILURE_CODE_MAX_LENGTH),
    message: sanitizeFailureMessage(message),
  };
}
