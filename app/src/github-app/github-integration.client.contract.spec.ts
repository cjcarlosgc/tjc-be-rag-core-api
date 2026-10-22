import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateContract } from '../contracts/contract-validator.js';
import { GithubIntegrationClient, GithubIntegrationClientError } from './github-integration.client.js';

/** Core lee los errores de GitHub Integration con el ErrorEnvelope canónico completo (INTEROP-2.17 §4, GH-INTEROP-1.8). */
const example = JSON.parse(readFileSync(resolve(__dirname, '../../../spec/contracts/schemas/examples/error-envelope.upstream.json'), 'utf8')) as Record<string, unknown>;

function client(fetcher: typeof fetch) {
  const values: Record<string, unknown> = { GITHUB_INTEGRATION_API_BASE_URL: 'https://github-integration.example.test', CORE_TO_GITHUB_INTEGRATION_TOKEN: 'service-secret-token' };
  return new GithubIntegrationClient({ get: (key: string) => values[key] } as never, fetcher);
}

describe('GithubIntegrationClient lee el ErrorEnvelope canónico', () => {
  it('el ejemplo canónico es un envelope válido', () => {
    expect(validateContract('error-envelope.schema.json', null, example).errors).toEqual([]);
  });

  it('traduce el envelope completo (con statusCode, details, timestamp, path y retryable) a un error reintentable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(example), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    const error = await client(fetcher).get('/app').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GithubIntegrationClientError);
    expect(error).toMatchObject({ code: 'GITHUB_UPSTREAM_UNAVAILABLE', status: 503, retryable: true });
  });
});
