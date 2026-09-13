import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { SupabaseJwtVerifier } from './supabase-jwt-verifier.js';
import { InvalidTokenError } from './token-verifier.port.js';

let publicKey: jose.CryptoKey;
let privateKey: jose.CryptoKey;

vi.mock('jose', async () => {
  const actual = await vi.importActual<typeof import('jose')>('jose');
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => async () => publicKey),
  };
});

const SUPABASE_URL = 'https://project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

function makeVerifier() {
  const config = { get: vi.fn().mockReturnValue(SUPABASE_URL) };
  return new SupabaseJwtVerifier(config as never);
}

async function signToken(overrides: Record<string, unknown> = {}): Promise<string> {
  return new jose.SignJWT({ sub: 'user-1', ...overrides })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

describe('SupabaseJwtVerifier', () => {
  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('ES256');
    publicKey = keyPair.publicKey;
    privateKey = keyPair.privateKey;
  });

  it('verifies a token signed with the matching key and returns its sub as userId', async () => {
    const verifier = makeVerifier();
    const token = await signToken();

    await expect(verifier.verify(token)).resolves.toEqual({ userId: 'user-1' });
  });

  it('rejects a token signed by a different key', async () => {
    const verifier = makeVerifier();
    const otherKeyPair = await jose.generateKeyPair('ES256');
    const token = await new jose.SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(otherKeyPair.privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects an expired token', async () => {
    const verifier = makeVerifier();
    const token = await new jose.SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('-1h')
      .sign(privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects a token with the wrong issuer', async () => {
    const verifier = makeVerifier();
    const token = await new jose.SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('https://impostor.supabase.co/auth/v1')
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects a token with the wrong audience', async () => {
    const verifier = makeVerifier();
    const token = await signToken();
    const wrongAudienceToken = await new jose.SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(ISSUER)
      .setAudience('anon')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(verifier.verify(wrongAudienceToken)).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(verifier.verify(token)).resolves.toEqual({ userId: 'user-1' });
  });

  it('rejects a token without a sub claim', async () => {
    const verifier = makeVerifier();
    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
