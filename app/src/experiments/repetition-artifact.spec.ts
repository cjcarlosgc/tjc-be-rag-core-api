import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildRepetitionArtifact,
  buildSandboxEvidenceArtifact,
  REPETITION_TEST_CASES_MAX,
  REPETITION_TEST_CONTENT_MAX_BYTES,
  SANDBOX_EVIDENCE_CONTENT_MAX_BYTES,
  SANDBOX_EVIDENCE_TOTAL_MAX_BYTES,
} from './repetition-artifact.js';
import type { SandboxExecutionResult, TestCaseFact } from '../sandbox/sandbox.types.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function makeResult(overrides: Partial<SandboxExecutionResult> = {}): SandboxExecutionResult {
  return {
    status: 'COMPLETED',
    facts: {
      executionProfile: 'NODE_TYPESCRIPT',
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

describe('IDEA-030 (WI-CORE-060): sin NUL en testContent ni en el reporte', () => {
  it('elimina los NUL del contenido de prueba antes de guardarlo y de calcular su hash', () => {
    const artifact = buildRepetitionArtifact('a\u0000b', null);
    expect(artifact?.testContent).toBe('ab');
    expect(artifact?.testContentSha256).toBe(sha256('ab'));
    expect(artifact?.testContent).not.toContain('\u0000');
  });

  it('elimina los NUL de los nombres y rutas de casos del reporte', () => {
    const result = makeResult();
    result.facts!.testCases[0] = { ...result.facts!.testCases[0], name: 'na\u0000me', suitePath: 'su\u0000ite' };
    const artifact = buildRepetitionArtifact(null, result);
    expect(artifact?.runnerReport?.testCases[0].name).toBe('name');
    expect(artifact?.runnerReport?.testCases[0].suitePath).toBe('suite');
    expect(JSON.stringify(artifact?.runnerReport)).not.toContain('\\u0000');
  });
});

describe('buildSandboxEvidenceArtifact (WI-CORE-060)', () => {
  const at = '2026-10-13T10:00:00.000Z';
  const later = '2026-10-13T10:00:05.000Z';
  const fact = (kind: 'TEST_STDOUT' | 'COMPILER_STDERR' | 'TEST_STDERR' | 'RUNNER_REPORT', content: string, truncated = false) => ({
    kind,
    stage: 'RUNNING_TESTS',
    content,
    truncated,
    originalBytes: Buffer.byteLength(content, 'utf8'),
  });

  it('devuelve null sin evidencia ni fechas', () => {
    expect(buildSandboxEvidenceArtifact([], null, null)).toBeNull();
    expect(buildSandboxEvidenceArtifact(undefined, undefined, undefined)).toBeNull();
  });

  it('conserva kind, stage, truncated y originalBytes de cada entrada y parsea las fechas', () => {
    const artifact = buildSandboxEvidenceArtifact([fact('TEST_STDOUT', 'hola\nmundo')], at, later);
    expect(artifact?.sandboxEvidence).toEqual({
      entries: [
        {
          kind: 'TEST_STDOUT',
          stage: 'RUNNING_TESTS',
          truncated: false,
          originalBytes: 10,
          content: 'hola\nmundo',
          contentTruncated: false,
        },
      ],
      omitted: 0,
    });
    expect(artifact?.sandboxEvidenceTruncated).toBe(false);
    expect(artifact?.sandboxStartedAt).toEqual(new Date(at));
    expect(artifact?.sandboxCompletedAt).toEqual(new Date(later));
  });

  it('convierte fechas inválidas en null sin descartar la evidencia', () => {
    const artifact = buildSandboxEvidenceArtifact([fact('TEST_STDERR', 'x')], 'no-es-fecha', undefined);
    expect(artifact?.sandboxStartedAt).toBeNull();
    expect(artifact?.sandboxCompletedAt).toBeNull();
    expect(artifact?.sandboxEvidence?.entries).toHaveLength(1);
  });

  it('devuelve solo fechas cuando no hay evidencia', () => {
    const artifact = buildSandboxEvidenceArtifact([], at, later);
    expect(artifact).toEqual({
      sandboxEvidence: null,
      sandboxEvidenceSha256: null,
      sandboxEvidenceTruncated: null,
      sandboxStartedAt: new Date(at),
      sandboxCompletedAt: new Date(later),
    });
  });

  it('redacta secretos sin normalizar saltos de línea ni truncar', () => {
    const content = 'linea 1\nAuthorization: Bearer abc.def.ghi\npassword=hunter2\nlinea 3';
    const artifact = buildSandboxEvidenceArtifact([fact('TEST_STDERR', content)], null, null);
    const text = artifact?.sandboxEvidence?.entries[0].content ?? '';
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('abc.def.ghi');
    expect(text.split('\n')).toHaveLength(4);
  });

  it('elimina NUL del contenido de evidencia', () => {
    const artifact = buildSandboxEvidenceArtifact([fact('COMPILER_STDERR', 'a\u0000b\u0000')], null, null);
    expect(artifact?.sandboxEvidence?.entries[0].content).toBe('ab');
  });

  it('recorta cada entrada a 8 KiB sin cortar caracteres multibyte y marca contentTruncated', () => {
    const content = 'ñ'.repeat(SANDBOX_EVIDENCE_CONTENT_MAX_BYTES); // 2 bytes por carácter: 16 KiB
    const artifact = buildSandboxEvidenceArtifact([fact('TEST_STDOUT', content)], null, null);
    const entry = artifact?.sandboxEvidence?.entries[0];
    expect(entry?.contentTruncated).toBe(true);
    expect(Buffer.byteLength(entry?.content ?? '', 'utf8')).toBeLessThanOrEqual(SANDBOX_EVIDENCE_CONTENT_MAX_BYTES);
    expect(entry?.content).toBe('ñ'.repeat(SANDBOX_EVIDENCE_CONTENT_MAX_BYTES / 2));
    expect(artifact?.sandboxEvidenceTruncated).toBe(true);
  });

  it('aplica un tope total de 40 KiB y registra las entradas omitidas', () => {
    const big = 'x'.repeat(SANDBOX_EVIDENCE_CONTENT_MAX_BYTES);
    const facts = Array.from({ length: 7 }, () => fact('TEST_STDOUT', big));
    const artifact = buildSandboxEvidenceArtifact(facts, null, null);
    const payload = artifact?.sandboxEvidence;
    const total = payload?.entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.content, 'utf8'), 0) ?? 0;
    expect(total).toBe(SANDBOX_EVIDENCE_TOTAL_MAX_BYTES);
    expect(payload?.entries).toHaveLength(5);
    expect(payload?.omitted).toBe(2);
    expect(artifact?.sandboxEvidenceTruncated).toBe(true);
  });

  it('recorta la última entrada que cabe en el tope total', () => {
    const facts = [
      fact('TEST_STDOUT', 'a'.repeat(SANDBOX_EVIDENCE_CONTENT_MAX_BYTES)),
      fact('TEST_STDOUT', 'a'.repeat(SANDBOX_EVIDENCE_CONTENT_MAX_BYTES)),
      fact('TEST_STDOUT', 'a'.repeat(SANDBOX_EVIDENCE_CONTENT_MAX_BYTES)),
      fact('TEST_STDOUT', 'a'.repeat(SANDBOX_EVIDENCE_CONTENT_MAX_BYTES)),
      fact('TEST_STDOUT', 'a'.repeat(SANDBOX_EVIDENCE_CONTENT_MAX_BYTES)),
      fact('TEST_STDOUT', 'abc'),
    ];
    const payload = buildSandboxEvidenceArtifact(facts, null, null)?.sandboxEvidence;
    expect(payload?.entries).toHaveLength(5);
    expect(payload?.omitted).toBe(1);
  });

  it('marca sandboxEvidenceTruncated cuando el Sandbox ya recortó una entrada', () => {
    const artifact = buildSandboxEvidenceArtifact([fact('TEST_STDERR', 'corto', true)], null, null);
    expect(artifact?.sandboxEvidenceTruncated).toBe(true);
    expect(artifact?.sandboxEvidence?.entries[0].truncated).toBe(true);
  });

  it('el hash es determinista y coincide con el JSON canónico del payload saneado', () => {
    const facts = [fact('TEST_STDOUT', 'uno'), fact('RUNNER_REPORT', 'dos')];
    const first = buildSandboxEvidenceArtifact(facts, null, null);
    const second = buildSandboxEvidenceArtifact(facts, null, null);
    expect(first?.sandboxEvidenceSha256).toBe(second?.sandboxEvidenceSha256);
    expect(first?.sandboxEvidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    const canonical = JSON.stringify({
      entries: first?.sandboxEvidence?.entries.map((entry) => ({
        content: entry.content,
        contentTruncated: entry.contentTruncated,
        kind: entry.kind,
        originalBytes: entry.originalBytes,
        stage: entry.stage,
        truncated: entry.truncated,
      })),
      omitted: 0,
    });
    expect(first?.sandboxEvidenceSha256).toBe(sha256(canonical));
  });
});

describe('buildRepetitionArtifact stage timestamps (WI-CORE-061)', () => {
  const stagesWithTimes = (): SandboxExecutionResult['stageDurations'] => [
    { stage: 'COMPILING', durationMs: 120, startedAt: '2026-10-14T06:30:33.225Z', completedAt: '2026-10-14T06:30:33.345Z' },
    { stage: 'INSTALLING_DEPENDENCIES', durationMs: 900, startedAt: '2026-10-14T06:30:33.500Z', completedAt: '2026-10-14T06:30:34.400Z' },
    { stage: 'RUNNING_TESTS', durationMs: 340, startedAt: '2026-10-14T06:30:34.650Z', completedAt: '2026-10-14T06:30:34.990Z' },
  ];

  it('incluye startedAt/completedAt por etapa en runnerReport.stageDurations cuando existen', () => {
    const artifact = buildRepetitionArtifact('code', makeResult({ stageDurations: stagesWithTimes() }));
    expect(artifact?.runnerReport?.stageDurations).toStrictEqual([
      { stage: 'COMPILING', durationMs: 120, startedAt: '2026-10-14T06:30:33.225Z', completedAt: '2026-10-14T06:30:33.345Z' },
      { stage: 'INSTALLING_DEPENDENCIES', durationMs: 900, startedAt: '2026-10-14T06:30:33.500Z', completedAt: '2026-10-14T06:30:34.400Z' },
      { stage: 'RUNNING_TESTS', durationMs: 340, startedAt: '2026-10-14T06:30:34.650Z', completedAt: '2026-10-14T06:30:34.990Z' },
    ]);
  });

  it('el hash cambia solo cuando hay tiempos por etapa', () => {
    const withoutTimes = buildRepetitionArtifact('code', makeResult());
    const withTimes = buildRepetitionArtifact('code', makeResult({ stageDurations: stagesWithTimes() }));
    expect(withTimes?.runnerReportSha256).not.toBe(withoutTimes?.runnerReportSha256);
    const again = buildRepetitionArtifact('code', makeResult({ stageDurations: stagesWithTimes() }));
    expect(again?.runnerReportSha256).toBe(withTimes?.runnerReportSha256);
  });

  it('sin tiempos, el reporte no tiene claves nuevas y el hash coincide con la versión previa', () => {
    const baseline: SandboxExecutionResult = {
      status: 'COMPLETED',
      facts: {
        executionProfile: 'NODE_TYPESCRIPT', runner: 'VITEST', compiled: true, executed: true, passed: true, totalTests: 1, passedTests: 1,
        failedTests: 0, skippedTests: 0,
        testCases: [{ suitePath: 'suite', name: 'a', status: 'PASSED', durationMs: 3, errorMessage: null, failureKind: null }],
        testCasesTruncated: false,
      },
      failure: null,
      stageDurations: [
        { stage: 'COMPILING', durationMs: 120 },
        { stage: 'RUNNING_TESTS', durationMs: 340 },
      ],
      executionId: 'exec-1', executionProfile: 'NODE_TYPESCRIPT', requestId: 'req-1', correlationId: 'corr-1', durationMs: 200,
    };
    const artifact = buildRepetitionArtifact('code', baseline);
    expect(artifact?.runnerReport?.stageDurations).toStrictEqual([
      { stage: 'COMPILING', durationMs: 120 },
      { stage: 'RUNNING_TESTS', durationMs: 340 },
    ]);
    expect(artifact?.runnerReportSha256).toBe(
      '289806bff9245d1b486783f84acaa455f6fd75d7d81a7e68818c1b3727d97909',
    );
  });

  it('con tiempos de 3 etapas, la espera entre etapas se calcula leyendo solo el reporte persistido', () => {
    const artifact = buildRepetitionArtifact('code', makeResult({ stageDurations: stagesWithTimes() }));
    const persisted = JSON.parse(JSON.stringify(artifact?.runnerReport)) as {
      stageDurations: Array<{ stage: string; startedAt: string; completedAt: string }>;
    };
    const gaps = persisted.stageDurations.slice(1).map((stage, index) =>
      Date.parse(stage.startedAt) - Date.parse(persisted.stageDurations[index].completedAt),
    );
    expect(gaps).toStrictEqual([155, 250]);
  });
});
