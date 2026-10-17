import { describe, expect, it, vi } from 'vitest';
import { SessionAuthService } from './session-auth.service.js';
import { InvalidTokenError } from './token-verifier.port.js';

function makeService(options: { bypass?: boolean } = {}) {
  const config = {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key === 'AUTH_BYPASS_ENABLED') return options.bypass ?? false;
      if (key === 'AUTH_BYPASS_USER_ID') return 'local-dev-user';
      return fallback;
    }),
  };
  const identity = { resolve: vi.fn().mockResolvedValue('4242') };
  const verifier = { verify: vi.fn().mockResolvedValue({ userId: 'user-1' }) };
  const service = new SessionAuthService(config as never, identity as never, verifier as never);
  return { service, identity, verifier };
}

describe('SessionAuthService', () => {
  it('verifies the token and resolves the GitHub identity of its sub', async () => {
    const { service, identity, verifier } = makeService();

    await expect(service.authenticate('token')).resolves.toEqual({ userId: 'user-1', githubUserId: '4242' });
    expect(verifier.verify).toHaveBeenCalledWith('token');
    expect(identity.resolve).toHaveBeenCalledWith('user-1');
  });

  it('propagates InvalidTokenError without resolving any identity', async () => {
    const { service, identity, verifier } = makeService();
    verifier.verify.mockRejectedValue(new InvalidTokenError('expired'));

    await expect(service.authenticate('token')).rejects.toBeInstanceOf(InvalidTokenError);
    expect(identity.resolve).not.toHaveBeenCalled();
  });

  it('under AUTH_BYPASS uses the configured user and never calls the verifier', async () => {
    const { service, identity, verifier } = makeService({ bypass: true });

    await expect(service.authenticate('anything')).resolves.toEqual({
      userId: 'local-dev-user',
      githubUserId: '4242',
    });
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(identity.resolve).toHaveBeenCalledWith('local-dev-user');
  });
});
