import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { AuthGuard } from './auth.guard.js';
import { InvalidTokenError } from './token-verifier.port.js';

function makeHttpContext(headers: Record<string, string> = {}) {
  const request: { headers: Record<string, string>; userId?: string } = { headers };
  const context = {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeWsContext(handshake: { auth?: Record<string, unknown>; headers?: Record<string, string> }) {
  const client: { handshake: typeof handshake; data: Record<string, unknown> } = {
    handshake,
    data: {},
  };
  const context = {
    getType: () => 'ws',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToWs: () => ({ getClient: () => client }),
  } as unknown as ExecutionContext;
  return { context, client };
}

function makeGuard(options: {
  isPublic?: boolean;
  verify?: (token: string) => Promise<{ userId: string }>;
  bypassEnabled?: boolean;
  bypassUserId?: string;
}) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(options.isPublic ?? false) };
  const config = {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key === 'AUTH_BYPASS_ENABLED') return options.bypassEnabled ?? false;
      if (key === 'AUTH_BYPASS_USER_ID') return options.bypassUserId ?? 'local-dev-user';
      return fallback;
    }),
  };
  const verifier = { verify: options.verify ?? vi.fn() };
  const guard = new AuthGuard(reflector as never, config as never, verifier as never);
  return { guard, reflector, config, verifier };
}

describe('AuthGuard', () => {
  it('allows a route decorated with @Public() without checking the token', async () => {
    const { guard } = makeGuard({ isPublic: true });
    const { context } = makeHttpContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects an HTTP request without an Authorization header', async () => {
    const { guard } = makeGuard({});
    const { context } = makeHttpContext();

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'AUTH_REQUIRED' },
    });
  });

  it('rejects an HTTP request whose token fails verification', async () => {
    const verify = vi.fn().mockRejectedValue(new InvalidTokenError('expired'));
    const { guard } = makeGuard({ verify });
    const { context } = makeHttpContext({ authorization: 'Bearer bad-token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'INVALID_ACCESS_TOKEN' },
    });
  });

  it('attaches the verified userId to the request on success', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 'user-1' });
    const { guard } = makeGuard({ verify });
    const { context, request } = makeHttpContext({ authorization: 'Bearer good-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.userId).toBe('user-1');
    expect(verify).toHaveBeenCalledWith('good-token');
  });

  it('uses the bypass user id without calling the verifier when AUTH_BYPASS_ENABLED is true', async () => {
    const verify = vi.fn();
    const { guard } = makeGuard({ verify, bypassEnabled: true, bypassUserId: 'local-dev-user' });
    const { context, request } = makeHttpContext({ authorization: 'Bearer anything' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.userId).toBe('local-dev-user');
    expect(verify).not.toHaveBeenCalled();
  });

  it('reads the token from the ws handshake auth payload and attaches userId to client.data', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 'user-1' });
    const { guard } = makeGuard({ verify });
    const { context, client } = makeWsContext({ auth: { token: 'ws-token' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(client.data.userId).toBe('user-1');
    expect(verify).toHaveBeenCalledWith('ws-token');
  });

  it('falls back to the ws handshake Authorization header when auth.token is absent', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 'user-1' });
    const { guard } = makeGuard({ verify });
    const { context } = makeWsContext({ headers: { authorization: 'Bearer header-token' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('header-token');
  });

  it('throws a WsException (not AppException) when a ws token is missing', async () => {
    const { guard } = makeGuard({});
    const { context } = makeWsContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(WsException);
  });
});
