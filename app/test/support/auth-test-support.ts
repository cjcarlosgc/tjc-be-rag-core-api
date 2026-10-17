import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AUTH_TOKEN_VERIFIER } from '../../src/common/auth/auth.constants.js';
import { SUPABASE_IDENTITY_PORT } from '../../src/common/auth/supabase-identity.port.js';
import type { TokenVerifierPort } from '../../src/common/auth/token-verifier.port.js';
import { UserGithubIdentitiesRepository } from '../../src/common/auth/user-github-identities.repository.js';
import { FakeSupabaseIdentityPort } from './fake-supabase-identity.port.js';
import { InMemoryUserGithubIdentitiesRepository } from './in-memory-user-github-identities.repository.js';

export const E2E_TEST_USER_ID = 'e2e-test-user';

export interface E2eIdentityFakes {
  supabaseIdentity: FakeSupabaseIdentityPort;
  identities: InMemoryUserGithubIdentitiesRepository;
}

/** Id numérico de GitHub determinista por `sub` (cada usuario e2e tiene identidad GitHub). */
export function e2eGithubUserId(userId: string): string {
  let hash = 7;
  for (const char of userId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_007;
  }
  return String(hash + 1_000);
}

export function createE2eIdentityFakes(): E2eIdentityFakes {
  return {
    supabaseIdentity: new FakeSupabaseIdentityPort((sub) => ({ githubUserId: e2eGithubUserId(sub) })),
    identities: new InMemoryUserGithubIdentitiesRepository(),
  };
}

/**
 * El access token real es opaco y se verifica contra Supabase Auth (JWKS).
 * En e2e se sustituye por un verificador determinista: el token ES el
 * userId, así los tests pueden simular usuarios distintos sin firmar JWTs.
 * La identidad GitHub también se sustituye (fake de `SupabaseIdentityPort` y
 * repositorio en memoria): ningún e2e llama a Supabase.
 */
export function overrideAuthTokenVerifier(
  builder: TestingModuleBuilder,
  fakes: E2eIdentityFakes = createE2eIdentityFakes(),
): TestingModuleBuilder {
  const verifier: TokenVerifierPort = {
    verify: (token: string) => Promise.resolve({ userId: token }),
  };
  return builder
    .overrideProvider(AUTH_TOKEN_VERIFIER)
    .useValue(verifier)
    .overrideProvider(SUPABASE_IDENTITY_PORT)
    .useValue(fakes.supabaseIdentity)
    .overrideProvider(UserGithubIdentitiesRepository)
    .useValue(fakes.identities);
}

type Method = 'get' | 'post' | 'delete' | 'patch' | 'put';

export function authedRequest(app: INestApplication, userId: string = E2E_TEST_USER_ID) {
  const withAuth = (test: request.Test): request.Test => test.set('Authorization', `Bearer ${userId}`);
  const base = () => request(app.getHttpServer());

  return {
    get: (url: string) => withAuth(base().get(url)),
    post: (url: string) => withAuth(base().post(url)),
    delete: (url: string) => withAuth(base().delete(url)),
    patch: (url: string) => withAuth(base().patch(url)),
    put: (url: string) => withAuth(base().put(url)),
  } satisfies Partial<Record<Method, unknown>>;
}
