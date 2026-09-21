import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { InvalidTokenError } from '../common/auth/token-verifier.port.js';

function makeSocket(userId = 'user-1') {
  return {
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    data: { userId },
  };
}

function makeGateway(options: { projectVersionOwned?: boolean } = {}) {
  const { projectVersionOwned = true } = options;
  const sessionAuth = { authenticate: vi.fn() };
  const projectVersionsRepository = {
    findByIdForOwner: vi.fn().mockResolvedValue(projectVersionOwned ? { id: 'version-1' } : null),
  };
  const gateway = new RealtimeGateway(projectVersionsRepository as never, sessionAuth as never);
  return { gateway, projectVersionsRepository, sessionAuth };
}

function attachServer(gateway: RealtimeGateway) {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const server = { to };
  (gateway as unknown as { server: typeof server }).server = server;
  return { to, emit };
}

describe('RealtimeGateway', () => {
  it('joins the project-version room when the caller owns it', async () => {
    const { gateway } = makeGateway();
    const client = makeSocket();

    await gateway.subscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

    expect(client.join).toHaveBeenCalledWith('project-version:version-1');
  });

  it('does not join the project-version room when the caller does not own it', async () => {
    const { gateway, projectVersionsRepository } = makeGateway({ projectVersionOwned: false });
    const client = makeSocket();

    await gateway.subscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

    expect(projectVersionsRepository.findByIdForOwner).toHaveBeenCalledWith('version-1', 'user-1');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('leaves the project-version room named after the given id', () => {
    const { gateway } = makeGateway();
    const client = makeSocket();

    gateway.unsubscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

    expect(client.leave).toHaveBeenCalledWith('project-version:version-1');
  });

  it('emits project-version:update only to that project version room', () => {
    const { gateway } = makeGateway();
    const { to, emit } = attachServer(gateway);
    const payload = { id: 'version-1', status: 'COMPLETED' } as never;

    gateway.emitProjectVersionUpdate('version-1', payload);

    expect(to).toHaveBeenCalledWith('project-version:version-1');
    expect(emit).toHaveBeenCalledWith('project-version:update', payload);
  });

  it('does not throw when emitting before the socket.io server is attached', () => {
    const { gateway } = makeGateway();

    expect(() =>
      gateway.emitProjectVersionUpdate('version-1', { id: 'version-1' } as never),
    ).not.toThrow();
  });

  describe('handshake authentication (HU62)', () => {
    function attachMiddleware(gateway: RealtimeGateway) {
      let middleware!: (socket: unknown, next: (err?: Error) => void) => void;
      gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never);
      return (handshake: Record<string, unknown>) => {
        const socket = { handshake, data: {} as Record<string, unknown> };
        return new Promise<{ error?: Error & { data?: unknown }; socket: typeof socket }>((resolve) => {
          middleware(socket, (error) => resolve({ error: error as never, socket }));
        });
      };
    }

    it('resolves the identity from the handshake token with the same service as HTTP', async () => {
      const { gateway, sessionAuth } = makeGateway();
      sessionAuth.authenticate.mockResolvedValue({ userId: 'user-1', githubUserId: '4242' });
      const connect = attachMiddleware(gateway);

      const { error, socket } = await connect({ auth: { token: 'good' }, headers: {} });

      expect(error).toBeUndefined();
      expect(sessionAuth.authenticate).toHaveBeenCalledWith('good');
      expect(socket.data).toMatchObject({ userId: 'user-1', githubUserId: '4242' });
    });

    it('reads the token from the Authorization header when auth.token is absent', async () => {
      const { gateway, sessionAuth } = makeGateway();
      sessionAuth.authenticate.mockResolvedValue({ userId: 'user-1', githubUserId: '4242' });
      const connect = attachMiddleware(gateway);

      await connect({ headers: { authorization: 'Bearer from-header' } });

      expect(sessionAuth.authenticate).toHaveBeenCalledWith('from-header');
    });

    it('accepts a socket without a token (the per-message guard still requires it)', async () => {
      const { gateway, sessionAuth } = makeGateway();
      const connect = attachMiddleware(gateway);

      const { error } = await connect({ headers: {} });

      expect(error).toBeUndefined();
      expect(sessionAuth.authenticate).not.toHaveBeenCalled();
    });

    it('rejects an invalid token with err.data.code INVALID_ACCESS_TOKEN, not retryable', async () => {
      const { gateway, sessionAuth } = makeGateway();
      sessionAuth.authenticate.mockRejectedValue(new InvalidTokenError('expired'));
      const connect = attachMiddleware(gateway);

      const { error } = await connect({ auth: { token: 'bad' }, headers: {} });

      expect(error?.data).toMatchObject({ code: 'INVALID_ACCESS_TOKEN', retryable: false });
    });

    it('rejects a valid token without GitHub identity with GITHUB_IDENTITY_REQUIRED, not retryable', async () => {
      const { gateway, sessionAuth } = makeGateway();
      sessionAuth.authenticate.mockRejectedValue(
        new AppException(ErrorCode.GITHUB_IDENTITY_REQUIRED, 'sin identidad', 401),
      );
      const connect = attachMiddleware(gateway);

      const { error } = await connect({ auth: { token: 'good' }, headers: {} });

      expect(error?.data).toMatchObject({ code: 'GITHUB_IDENTITY_REQUIRED', retryable: false });
    });

    it('rejects with IDENTITY_UNAVAILABLE and retryable true when the identity cannot be resolved', async () => {
      const { gateway, sessionAuth } = makeGateway();
      sessionAuth.authenticate.mockRejectedValue(
        new AppException(ErrorCode.IDENTITY_UNAVAILABLE, 'caída', 503),
      );
      const connect = attachMiddleware(gateway);

      const { error } = await connect({ auth: { token: 'good' }, headers: {} });

      expect(error?.data).toMatchObject({ code: 'IDENTITY_UNAVAILABLE', retryable: true });
    });
  });
});
