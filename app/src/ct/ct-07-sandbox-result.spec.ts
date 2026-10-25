import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapSandboxResult } from '../sandbox/map-sandbox-result.js';
import { SANDBOX_EVIDENCE_FACT_KEYS, toSandboxExecutionEvidence } from '../sandbox/sandbox-evidence-facts.js';
import { SandboxExecutionService } from '../sandbox/sandbox-execution.service.js';
import type { SandboxExecutionResult } from '../sandbox/sandbox.types.js';

/**
 * CT-07-A4: la salida del Sandbox no trae veredicto funcional ni campos RAG y Core ignora cualquier campo
 * semántico extra. Se simula un Sandbox que añade veredictos funcionales y datos RAG al resultado (en la raíz, en
 * `facts` y en `failure`) y se comprueba que Core no los propaga ni deja que cambien el veredicto técnico.
 */

const examples = resolve(__dirname, '../../../spec/contracts/schemas/examples');
const completed = JSON.parse(readFileSync(resolve(examples, 'sandbox-result.completed.json'), 'utf8')) as Record<
  string,
  unknown
> & { facts: Record<string, unknown> };

const accepted = { ...JSON.parse(readFileSync(resolve(examples, 'sandbox-accepted.json'), 'utf8')), pollAfterMs: 1 };

const CANARY = 'CANARY-SEMANTIC-VERDICT';
const SEMANTIC_ROOT_FIELDS = {
  functionalVerdict: `${CANARY}-FUNCTIONALLY_CORRECT`,
  verdict: `${CANARY}-PASS`,
  semanticScore: 0.99,
  ragScore: 0.98,
  retrievalId: `${CANARY}-retrieval`,
  functionalRules: [{ knowledgeId: `${CANARY}-rule`, normalizedRule: `${CANARY}-rule-text` }],
  ragContext: { chunks: [`${CANARY}-chunk`] },
};

const config = () =>
  ({
    get: (key: string, fallback?: unknown) =>
      ({
        SANDBOX_URL: 'http://sandbox.local',
        SANDBOX_SERVICE_TOKEN: 'token',
        SANDBOX_DOWNLOAD_TTL_SECONDS: 300,
        SANDBOX_REQUEST_TIMEOUT_MS: 5000,
        SANDBOX_MAX_POLL_ATTEMPTS: 5,
      })[key] ?? fallback,
  }) as never;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

async function executeWith(resultPayload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(ok(accepted))
      .mockResolvedValueOnce(ok({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(ok(resultPayload)),
  );
  const service = new SandboxExecutionService(
    config(),
    { put: vi.fn().mockResolvedValue(undefined), presignGet: vi.fn().mockResolvedValue('https://signed.example/x') } as never,
  );
  const warn = vi.spyOn((service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger, 'warn');
  const outcome = await service.execute({
    requestId: 'request-1',
    testRunId: 'run-1',
    projectVersionId: 'version-1',
    snapshotKey: 'snapshot-key',
    snapshotBuffer: Buffer.from('zip'),
    artifacts: [],
    scope: 'TARGET',
    targetIds: ['target-1'],
    runnerHint: 'VITEST',
  });
  return { outcome, warn };
}

describe('CT-07 resultado del Sandbox', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('CT-07-A4: los campos de veredicto funcional y RAG añadidos en la raíz del resultado no salen de Core ni se registran', async () => {
    const { outcome, warn } = await executeWith({ ...completed, ...SEMANTIC_ROOT_FIELDS });

    expect(Object.keys(outcome).sort()).toEqual(
      [
        'completedAt',
        'correlationId',
        'durationMs',
        'evidence',
        'executionId',
        'executionProfile',
        'facts',
        'failure',
        'requestId',
        'stageDurations',
        'startedAt',
        'status',
      ].sort(),
    );
    expect(JSON.stringify(outcome)).not.toContain(CANARY);
    // El aviso de desvío de contrato lista rutas y motivos, nunca los valores semánticos.
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain(CANARY);
  });

  it('CT-07-A4: un veredicto semántico dentro de facts o failure no sale en el veredicto técnico ni en la evidencia persistida', async () => {
    const facts = { ...completed.facts, functionalVerdict: `${CANARY}-facts`, ragScore: 0.97 };
    const { outcome } = await executeWith({
      ...completed,
      ...SEMANTIC_ROOT_FIELDS,
      facts,
      failure: null,
    });
    const result = outcome as SandboxExecutionResult;

    const mapped = mapSandboxResult(result);
    const evidence = toSandboxExecutionEvidence(result, mapped.failureType);

    expect(Object.keys(mapped).sort()).toEqual(
      ['compiled', 'errorSummary', 'executed', 'failureType', 'passed', 'status', 'valid'],
    );
    expect(Object.keys(evidence.facts).sort()).toEqual([...SANDBOX_EVIDENCE_FACT_KEYS].sort());
    expect(Object.keys(evidence).sort()).toEqual(
      ['correlationId', 'durationMs', 'executionId', 'executionProfile', 'facts', 'failure', 'requestId'],
    );
    expect(JSON.stringify({ mapped, evidence })).not.toContain(CANARY);
  });

  it('CT-07-A4: un veredicto funcional "aprobado" del Sandbox no cambia el resultado técnico de una prueba fallida', async () => {
    const failing = { ...completed.facts, passed: false, failedTests: 1, passedTests: 1 };
    const withVerdict = await executeWith({
      ...completed,
      facts: { ...failing, functionalVerdict: `${CANARY}-PASS` },
      ...SEMANTIC_ROOT_FIELDS,
    });
    const without = await executeWith({ ...completed, facts: failing });

    const mappedWith = mapSandboxResult(withVerdict.outcome as SandboxExecutionResult);
    const mappedWithout = mapSandboxResult(without.outcome as SandboxExecutionResult);

    expect(mappedWith).toEqual(mappedWithout);
    expect(mappedWith).toMatchObject({ status: 'INVALID', valid: false, passed: false, failureType: 'TEST_ASSERTION' });
  });

  it('CT-07-A4: un fallo del Sandbox con datos semánticos extra conserva solo el hecho de fallo del contrato', async () => {
    const failure = {
      stage: 'COMPILING',
      category: 'COMPILATION',
      code: 'TS2304',
      message: 'Cannot find name foo',
      functionalVerdict: `${CANARY}-failure`,
      ragHint: `${CANARY}-hint`,
    };
    const { outcome } = await executeWith({
      ...completed,
      status: 'FAILED',
      facts: null,
      failure,
      ...SEMANTIC_ROOT_FIELDS,
    });
    const result = outcome as SandboxExecutionResult;

    const mapped = mapSandboxResult(result);
    const evidence = toSandboxExecutionEvidence(result, mapped.failureType);

    expect(mapped).toMatchObject({ status: 'FAILED', failureType: 'COMPILATION', valid: false });
    expect(evidence.failure).toEqual({
      stage: 'COMPILING',
      category: 'COMPILATION',
      code: 'TS2304',
      message: 'Cannot find name foo',
    });
    expect(JSON.stringify({ mapped, evidence })).not.toContain(CANARY);
  });
});
