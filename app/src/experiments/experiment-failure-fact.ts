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

/**
 * WI-CORE-027 (DEC-EVID-004): forma válida de `code` tras recortar espacios. `code` lo produce el Sandbox y sale
 * como `failureCode` en la evidencia, así que solo se admiten identificadores cortos (`TS2304`,
 * `NPM_INSTALL_FAILED`, `E1.2:x`). Un valor fuera de esta forma no se trunca ni se redacta: el hecho completo
 * queda `null`, igual que un `code` vacío.
 */
const EXPERIMENT_FAILURE_CODE_PATTERN = new RegExp(
  `^[A-Za-z0-9_.:-]{1,${EXPERIMENT_FAILURE_CODE_MAX_LENGTH}}$`,
);

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

/** Valida una etapa del Sandbox leída de una fila o de un resultado; cualquier otro valor es `null`. */
export function toSandboxStage(value: unknown): SandboxStage | null {
  return isOneOf(SANDBOX_STAGES, value) ? value : null;
}

/** Valida una categoría de fallo del Sandbox (sin `NONE`); cualquier otro valor es `null`. */
export function toSandboxFailureCategory(value: unknown): SandboxFailureCategory | null {
  return isOneOf(SANDBOX_FAILURE_CATEGORIES, value) ? value : null;
}

/**
 * WI-CORE-027 (corte C): valida y recorta `code` con la misma regla que la escritura (`toExperimentRepetitionFailure`):
 * forma de identificador corto y sin forma de secreto. Devuelve `null` si no cumple; nunca trunca ni redacta.
 */
export function toValidFailureCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;

  const trimmedCode = code.trim();
  if (!EXPERIMENT_FAILURE_CODE_PATTERN.test(trimmedCode)) return null;
  // Un código con forma de secreto (p. ej. `ghp_…` o `sk-…`, que cumplen el patrón) no se persiste ni se expone.
  if (sanitizeFailureMessage(trimmedCode) !== trimmedCode) return null;

  return trimmedCode;
}

/**
 * Traduce el hecho de fallo del Sandbox al que se persiste. No inventa valores: devuelve `null` si no hay
 * hecho, si `stage` o `category` están fuera de su conjunto, si `message` no es texto, o si `code` no cumple
 * `EXPERIMENT_FAILURE_CODE_PATTERN` tras recortar espacios (vacío, más de 64 caracteres o con otros símbolos).
 * Decisión de WI-CORE-027: un `code` fuera de forma invalida el hecho completo en lugar de truncarse o
 * redactarse, porque un código truncado sería un dato inventado. También se rechaza un `code` que el saneado
 * de mensajes altere (p. ej. `sk-…` o un JWT escrito como código): tampoco se persiste. `message` se redacta y
 * después se trunca a 500 (`sanitizeFailureMessage`). Ningún otro campo de la respuesta del Sandbox se conserva.
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

  const validCode = toValidFailureCode(code);
  if (validCode === null) return null;

  return {
    stage,
    category,
    code: validCode,
    message: sanitizeFailureMessage(message),
  };
}
