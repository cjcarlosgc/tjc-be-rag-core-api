import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubIntegrationClient, GithubIntegrationClientError } from './github-integration.client.js';

const BASE_URL = 'https://github-integration.example.test';
const SERVICE_TOKEN = 'service-secret-token';

function makeClient(fetcher: typeof fetch, overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    GITHUB_INTEGRATION_API_BASE_URL: BASE_URL,
    CORE_TO_GITHUB_INTEGRATION_TOKEN: SERVICE_TOKEN,
    ...overrides,
  };
  const config = {
    get: (key: string) => values[key],
  };
  return new GithubIntegrationClient(config as never, fetcher);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GithubIntegrationClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends GET with the service bearer, relative internal path, and available correlation ID', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ displayName: 'App' }));
    const client = makeClient(fetcher);

    await expect(
      client.get<{ displayName: string }>('/app', {
        headers: { 'X-Correlation-ID': 'corr-123' },
      }),
    ).resolves.toEqual({ displayName: 'App' });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/internal/v1/github/app`);
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${SERVICE_TOKEN}`);
    expect(headers.get('x-correlation-id')).toBe('corr-123');
    expect(headers.get('content-type')).toBeNull();
    expect(init?.body).toBeUndefined();
  });

  it('sends POST JSON and forwards only approved discovery/correlation headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ installationId: '42' }));
    const client = makeClient(fetcher);
    const request = { repositoryName: 'owner/repo' };

    await client.post('/repositories/installation', request, {
      headers: {
        'X-GitHub-Provider-Token': 'ephemeral-user-token',
        'X-Correlation-ID': 'corr-post',
        Authorization: 'attacker-controlled-token',
        Cookie: 'private-cookie',
      },
    });

    const [url, init] = fetcher.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(url).toBe(`${BASE_URL}/internal/v1/github/repositories/installation`);
    expect(init?.method).toBe('POST');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe(`Bearer ${SERVICE_TOKEN}`);
    expect(headers.get('x-github-provider-token')).toBe('ephemeral-user-token');
    expect(headers.get('x-correlation-id')).toBe('corr-post');
    expect(headers.get('cookie')).toBeNull();
    expect(init?.body).toBe(JSON.stringify(request));
  });

  it('uses a bounded default timeout and permits a per-request publication timeout up to 180 seconds', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ displayName: 'App' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'UPLOADED' }));
    const client = makeClient(fetcher);

    await client.get('/app');
    await client.post('/publications/companion-pull-request/proposal-blobs', {}, {
      timeoutMs: 180_000,
    });

    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 10_000);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 180_000);
  });

  it('rejects an out-of-range timeout without making a network request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = makeClient(fetcher);

    await expect(client.post('/app', {}, { timeoutMs: 180_001 })).rejects.toMatchObject({
      code: 'GITHUB_UPSTREAM_UNAVAILABLE',
      status: undefined,
      retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('translates network failures without retaining raw error text, URL, or request secrets', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`failed ${BASE_URL}/secret?token=${SERVICE_TOKEN}`));
    const client = makeClient(fetcher);

    let caught: unknown;
    try {
      await client.post('/repositories/tree', { content: 'private-body' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GithubIntegrationClientError);
    expect(caught).toMatchObject({
      code: 'GITHUB_UPSTREAM_UNAVAILABLE',
      status: undefined,
      retryable: true,
    });
    expect((caught as Error).message).not.toContain(BASE_URL);
    expect((caught as Error).message).not.toContain(SERVICE_TOKEN);
    expect((caught as Error).message).not.toContain('private-body');
  });

  it('preserves only approved 401 contract fields and discards raw messages and correlation IDs', async () => {
    const rawMessage = `bearer ${SERVICE_TOKEN} rejected at ${BASE_URL}`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          code: 'SERVICE_UNAUTHORIZED',
          message: rawMessage,
          retryable: false,
          correlationId: 'upstream-correlation-secret',
        },
        401,
      ),
    );
    const client = makeClient(fetcher);

    let caught: unknown;
    try {
      await client.get('/app');
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'SERVICE_UNAUTHORIZED', status: 401, retryable: false });
    expect(Object.keys(caught as object).sort()).toEqual(['code', 'retryable', 'status']);
    expect((caught as Error).message).not.toContain(rawMessage);
    expect((caught as Error).message).not.toContain('upstream-correlation-secret');
    expect((caught as Error).message).not.toContain(SERVICE_TOKEN);
  });

  it('reduces unknown 5xx and 429 responses to neutral retryable errors', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ code: 'INTERNAL_ERROR', message: `raw ${SERVICE_TOKEN}`, retryable: false }, 500),
      )
      .mockResolvedValueOnce(
        jsonResponse({ message: `rate limited ${BASE_URL}/signed` }, 429),
      );
    const client = makeClient(fetcher);

    await expect(client.get('/app')).rejects.toMatchObject({
      code: 'GITHUB_UPSTREAM_UNAVAILABLE',
      status: 500,
      retryable: true,
    });
    await expect(client.get('/app')).rejects.toMatchObject({
      code: 'GITHUB_UPSTREAM_UNAVAILABLE',
      status: 429,
      retryable: true,
    });
  });

  it('does not propagate unrecognized contract codes or messages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: 'RAW_PROVIDER_FAILURE', message: SERVICE_TOKEN, retryable: false }, 400),
    );
    const client = makeClient(fetcher);

    let caught: unknown;
    try {
      await client.post('/app', {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'GITHUB_UPSTREAM_UNAVAILABLE',
      status: 400,
      retryable: false,
    });
    expect((caught as Error).message).not.toContain(SERVICE_TOKEN);
  });

  it('returns undefined for 204 and rejects absolute or traversal paths without fetching', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = makeClient(fetcher);

    await expect(client.post('/checks', {})).resolves.toBeUndefined();
    await expect(client.get('https://attacker.example/path')).rejects.toMatchObject({
      code: 'GITHUB_UPSTREAM_UNAVAILABLE',
    });
    await expect(client.get('/repositories/../app')).rejects.toMatchObject({
      code: 'GITHUB_UPSTREAM_UNAVAILABLE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects non-HTTPS remote endpoints and permits loopback HTTP only outside production', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ displayName: 'App' }));
    const remoteHttpClient = makeClient(fetcher, { GITHUB_INTEGRATION_API_BASE_URL: 'http://integration.internal' });
    const productionLoopbackClient = makeClient(fetcher, {
      NODE_ENV: 'production', GITHUB_INTEGRATION_API_BASE_URL: 'http://localhost:3002',
    });
    const developmentLoopbackClient = makeClient(fetcher, {
      NODE_ENV: 'development', GITHUB_INTEGRATION_API_BASE_URL: 'http://localhost:3002',
    });

    await expect(remoteHttpClient.get('/app')).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_UNAVAILABLE' });
    await expect(productionLoopbackClient.get('/app')).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_UNAVAILABLE' });
    await expect(developmentLoopbackClient.get('/app')).resolves.toEqual({ displayName: 'App' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
