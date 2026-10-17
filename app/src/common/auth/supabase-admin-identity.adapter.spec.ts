import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseAdminIdentityAdapter, toGithubIdentity } from './supabase-admin-identity.adapter.js';
import { SupabaseIdentityUnavailableError } from './supabase-identity.port.js';

const config = {
  getOrThrow: (key: string) => (key === 'SUPABASE_URL' ? 'https://project.supabase.co' : 'service-key'),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('SupabaseAdminIdentityAdapter (HU62)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  const adapter = () => new SupabaseAdminIdentityAdapter(config as never);

  it('queries the Admin API by sub with the service credential and reads identities[].id of the github provider', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'sub-1',
        identities: [
          { provider: 'email', id: 'not-numeric' },
          { provider: 'github', id: '4242', identity_data: { user_name: 'octocat', provider_id: '4242' } },
        ],
      }),
    );

    await expect(adapter().getGithubIdentity('sub-1')).resolves.toEqual({
      githubUserId: '4242',
      login: 'octocat',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/auth/v1/admin/users/sub-1');
    expect(init.headers).toMatchObject({ apikey: 'service-key', Authorization: 'Bearer service-key' });
  });

  it('ignores a forged user_metadata: only identities[] of the provider counts', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'sub-1',
        user_metadata: { provider_id: '666', sub: '666', user_name: 'admin-of-everything' },
        identities: [{ provider: 'github', id: '4242', identity_data: {} }],
      }),
    );

    await expect(adapter().getGithubIdentity('sub-1')).resolves.toEqual({ githubUserId: '4242' });
  });

  it('never trusts user_metadata when there is no github identity', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'sub-1',
        user_metadata: { provider_id: '666', sub: '666' },
        identities: [{ provider: 'email', id: 'abc' }],
      }),
    );

    await expect(adapter().getGithubIdentity('sub-1')).resolves.toBeNull();
  });

  it('returns null when the user has no identities at all (null or missing)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'sub-1', identities: null }));
    await expect(adapter().getGithubIdentity('sub-1')).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'sub-1' }));
    await expect(adapter().getGithubIdentity('sub-1')).resolves.toBeNull();
  });

  it('returns null when Supabase does not know the user (404)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ msg: 'User not found' }, 404));

    await expect(adapter().getGithubIdentity('sub-1')).resolves.toBeNull();
  });

  it.each([500, 502, 401, 403])('reports the Admin API as unavailable on %s', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ msg: 'boom' }, status));

    await expect(adapter().getGithubIdentity('sub-1')).rejects.toBeInstanceOf(SupabaseIdentityUnavailableError);
  });

  it('reports the Admin API as unavailable on a network error or timeout', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(adapter().getGithubIdentity('sub-1')).rejects.toBeInstanceOf(SupabaseIdentityUnavailableError);
  });

  it('reports the Admin API as unavailable on a body that is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));

    await expect(adapter().getGithubIdentity('sub-1')).rejects.toBeInstanceOf(SupabaseIdentityUnavailableError);
  });
});

describe('toGithubIdentity', () => {
  it('falls back to identity_data.provider_id when id is an identity UUID, never to user_metadata', () => {
    expect(
      toGithubIdentity({
        identities: [{ provider: 'github', id: 'b2f3c1e0-0000-0000-0000-000000000000', identity_data: { provider_id: '4242' } }],
      }),
    ).toEqual({ githubUserId: '4242' });
  });

  it('returns null when neither id nor provider_id is numeric', () => {
    expect(
      toGithubIdentity({ identities: [{ provider: 'github', id: 'abc', identity_data: { provider_id: 'xyz' } }] }),
    ).toBeNull();
  });
});
