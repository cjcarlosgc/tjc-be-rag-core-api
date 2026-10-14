import { createHash } from 'node:crypto';
import type {
  SandboxExecutionEvidenceFact,
  SandboxExecutionEvidenceKind,
  SandboxExecutionResult,
} from '../sandbox/sandbox.types.js';
import { redactSecretsInText, sanitizeFailureMessage } from '../common/sanitize-failure-message.util.js';

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
 * WI-CORE-060 (IDEA-030): elimina los NUL. PostgreSQL no admite `\u0000` en columnas de texto ni en JSONB.
 * Se usa split/join para no introducir una expresión regular con un carácter de control.
 */
function removeNulCharacters(text: string): string {
  return text.split('\u0000').join('');
}

/** Tope de contenido por entrada de evidencia del Sandbox, en bytes UTF-8 (8 KiB). */
export const SANDBOX_EVIDENCE_CONTENT_MAX_BYTES = 8_192;

/** Tope total del contenido de evidencia sumado de todas las entradas, en bytes UTF-8 (40 KiB). */
export const SANDBOX_EVIDENCE_TOTAL_MAX_BYTES = 40_960;

export interface SandboxEvidenceArtifactEntry {
  kind: SandboxExecutionEvidenceKind;
  stage: string | null;
  /** Indica si el Sandbox ya recortó la salida original. */
  truncated: boolean;
  originalBytes: number | null;
  /** Contenido saneado (sin secretos ni NUL), acotado a 8 KiB y al tope total. */
  content: string;
  /** true si Core recortó el contenido (por entrada o por el tope total). */
  contentTruncated: boolean;
}

export interface SandboxEvidenceArtifactPayload {
  entries: SandboxEvidenceArtifactEntry[];
  /** Entradas omitidas por agotar el tope total. */
  omitted: number;
}

export interface SandboxEvidenceArtifact {
  sandboxEvidence: SandboxEvidenceArtifactPayload | null;
  sandboxEvidenceSha256: string | null;
  sandboxEvidenceTruncated: boolean | null;
  sandboxStartedAt: Date | null;
  sandboxCompletedAt: Date | null;
}

function parseInstant(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * WI-CORE-060: construcción pura de la evidencia acotada del Sandbox (stdout/stderr y reporte del runner).
 * - Por entrada: redacta secretos (sin normalizar saltos de línea ni truncar), elimina NUL y recorta a 8 KiB
 *   UTF-8 sin cortar caracteres, marcando `contentTruncated`. Redactar antes de recortar evita dejar un secreto a medias.
 * - Tope total: 40 KiB sumados. Las entradas que ya no caben se recortan o se omiten (`omitted`).
 * - `sandboxEvidenceSha256` es el SHA-256 del JSON canónico ya saneado (`{ entries, omitted }`).
 * - Fechas: se parsean a Date; una fecha inválida o ausente es null.
 * Devuelve null si no hay entradas de evidencia ni fechas válidas.
 */
export function buildSandboxEvidenceArtifact(
  evidence: readonly SandboxExecutionEvidenceFact[] | null | undefined,
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): SandboxEvidenceArtifact | null {
  const startedAtDate = parseInstant(startedAt);
  const completedAtDate = parseInstant(completedAt);
  const input = evidence ?? [];

  const entries: SandboxEvidenceArtifactEntry[] = [];
  let omitted = 0;
  let remaining = SANDBOX_EVIDENCE_TOTAL_MAX_BYTES;
  let anyTruncated = false;

  for (const entry of input) {
    if (remaining <= 0) {
      omitted += 1;
      continue;
    }
    const cleaned = redactSecretsInText(removeNulCharacters(entry.content));
    const perEntry = truncateUtf8(cleaned, SANDBOX_EVIDENCE_CONTENT_MAX_BYTES);
    const budgeted = truncateUtf8(perEntry.text, remaining);
    remaining -= Buffer.byteLength(budgeted.text, 'utf8');
    const contentTruncated = perEntry.truncated || budgeted.truncated;
    anyTruncated = anyTruncated || contentTruncated || entry.truncated;
    entries.push({
      kind: entry.kind,
      stage: entry.stage,
      truncated: entry.truncated,
      originalBytes: entry.originalBytes,
      content: budgeted.text,
      contentTruncated,
    });
  }

  if (entries.length === 0 && startedAtDate === null && completedAtDate === null) return null;

  if (entries.length === 0) {
    return {
      sandboxEvidence: null,
      sandboxEvidenceSha256: null,
      sandboxEvidenceTruncated: null,
      sandboxStartedAt: startedAtDate,
      sandboxCompletedAt: completedAtDate,
    };
  }

  const payload: SandboxEvidenceArtifactPayload = { entries, omitted };
  const truncated = anyTruncated || omitted > 0;
  return {
    sandboxEvidence: payload,
    sandboxEvidenceSha256: sha256(canonicalJson(payload)),
    sandboxEvidenceTruncated: truncated,
    sandboxStartedAt: startedAtDate,
    sandboxCompletedAt: completedAtDate,
  };
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
      suitePath: testCase.suitePath === null ? null : removeNulCharacters(testCase.suitePath),
      name: removeNulCharacters(testCase.name),
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
    // WI-CORE-060 (IDEA-030): sin NUL, tanto el texto guardado como su hash (hash del contenido tal como se guarda).
    const cleaned = removeNulCharacters(testContent);
    const { text, truncated } = truncateUtf8(cleaned, REPETITION_TEST_CONTENT_MAX_BYTES);
    contentFields = {
      testContent: text,
      testContentSha256: sha256(cleaned),
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
