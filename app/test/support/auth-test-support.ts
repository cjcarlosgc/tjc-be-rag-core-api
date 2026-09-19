import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AUTH_TOKEN_VERIFIER } from '../../src/common/auth/auth.constants.js';
import type { TokenVerifierPort } from '../../src/common/auth/token-verifier.port.js';

export const E2E_TEST_USER_ID = 'e2e-test-user';

/**
 * El access token real es opaco y se verifica contra Supabase Auth (JWKS).
 * En e2e se sustituye por un verificador determinista: el token ES el
 * userId, así los tests pueden simular usuarios distintos sin firmar JWTs.
 */
export function overrideAuthTokenVerifier(builder: TestingModuleBuilder): TestingModuleBuilder {
  const verifier: TokenVerifierPort = {
    verify: (token: string) => Promise.resolve({ userId: token }),
  };
  return builder.overrideProvider(AUTH_TOKEN_VERIFIER).useValue(verifier);
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
