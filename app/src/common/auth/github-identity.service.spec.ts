import { describe, expect, it, vi } from 'vitest';
import { GithubIdentityService } from './github-identity.service.js';
import { FakeSupabaseIdentityPort } from '../../../test/support/fake-supabase-identity.port.js';
import { InMemoryUserGithubIdentitiesRepository } from '../../../test/support/in-memory-user-github-identities.repository.js';

function makeService(options: { bypass?: boolean; nodeEnv?: string } = {}) {
  const config = {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key === 'AUTH_BYPASS_ENABLED') return options.bypass ?? false;
      if (key === 'NODE_ENV') return options.nodeEnv ?? 'test';
      return fallback;
    }),
    getOrThrow: vi.fn((key: string) => {
      if (key === 'AUTH_BYPASS_GITHUB_USER_ID') return '900000001';
      throw new Error(`missing ${key}`);
    }),
  };
  const identities = new InMemoryUserGithubIdentitiesRepository();
  const supabase = new FakeSupabaseIdentityPort();
  const service = new GithubIdentityService(config as never, identities as never, supabase);
  return { service, identities, supabase };
}

describe('GithubIdentityService (HU62)', () => {
  it('resolves the GitHub identity through the Admin API once and persists the link', async () => {
    const { service, identities, supabase } = makeService();
    supabase.setIdentity('sub-1', { githubUserId: '4242', login: 'octocat' });

    await expect(service.resolve('sub-1')).resolves.toBe('4242');

    expect(identities.rows.get('sub-1')).toMatchObject({ githubUserId: '4242', githubLogin: 'octocat' });
  });

  it('serves a persisted link without calling Supabase again', async () => {
    const { service, supabase } = makeService();
    supabase.setIdentity('sub-1', { githubUserId: '4242' });

    await service.resolve('sub-1');
    await service.resolve('sub-1');

    expect(supabase.calls).toEqual(['sub-1']);
  });

  it('answers 401 GITHUB_IDENTITY_REQUIRED for a valid user without a GitHub identity, persisting nothing', async () => {
    const { service, identities, supabase } = makeService();
    supabase.setIdentity('sub-1', null);

    await expect(service.resolve('sub-1')).rejects.toMatchObject({
      code: 'GITHUB_IDENTITY_REQUIRED',
      status: 401,
    });
    expect(identities.rows.size).toBe(0);
  });

  it('answers 503 IDENTITY_UNAVAILABLE when the Admin API is down and there is no persisted link', async () => {
    const { service, identities, supabase } = makeService();
    supabase.setUnavailable(true);

    await expect(service.resolve('sub-1')).rejects.toMatchObject({
      code: 'IDENTITY_UNAVAILABLE',
      status: 503,
    });
    expect(identities.rows.size).toBe(0);
  });

  it('keeps working with the Admin API down when the link is already persisted', async () => {
    const { service, supabase } = makeService();
    supabase.setIdentity('sub-1', { githubUserId: '4242' });
    await service.resolve('sub-1');

    supabase.setUnavailable(true);

    await expect(service.resolve('sub-1')).resolves.toBe('4242');
    expect(supabase.calls).toHaveLength(1);
  });

  it('rejects a GitHub account already linked to another Supabase user instead of sharing it', async () => {
    const { service, supabase } = makeService();
    supabase.setIdentity('sub-1', { githubUserId: '4242' });
    supabase.setIdentity('sub-2', { githubUserId: '4242' });
    await service.resolve('sub-1');

    await expect(service.resolve('sub-2')).rejects.toMatchObject({ code: 'GITHUB_IDENTITY_REQUIRED' });
  });

  it('returns the winner link when a concurrent request of the same user persisted first', async () => {
    const { service, identities, supabase } = makeService();
    supabase.setIdentity('sub-1', { githubUserId: '4242' });
    const realCreate = identities.create.bind(identities);
    identities.create = async (...args) => {
      await realCreate(...args); // la otra petición persiste primero
      return realCreate(...args); // y la nuestra choca con la unicidad
    };

    await expect(service.resolve('sub-1')).resolves.toBe('4242');
  });

  it('rethrows unexpected persistence errors untouched', async () => {
    const { service, identities, supabase } = makeService();
    supabase.setIdentity('sub-1', { githubUserId: '4242' });
    const boom = new Error('connection lost');
    identities.create = () => Promise.reject(boom);

    await expect(service.resolve('sub-1')).rejects.toBe(boom);
  });

  it('under AUTH_BYPASS returns the synthetic identity without touching the database or Supabase', async () => {
    const { service, identities, supabase } = makeService({ bypass: true });
    const findSpy = vi.spyOn(identities, 'findByUserId');

    await expect(service.resolve('local-dev-user')).resolves.toBe('900000001');

    expect(supabase.calls).toEqual([]);
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('refuses the synthetic identity in production even if the bypass flag leaked through', async () => {
    const { service } = makeService({ bypass: true, nodeEnv: 'production' });

    await expect(service.resolve('local-dev-user')).rejects.toThrow(/production/);
  });
});
