import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { AuthGuard } from './auth.guard.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import { InvalidTokenError } from './token-verifier.port.js';

function makeHttpContext(headers: Record<string, string> = {}) {
  const request: { headers: Record<string, string>; userId?: string; githubUserId?: string } = { headers };
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
  authenticate?: (token: string) => Promise<{ userId: string; githubUserId: string }>;
}) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(options.isPublic ?? false) };
  const sessionAuth = { authenticate: options.authenticate ?? vi.fn() };
  const guard = new AuthGuard(reflector as never, sessionAuth as never);
  return { guard, sessionAuth };
}

describe('AuthGuard', () => {
  it('allows a route decorated with @Public() without checking the token', async () => {
    const { guard, sessionAuth } = makeGuard({ isPublic: true });
    const { context } = makeHttpContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessionAuth.authenticate).not.toHaveBeenCalled();
  });

  it('rejects an HTTP request without an Authorization header', async () => {
    const { guard } = makeGuard({});
    const { context } = makeHttpContext();

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'AUTH_REQUIRED' },
    });
  });

  it('rejects an HTTP request whose token fails verification', async () => {
    const authenticate = vi.fn().mockRejectedValue(new InvalidTokenError('expired'));
    const { guard } = makeGuard({ authenticate });
    const { context } = makeHttpContext({ authorization: 'Bearer bad-token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'INVALID_ACCESS_TOKEN' },
    });
  });

  it('attaches the verified userId and the GitHub identity to the request on success', async () => {
    const authenticate = vi.fn().mockResolvedValue({ userId: 'user-1', githubUserId: '4242' });
    const { guard } = makeGuard({ authenticate });
    const { context, request } = makeHttpContext({ authorization: 'Bearer good-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.userId).toBe('user-1');
    expect(request.githubUserId).toBe('4242');
    expect(authenticate).toHaveBeenCalledWith('good-token');
  });

  it('propagates GITHUB_IDENTITY_REQUIRED (401) for a valid token without GitHub identity', async () => {
    const identityError = new AppException(ErrorCode.GITHUB_IDENTITY_REQUIRED, 'sin identidad', 401);
    const { guard } = makeGuard({ authenticate: vi.fn().mockRejectedValue(identityError) });
    const { context, request } = makeHttpContext({ authorization: 'Bearer good-token' });

    await expect(guard.canActivate(context)).rejects.toBe(identityError);
    expect(request.userId).toBeUndefined();
  });

  it('propagates IDENTITY_UNAVAILABLE (503) when the identity cannot be resolved', async () => {
    const unavailable = new AppException(ErrorCode.IDENTITY_UNAVAILABLE, 'caída', 503);
    const { guard } = makeGuard({ authenticate: vi.fn().mockRejectedValue(unavailable) });
    const { context } = makeHttpContext({ authorization: 'Bearer good-token' });

    await expect(guard.canActivate(context)).rejects.toBe(unavailable);
  });

  it('still requires a bearer token under bypass (the bypass is decided by the session service)', async () => {
    const { guard, sessionAuth } = makeGuard({});
    const { context } = makeHttpContext();

    await expect(guard.canActivate(context)).rejects.toMatchObject({ response: { code: 'AUTH_REQUIRED' } });
    expect(sessionAuth.authenticate).not.toHaveBeenCalled();
  });

  it('reads the token from the ws handshake auth payload and attaches the identity to client.data', async () => {
    const authenticate = vi.fn().mockResolvedValue({ userId: 'user-1', githubUserId: '4242' });
    const { guard } = makeGuard({ authenticate });
    const { context, client } = makeWsContext({ auth: { token: 'ws-token' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(client.data.userId).toBe('user-1');
    expect(client.data.githubUserId).toBe('4242');
    expect(authenticate).toHaveBeenCalledWith('ws-token');
  });

  it('falls back to the ws handshake Authorization header when auth.token is absent', async () => {
    const authenticate = vi.fn().mockResolvedValue({ userId: 'user-1', githubUserId: '4242' });
    const { guard } = makeGuard({ authenticate });
    const { context } = makeWsContext({ headers: { authorization: 'Bearer header-token' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('header-token');
  });

  it('throws a WsException (not AppException) when a ws token is missing', async () => {
    const { guard } = makeGuard({});
    const { context } = makeWsContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(WsException);
  });

  it('turns an identity failure into a WsException carrying the code on a ws message', async () => {
    const identityError = new AppException(ErrorCode.GITHUB_IDENTITY_REQUIRED, 'sin identidad', 401);
    const { guard } = makeGuard({ authenticate: vi.fn().mockRejectedValue(identityError) });
    const { context } = makeWsContext({ auth: { token: 'ws-token' } });

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WsException);
    expect((error as WsException).getError()).toMatchObject({ code: 'GITHUB_IDENTITY_REQUIRED' });
  });
});
