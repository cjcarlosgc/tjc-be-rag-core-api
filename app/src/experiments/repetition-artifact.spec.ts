import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildRepetitionArtifact,
  REPETITION_TEST_CASES_MAX,
  REPETITION_TEST_CONTENT_MAX_BYTES,
} from './repetition-artifact.js';
import type { SandboxExecutionResult, TestCaseFact } from '../sandbox/sandbox.types.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function makeResult(overrides: Partial<SandboxExecutionResult> = {}): SandboxExecutionResult {
  return {
    status: 'COMPLETED',
    facts: {
      runner: 'VITEST',
      compiled: true,
      executed: true,
      passed: false,
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      skippedTests: 0,
      testCases: [
        {
          suitePath: 'suite',
          name: 'a',
          status: 'PASSED',
          durationMs: 3,
          errorMessage: null,
          failureKind: null,
        },
        {
          suitePath: 'suite',
          name: 'b',
          status: 'FAILED',
          durationMs: 5,
          errorMessage: 'expected 1 to be 2',
          failureKind: 'ASSERTION',
        },
      ],
      testCasesTruncated: false,
    },
    failure: null,
    stageDurations: [{ stage: 'RUNNING_TESTS', durationMs: 120 }],
    executionId: 'exec-1',
    executionProfile: 'NODE_TYPESCRIPT',
    requestId: 'req-1',
    correlationId: 'corr-1',
    durationMs: 200,
    ...overrides,
  };
}

describe('buildRepetitionArtifact', () => {
  it('devuelve null si no hay contenido ni resultado', () => {
    expect(buildRepetitionArtifact(null, null)).toBeNull();
  });

  it('calcula el hash sobre el contenido completo aunque se trunque', () => {
    const content = 'x'.repeat(REPETITION_TEST_CONTENT_MAX_BYTES + 10);
    const artifact = buildRepetitionArtifact(content, null);
    expect(artifact?.testContentSha256).toBe(sha256(content));
    expect(artifact?.testContentSha256).not.toBe(sha256(content.slice(0, REPETITION_TEST_CONTENT_MAX_BYTES)));
  });

  it('recorta exactamente a 256 KiB y marca el recorte', () => {
    const content = 'a'.repeat(REPETITION_TEST_CONTENT_MAX_BYTES + 10);
    const artifact = buildRepetitionArtifact(content, null);
    expect(artifact?.testContent).toBe('a'.repeat(REPETITION_TEST_CONTENT_MAX_BYTES));
    expect(artifact?.testContentTruncated).toBe(true);
  });

  it('no deja contenido sin recortar cuando cabe justo en el límite', () => {
    const content = 'b'.repeat(REPETITION_TEST_CONTENT_MAX_BYTES);
    const artifact = buildRepetitionArtifact(content, null);
    expect(artifact?.testContent).toBe(content);
    expect(artifact?.testContentTruncated).toBe(false);
  });

  it('no corta caracteres multibyte al recortar', () => {
    // 'é' ocupa 2 bytes en UTF-8. Con un byte sobrante el recorte no puede partir el carácter.
    const content = 'a'.repeat(REPETITION_TEST_CONTENT_MAX_BYTES - 1) + 'é'.repeat(4);
    const artifact = buildRepetitionArtifact(content, null);
    expect(artifact?.testContentTruncated).toBe(true);
    expect(artifact?.testContent).toBe('a'.repeat(REPETITION_TEST_CONTENT_MAX_BYTES - 1));
    expect(Buffer.byteLength(artifact?.testContent ?? '', 'utf8')).toBeLessThanOrEqual(
      REPETITION_TEST_CONTENT_MAX_BYTES,
    );
    expect(artifact?.testContent).not.toContain('�');
  });

  it('limita a 200 casos y registra los omitidos', () => {
    const testCases: TestCaseFact[] = Array.from({ length: 205 }, (_, index) => ({
      suitePath: null,
      name: `case-${index}`,
      status: 'PASSED',
      durationMs: 1,
      errorMessage: null,
    }));
    const result = makeResult({
      facts: { ...makeResult().facts!, testCases, testCasesTruncated: false },
    });
    const report = buildRepetitionArtifact(null, result)?.runnerReport;
    expect(report?.testCases).toHaveLength(REPETITION_TEST_CASES_MAX);
    expect(report?.testCasesOmitted).toBe(5);
    expect(report?.testCasesTruncated).toBe(true);
  });

  it('sanea mensajes de casos y de fallo: no aparecen secretos ni URLs firmadas', () => {
    const secret = 'abc123secretvalue';
    const signed = 'https://storage.example.com/bucket/file.json?X-Amz-Signature=sig987654321';
    const result = makeResult({
      failure: {
        stage: 'RUNNING_TESTS',
        category: 'TEST_RUNTIME',
        code: 'E_RUN',
        message: `request failed token=${secret} at ${signed}`,
      },
      facts: {
        ...makeResult().facts!,
        testCases: [
          {
            suitePath: null,
            name: 'auth',
            status: 'FAILED',
            durationMs: 2,
            errorMessage: `fetch ${signed} with token=${secret}`,
            failureKind: 'ERROR',
          },
        ],
      },
    });
    const artifact = buildRepetitionArtifact(null, result);
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('sig987654321');
    expect(serialized).not.toContain('X-Amz-Signature');
    expect(artifact?.runnerReport?.failure?.message).toContain('[REDACTED]');
  });

  it('no incluye stdout ni stderr', () => {
    const result = { ...makeResult(), stdout: 'SALIDA', stderr: 'ERROR CRUDO' } as unknown as SandboxExecutionResult;
    const serialized = JSON.stringify(buildRepetitionArtifact('code', result));
    expect(serialized).not.toContain('SALIDA');
    expect(serialized).not.toContain('ERROR CRUDO');
    expect(serialized).not.toContain('stdout');
    expect(serialized).not.toContain('stderr');
  });

  it('el hash del reporte es determinista y coincide con el JSON canónico (claves ordenadas)', () => {
    const first = buildRepetitionArtifact('code', makeResult());
    const second = buildRepetitionArtifact('code', makeResult());
    expect(first?.runnerReportSha256).toBe(second?.runnerReportSha256);
    const sortKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortKeys);
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
        );
      }
      return value;
    };
    expect(first?.runnerReportSha256).toBe(sha256(JSON.stringify(sortKeys(first?.runnerReport))));
  });

  it('sin resultado persiste solo el contenido con runnerReport null', () => {
    const artifact = buildRepetitionArtifact('const x = 1;', null);
    expect(artifact).toEqual({
      testContent: 'const x = 1;',
      testContentSha256: sha256('const x = 1;'),
      testContentTruncated: false,
      runnerReport: null,
      runnerReportSha256: null,
    });
  });

  it('sin contenido pero con resultado persiste solo el reporte', () => {
    const artifact = buildRepetitionArtifact(null, makeResult());
    expect(artifact?.testContent).toBeNull();
    expect(artifact?.testContentSha256).toBeNull();
    expect(artifact?.runnerReport).not.toBeNull();
  });
});
