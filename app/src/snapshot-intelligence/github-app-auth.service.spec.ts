import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeProtectedHeader, jwtVerify, importSPKI } from 'jose';
import { GithubAppAuthService, GithubAppUnavailableError } from './github-app-auth.service.js';

function generateTestKeyPairBase64(): { privateKeyBase64: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs1Pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

  return { privateKeyBase64: Buffer.from(pkcs1Pem, 'utf8').toString('base64'), publicKeyPem };
}

describe('GithubAppAuthService', () => {
  let service: GithubAppAuthService;
  let configService: { get: ReturnType<typeof vi.fn> };
  let keys: { privateKeyBase64: string; publicKeyPem: string };

  beforeEach(() => {
    keys = generateTestKeyPairBase64();
    configService = {
      get: vi.fn((key: string) => {
        if (key === 'GITHUB_APP_ID') return '4935151';
        if (key === 'GITHUB_APP_PRIVATE_KEY_BASE64') return keys.privateKeyBase64;
        return undefined;
      }),
    };
    service = new GithubAppAuthService(configService as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('signAppJwt', () => {
    it('signs a JWT with RS256, the App id as issuer, and a verifiable signature', async () => {
      const jwt = await service.signAppJwt();

      expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'RS256' });

      const publicKey = await importSPKI(keys.publicKeyPem, 'RS256');
      const { payload } = await jwtVerify(jwt, publicKey);

      expect(payload.iss).toBe('4935151');
      expect(payload.iat).toBeTypeOf('number');
      expect(payload.exp).toBeTypeOf('number');
      expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(9 * 60);
    });

    it('throws GithubAppUnavailableError when GITHUB_APP_ID is missing', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'GITHUB_APP_PRIVATE_KEY_BASE64' ? keys.privateKeyBase64 : undefined,
      );

      await expect(service.signAppJwt()).rejects.toBeInstanceOf(GithubAppUnavailableError);
    });

    it('throws GithubAppUnavailableError when the private key is missing', async () => {
      configService.get.mockImplementation((key: string) => (key === 'GITHUB_APP_ID' ? '4935151' : undefined));

      await expect(service.signAppJwt()).rejects.toBeInstanceOf(GithubAppUnavailableError);
    });
  });

  describe('getInstallationToken', () => {
    it('requests and returns an installation access token', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'installation-token-1', expires_at: new Date(Date.now() + 3_600_000).toISOString() }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const token = await service.getInstallationToken('999');

      expect(token).toBe('installation-token-1');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/app/installations/999/access_tokens',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }),
        }),
      );
    });

    it('reuses a cached token that is still comfortably within its expiry', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'installation-token-1', expires_at: new Date(Date.now() + 3_600_000).toISOString() }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await service.getInstallationToken('999');
      const second = await service.getInstallationToken('999');

      expect(second).toBe('installation-token-1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('requests a new token once the cached one is near expiry', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'installation-token-1', expires_at: new Date(Date.now() + 1_000).toISOString() }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'installation-token-2', expires_at: new Date(Date.now() + 3_600_000).toISOString() }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const first = await service.getInstallationToken('999');
      const second = await service.getInstallationToken('999');

      expect(first).toBe('installation-token-1');
      expect(second).toBe('installation-token-2');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws GithubAppUnavailableError when GitHub rejects the installation', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' }),
      );

      await expect(service.getInstallationToken('999')).rejects.toBeInstanceOf(GithubAppUnavailableError);
    });
  });
});
