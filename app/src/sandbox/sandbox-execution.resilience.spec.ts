import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampPollAfterMs,
  MAX_POLL_AFTER_MS,
  SandboxAcceptedExecutionError,
  SandboxExecutionService,
} from './sandbox-execution.service.js';

/** Resiliencia de Core al consultar el Sandbox: reintenta solo fallos transitorios de consultas idempotentes. */
function config(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    SANDBOX_URL: 'http://sandbox.local', SANDBOX_SERVICE_TOKEN: 'token', SANDBOX_DOWNLOAD_TTL_SECONDS: 300,
    SANDBOX_REQUEST_TIMEOUT_MS: 5000, SANDBOX_MAX_POLL_ATTEMPTS: 5, SANDBOX_POLL_RETRIES: 2, SANDBOX_POLL_RETRY_DELAY_MS: 1, ...overrides,
  };
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as never;
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const failure = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response;
const accepted = ok({ executionId: 'exec-1', pollAfterMs: 1 });
const done = ok({ status: 'COMPLETED' });
const result = () => ok({ status: 'COMPLETED', facts: null, failure: null, stageDurations: [] });

async function execute(fetchMock: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', fetchMock);
  const objectStorage = { put: vi.fn().mockResolvedValue(undefined), presignGet: vi.fn().mockResolvedValue('https://signed.example/x') };
  const service = new SandboxExecutionService(config(overrides), objectStorage as never);
  return service.execute({
    requestId: 'request-1', testRunId: 'run-1', projectVersionId: 'version-1', snapshotKey: 'key',
    snapshotBuffer: Buffer.from('zip'), artifacts: [], scope: 'BATCH', targetIds: [], runnerHint: 'VITEST',
  });
}

describe('SandboxExecutionService: resiliencia', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('un 503 transitorio al consultar el estado se reintenta y la ejecución termina', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(done).mockResolvedValueOnce(result());
    await expect(execute(fetchMock)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('un fallo de red al consultar el resultado se reintenta', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValueOnce(done).mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(result());
    await expect(execute(fetchMock)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('un 404 no es transitorio: no se reintenta y falla conservando el executionId', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValueOnce(failure(404));
    const error = await execute(fetchMock).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SandboxAcceptedExecutionError);
    expect((error as SandboxAcceptedExecutionError).executionId).toBe('exec-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('al agotar los reintentos relanza el último error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValue(failure(502));
    await expect(execute(fetchMock, { SANDBOX_POLL_RETRIES: 2 })).rejects.toBeInstanceOf(SandboxAcceptedExecutionError);
    expect(fetchMock).toHaveBeenCalledTimes(1 + 3); // POST + intento inicial + 2 reintentos
  });

  it('el POST de creación no se reintenta (la idempotencia la maneja el llamador)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(failure(503));
    await expect(execute(fetchMock)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('clampPollAfterMs', () => {
  it.each([
    [1000, 1000], [0, 0], [10 ** 9, MAX_POLL_AFTER_MS], [-5, 1000], [Number.NaN, 1000], ['2000', 1000], [undefined, 1000], [Infinity, 1000],
  ])('%s → %s', (input, expected) => {
    expect(clampPollAfterMs(input)).toBe(expected);
  });
});
