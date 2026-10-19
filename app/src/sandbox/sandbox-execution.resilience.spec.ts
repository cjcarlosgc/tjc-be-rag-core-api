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

/** WI-CORE-070 corte C: el reintento transitorio queda registrado y contado, sin secretos ni payload. */
describe('SandboxExecutionService: reintentos transitorios observables (corte C)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const SECRET_TOKEN = 'tok-SECRET-0123456789abcdef';

  async function run(fetchMock: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}) {
    vi.stubGlobal('fetch', fetchMock);
    const objectStorage = { put: vi.fn().mockResolvedValue(undefined), presignGet: vi.fn().mockResolvedValue('https://signed.example/x') };
    const service = new SandboxExecutionService(config({ SANDBOX_SERVICE_TOKEN: SECRET_TOKEN, ...overrides }), objectStorage as never);
    const warn = vi.spyOn((service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger, 'warn');
    const outcome = await service
      .execute({
        requestId: 'request-1', testRunId: 'run-1', projectVersionId: 'version-1', snapshotKey: 'key',
        snapshotBuffer: Buffer.from('zip'), artifacts: [], scope: 'BATCH', targetIds: [], runnerHint: 'VITEST',
      })
      .then(
        (value) => ({ value }) as const,
        (error: unknown) => ({ error }) as const,
      );
    return { service, warn, outcome };
  }

  const warnTexts = (warn: ReturnType<typeof vi.spyOn>) => warn.mock.calls.map((call) => String(call[0]));

  it('un GET de estado transitorio reintentado emite el warn esperado y sube el contador', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(done).mockResolvedValueOnce(result());
    const { service, warn, outcome } = await run(fetchMock);
    expect(outcome).toMatchObject({ value: { status: 'COMPLETED' } });
    const texts = warnTexts(warn).filter((text) => text.startsWith('Reintento transitorio'));
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('(status)');
    expect(texts[0]).toContain('ejecución exec-1');
    expect(texts[0]).toContain('reintento 1 de 2');
    expect(texts[0]).toContain('error SandboxUnavailableError');
    expect(texts[0]).toContain('espera 1ms');
    expect(service.transientRetryCount).toBe(1);
    expect(service.transientRetriesByOperation).toEqual({ status: 1, result: 0 });
  });

  it('un GET de resultado con fallo de red reintentado cuenta bajo result', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValueOnce(done).mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(result());
    const { service, warn, outcome } = await run(fetchMock);
    expect(outcome).toMatchObject({ value: { status: 'COMPLETED' } });
    const texts = warnTexts(warn).filter((text) => text.startsWith('Reintento transitorio'));
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('(result)');
    expect(service.transientRetriesByOperation).toEqual({ status: 0, result: 1 });
    expect(service.transientRetryCount).toBe(1);
  });

  it('los warns de reintento no contienen el token de servicio ni cabeceras', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(done).mockResolvedValueOnce(result());
    const { warn } = await run(fetchMock);
    const retryTexts = warnTexts(warn).filter((text) => text.startsWith('Reintento transitorio'));
    expect(retryTexts.length).toBeGreaterThan(0);
    for (const text of retryTexts) {
      expect(text).not.toContain(SECRET_TOKEN);
      expect(text).not.toMatch(/Bearer|authorization/i);
    }
  });

  it('un error no transitorio no se reintenta, no emite warn de reintento y no cuenta', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValueOnce(failure(404));
    const { service, warn, outcome } = await run(fetchMock);
    expect(outcome).toMatchObject({ error: expect.any(SandboxAcceptedExecutionError) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnTexts(warn).filter((text) => text.startsWith('Reintento transitorio'))).toHaveLength(0);
    expect(service.transientRetryCount).toBe(0);
    expect(service.transientRetriesByOperation).toEqual({ status: 0, result: 0 });
  });

  it('al agotar los reintentos relanza igual y el conteo refleja solo los reintentos realizados', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValue(failure(502));
    const { service, warn, outcome } = await run(fetchMock, { SANDBOX_POLL_RETRIES: 2 });
    expect(outcome).toMatchObject({ error: expect.any(SandboxAcceptedExecutionError) });
    expect(fetchMock).toHaveBeenCalledTimes(1 + 3);
    const texts = warnTexts(warn).filter((text) => text.startsWith('Reintento transitorio'));
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('reintento 1 de 2');
    expect(texts[0]).toContain('espera 1ms');
    expect(texts[1]).toContain('reintento 2 de 2');
    expect(texts[1]).toContain('espera 2ms');
    expect(service.transientRetryCount).toBe(2);
    expect(service.transientRetriesByOperation).toEqual({ status: 2, result: 0 });
  });

  it('con SANDBOX_POLL_RETRIES=0 no hay reintentos ni conteo', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValue(failure(503));
    const { service, outcome } = await run(fetchMock, { SANDBOX_POLL_RETRIES: 0 });
    expect(outcome).toMatchObject({ error: expect.any(SandboxAcceptedExecutionError) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.transientRetryCount).toBe(0);
  });

  it('transientRetriesByOperation devuelve una copia que no altera el contador interno', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(done).mockResolvedValueOnce(result());
    const { service } = await run(fetchMock);
    const snapshot = service.transientRetriesByOperation as Record<string, number>;
    snapshot.status = 99;
    expect(service.transientRetriesByOperation.status).toBe(1);
  });
});

describe('clampPollAfterMs', () => {
  it.each([
    [1000, 1000], [0, 0], [10 ** 9, MAX_POLL_AFTER_MS], [-5, 1000], [Number.NaN, 1000], ['2000', 1000], [undefined, 1000], [Infinity, 1000],
  ])('%s → %s', (input, expected) => {
    expect(clampPollAfterMs(input)).toBe(expected);
  });
});
