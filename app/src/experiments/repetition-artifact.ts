import { createHash } from 'node:crypto';
import type { SandboxExecutionResult } from '../sandbox/sandbox.types.js';
import { sanitizeFailureMessage } from '../common/sanitize-failure-message.util.js';

/**
 * WI-CORE-053 (HU12/HU17): construcción pura del artefacto interno de una repetición. Interno y privado: no se
 * expone en DTO ni en INTEROP. Solo contiene hechos normalizados del Sandbox y el contenido de prueba; nunca
 * stdout ni stderr (el Sandbox no los devuelve).
 */

/** Tope del contenido de prueba persistido, en bytes UTF-8 (256 KiB). */
export const REPETITION_TEST_CONTENT_MAX_BYTES = 262_144;

/** Máximo de casos de prueba persistidos por repetición. */
export const REPETITION_TEST_CASES_MAX = 200;

export interface RepetitionArtifactTestCase {
  suitePath: string | null;
  name: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'TODO';
  durationMs: number | null;
  failureKind: 'ASSERTION' | 'ERROR' | null;
  /** Mensaje ya saneado por `sanitizeFailureMessage` (máximo 500 caracteres). */
  errorMessage: string | null;
}

export interface RepetitionArtifactRunnerReport {
  status: SandboxExecutionResult['status'];
  runner: string | null;
  compiled: boolean | null;
  executed: boolean | null;
  passed: boolean | null;
  totalTests: number | null;
  passedTests: number | null;
  failedTests: number | null;
  skippedTests: number | null;
  testCasesTruncated: boolean;
  testCasesOmitted: number;
  testCases: RepetitionArtifactTestCase[];
  failure: {
    stage: string;
    category: string;
    code: string;
    message: string;
  } | null;
  stageDurations: Array<{ stage: string; durationMs: number }>;
}

export interface RepetitionArtifact {
  testContent: string | null;
  testContentSha256: string | null;
  testContentTruncated: boolean;
  runnerReport: RepetitionArtifactRunnerReport | null;
  runnerReportSha256: string | null;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Recorta a `maxBytes` bytes UTF-8 sin partir ningún carácter: acumula por puntos de código y se detiene antes
 * de desbordar el límite.
 */
function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
  let bytes = 0;
  let out = '';
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += char;
  }
  return { text: out, truncated: true };
}

/** Serialización canónica: claves de objeto en orden lexicográfico, recursivamente. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    );
  return `{${entries.join(',')}}`;
}

function buildRunnerReport(result: SandboxExecutionResult): RepetitionArtifactRunnerReport {
  const facts = result.facts;
  const cases = facts?.testCases ?? [];
  const kept = cases.slice(0, REPETITION_TEST_CASES_MAX);
  const omitted = cases.length - kept.length;
  return {
    status: result.status,
    runner: facts?.runner ?? null,
    compiled: facts?.compiled ?? null,
    executed: facts?.executed ?? null,
    passed: facts?.passed ?? null,
    totalTests: facts?.totalTests ?? null,
    passedTests: facts?.passedTests ?? null,
    failedTests: facts?.failedTests ?? null,
    skippedTests: facts?.skippedTests ?? null,
    testCasesTruncated: (facts?.testCasesTruncated ?? false) || omitted > 0,
    testCasesOmitted: omitted,
    testCases: kept.map((testCase) => ({
      suitePath: testCase.suitePath,
      name: testCase.name,
      status: testCase.status,
      durationMs: testCase.durationMs,
      failureKind: testCase.failureKind ?? null,
      errorMessage:
        testCase.errorMessage === null ? null : sanitizeFailureMessage(testCase.errorMessage),
    })),
    failure: result.failure
      ? {
          stage: result.failure.stage,
          category: result.failure.category,
          code: result.failure.code,
          message: sanitizeFailureMessage(result.failure.message),
        }
      : null,
    stageDurations: result.stageDurations.map((stage) => ({
      stage: stage.stage,
      durationMs: stage.durationMs,
    })),
  };
}

/**
 * Devuelve el artefacto de una repetición, o `null` si no hay ni contenido de prueba ni resultado del Sandbox.
 * - `testContentSha256` es el SHA-256 del contenido completo; `testContent` se recorta a 256 KiB sin cortar
 *   caracteres y `testContentTruncated` lo indica.
 * - `runnerReport` lleva hasta 200 casos (con `testCasesOmitted` para el resto) y mensajes saneados.
 * - `runnerReportSha256` es el SHA-256 del JSON canónico del reporte.
 * - Sin `result` (excepción, nunca llegó al Sandbox) solo se persiste el contenido, con `runnerReport` null.
 */
export function buildRepetitionArtifact(
  testContent: string | null,
  result: SandboxExecutionResult | null,
): RepetitionArtifact | null {
  if (testContent === null && result === null) return null;

  let contentFields: Pick<RepetitionArtifact, 'testContent' | 'testContentSha256' | 'testContentTruncated'> = {
    testContent: null,
    testContentSha256: null,
    testContentTruncated: false,
  };
  if (testContent !== null) {
    const { text, truncated } = truncateUtf8(testContent, REPETITION_TEST_CONTENT_MAX_BYTES);
    contentFields = {
      testContent: text,
      testContentSha256: sha256(testContent),
      testContentTruncated: truncated,
    };
  }

  if (result === null) {
    return { ...contentFields, runnerReport: null, runnerReportSha256: null };
  }

  const runnerReport = buildRunnerReport(result);
  return {
    ...contentFields,
    runnerReport,
    runnerReportSha256: sha256(canonicalJson(runnerReport)),
  };
}
