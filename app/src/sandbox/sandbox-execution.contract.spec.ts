import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateContract } from '../contracts/contract-validator.js';
import { SandboxExecutionService } from './sandbox-execution.service.js';

/** Test de contrato Core↔Sandbox (INTEROP-2.17 §7, §10) con los ejemplos canónicos de spec/contracts/schemas/examples. */
const examples = resolve(__dirname, '../../../spec/contracts/schemas/examples');
const load = <T = Record<string, unknown>>(name: string): T => JSON.parse(readFileSync(resolve(examples, name), 'utf8')) as T;
const SCHEMA = 'sandbox-execution.schema.json' as const;

function configService() {
  const values: Record<string, unknown> = { SANDBOX_URL: 'http://sandbox.local', SANDBOX_SERVICE_TOKEN: 'test-service-token', SANDBOX_DOWNLOAD_TTL_SECONDS: 300, SANDBOX_REQUEST_TIMEOUT_MS: 5000, SANDBOX_MAX_POLL_ATTEMPTS: 5 };
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as never;
}
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe('contrato Core ↔ Sandbox', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function run(resultExample: string) {
    const request = load<{ requestId: string; testRunId: string; projectVersionId: string; targetIds: string[]; artifacts: { artifactId: string; relativePath: string; artifactType: 'CREATED' | 'MODIFIED' }[] }>('sandbox-create-request.node.json');
    const accepted = { ...load('sandbox-accepted.json'), pollAfterMs: 1 };
    const terminal = { ...load('sandbox-status.running.json'), status: 'COMPLETED', stage: null, completedAt: '2026-10-18T10:00:03.000Z' };
    const result = load(resultExample);
    for (const [definition, payload] of [['SandboxExecutionAcceptedResponse', accepted], ['SandboxExecutionStatusResponse', terminal], ['SandboxExecutionResultResponse', result]] as const) {
      expect(validateContract(SCHEMA, definition, payload).errors, `el fixture ${definition} debe ser válido`).toEqual([]);
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(accepted))
      .mockResolvedValueOnce(response(terminal))
      .mockResolvedValueOnce(response(result));
    vi.stubGlobal('fetch', fetchMock);
    const objectStorage = { put: vi.fn().mockResolvedValue(undefined), presignGet: vi.fn().mockResolvedValue('https://signed.example/download') };
    const service = new SandboxExecutionService(configService(), objectStorage as never);
    const outcome = await service.execute({
      requestId: request.requestId, testRunId: request.testRunId, projectVersionId: request.projectVersionId,
      snapshotKey: 'snapshot-key', snapshotBuffer: Buffer.from('zip-bytes'),
      artifacts: request.artifacts.map((a) => ({ ...a, content: Buffer.from('contenido') })),
      scope: 'TARGET', targetIds: request.targetIds, runnerHint: 'VITEST',
    });
    return { outcome, posted: JSON.parse(fetchMock.mock.calls[0][1].body as string) as unknown };
  }

  it('el POST /executions que construye Core cumple CreateSandboxExecutionRequest', async () => {
    const { posted } = await run('sandbox-result.completed.json');
    const check = validateContract(SCHEMA, 'CreateSandboxExecutionRequest', posted);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it('conserva los hechos de un resultado COMPLETED del contrato, incluidos los tiempos por etapa y failureKind', async () => {
    const { outcome } = await run('sandbox-result.completed.json');
    const example = load<{ facts: unknown; stageDurations: unknown }>('sandbox-result.completed.json');
    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.facts).toEqual(example.facts);
    expect(outcome.stageDurations).toEqual(example.stageDurations);
  });

  it('conserva el fallo y la evidencia de un resultado FAILED del contrato', async () => {
    const { outcome } = await run('sandbox-result.failed.json');
    const example = load<{ failure: unknown }>('sandbox-result.failed.json');
    expect(outcome.status).toBe('FAILED');
    expect(outcome.failure).toEqual(example.failure);
    expect(outcome.evidence).toEqual([{ kind: 'COMPILER_STDERR', stage: 'INSTALLING_DEPENDENCIES', content: 'Your requirements could not be resolved', truncated: true, originalBytes: 20480 }]);
  });
});
