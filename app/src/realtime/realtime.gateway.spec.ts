import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { InvalidTokenError } from '../common/auth/token-verifier.port.js';

function makeSocket(userId = 'user-1', id = 'socket-1') {
  return {
    id,
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    data: { userId },
  };
}

function makeGateway() {
  const sessionAuth = { authenticate: vi.fn() };
  const projectAccess = {
    requireForResource: vi.fn().mockResolvedValue({ project: { id: 'project-1' }, role: 'READER' }),
  };
  const subscriptions = {
    track: vi.fn(),
    untrack: vi.fn(),
    trackRoom: vi.fn(),
    untrackRoom: vi.fn(),
    forget: vi.fn(),
    revalidateSocket: vi.fn().mockResolvedValue(true),
  };
  const gateway = new RealtimeGateway(sessionAuth as never, projectAccess as never, subscriptions as never);
  return { gateway, projectAccess, sessionAuth, subscriptions };
}

function attachServer(gateway: RealtimeGateway) {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const server = { to };
  (gateway as unknown as { server: typeof server }).server = server;
  return { to, emit };
}

describe('RealtimeGateway', () => {
  describe('subscribe:project-version (SubscribeAck, INTEROP-2.4 §6.6)', () => {
    it('requires at least the Reader role on the Project of the version, joins the room and acks { subscribed: true }', async () => {
      const { gateway, projectAccess, subscriptions } = makeGateway();
      const client = makeSocket();

      const ack = await gateway.subscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

      expect(projectAccess.requireForResource).toHaveBeenCalledWith('user-1', 'projectVersion', 'version-1', 'READER');
      expect(client.join).toHaveBeenCalledWith('project-version:version-1');
      expect(subscriptions.track).toHaveBeenCalledWith(client, 'user-1', 'version-1', 'project-1');
      expect(ack).toEqual({ subscribed: true, code: null, retryable: false });
    });

    it('registers the socket BEFORE joining the room and re-checks visibility AFTER (race with a revocation)', async () => {
      const { gateway, subscriptions } = makeGateway();
      const client = makeSocket();
      const order: string[] = [];
      subscriptions.track.mockImplementation(() => order.push('track'));
      client.join.mockImplementation(() => Promise.resolve(order.push('join')));
      subscriptions.revalidateSocket.mockImplementation(() => Promise.resolve(order.push('revalidate') > 0));

      await gateway.subscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

      expect(order).toEqual(['track', 'join', 'revalidate']);
      expect(subscriptions.revalidateSocket).toHaveBeenCalledWith('socket-1', 'project-1');
    });

    it('a revocation that lands between the verification and the registration: evicted, leaves the room and acks { false, null, false }', async () => {
      const { gateway, subscriptions } = makeGateway();
      const client = makeSocket();
      subscriptions.revalidateSocket.mockResolvedValue(false); // el usuario ya no ve el Project

      const ack = await gateway.subscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

      expect(ack).toEqual({ subscribed: false, code: null, retryable: false });
      expect(client.leave).toHaveBeenCalledWith('project-version:version-1');
    });

    it('a failure joining the room unregisters the socket and propagates', async () => {
      const { gateway, subscriptions } = makeGateway();
      const client = makeSocket();
      client.join.mockRejectedValue(new Error('adapter down'));

      await expect(gateway.subscribeProjectVersion(client as never, { projectVersionId: 'version-1' })).rejects.toThrow('adapter down');
      expect(subscriptions.untrack).toHaveBeenCalledWith('socket-1', 'version-1');
    });

    it('acks { false, GITHUB_VERIFICATION_UNAVAILABLE, retryable: true } when GitHub cannot verify the access, without joining', async () => {
      const { gateway, projectAccess, subscriptions } = makeGateway();
      projectAccess.requireForResource.mockRejectedValue(
        new AppException(ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE, 'sin GitHub', 503),
      );
      const client = makeSocket();

      const ack = await gateway.subscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

      expect(ack).toEqual({ subscribed: false, code: 'GITHUB_VERIFICATION_UNAVAILABLE', retryable: true });
      expect(client.join).not.toHaveBeenCalled();
      expect(subscriptions.track).not.toHaveBeenCalled();
    });

    it.each([
      ['a version the user cannot see (PROJECT_VERSION_NOT_FOUND)', ErrorCode.PROJECT_VERSION_NOT_FOUND],
      ['a missing version', ErrorCode.PROJECT_VERSION_NOT_FOUND],
    ])('acks { false, null, retryable: false } for %s, indistinguishable from each other', async (_label, code) => {
      const { gateway, projectAccess } = makeGateway();
      projectAccess.requireForResource.mockRejectedValue(new AppException(code, 'no existe', 404));
      const client = makeSocket();

      const ack = await gateway.subscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

      expect(ack).toEqual({ subscribed: false, code: null, retryable: false });
      expect(client.join).not.toHaveBeenCalled();
    });

    it.each([[undefined], [{}], [{ projectVersionId: 7 }], [{ projectVersionId: '' }]])(
      'acks not visible without touching the access service for a malformed body (%j)',
      async (body) => {
        const { gateway, projectAccess } = makeGateway();

        const ack = await gateway.subscribeProjectVersion(makeSocket() as never, body as never);

        expect(ack).toEqual({ subscribed: false, code: null, retryable: false });
        expect(projectAccess.requireForResource).not.toHaveBeenCalled();
      },
    );

    it('does not swallow an unexpected error as an ack', async () => {
      const { gateway, projectAccess } = makeGateway();
      projectAccess.requireForResource.mockRejectedValue(new Error('boom'));

      await expect(
        gateway.subscribeProjectVersion(makeSocket() as never, { projectVersionId: 'version-1' }),
      ).rejects.toThrow('boom');
    });
  });

  describe('subscribe:analysis-run y subscribe:experiment (WI-CORE-074, D1)', () => {
    const cases = [
      {
        label: 'analysis-run',
        subscribe: (gateway: RealtimeGateway, socket: unknown, id: string) =>
          gateway.subscribeAnalysisRun(socket as never, { analysisRunId: id }),
        unsubscribe: (gateway: RealtimeGateway, socket: unknown, id: string) =>
          gateway.unsubscribeAnalysisRun(socket as never, { analysisRunId: id }),
        resource: 'analysisRun',
        room: (id: string) => `analysis-run:${id}`,
        notFound: ErrorCode.ANALYSIS_RUN_NOT_FOUND,
      },
      {
        label: 'experiment',
        subscribe: (gateway: RealtimeGateway, socket: unknown, id: string) =>
          gateway.subscribeExperiment(socket as never, { experimentId: id }),
        unsubscribe: (gateway: RealtimeGateway, socket: unknown, id: string) =>
          gateway.unsubscribeExperiment(socket as never, { experimentId: id }),
        resource: 'experiment',
        room: (id: string) => `experiment:${id}`,
        notFound: ErrorCode.EXPERIMENT_NOT_FOUND,
      },
    ] as const;

    it.each(cases)('$label: a Reader joins the room of that id, registers the Project and acks { subscribed: true }', async (c) => {
      const { gateway, projectAccess, subscriptions } = makeGateway();
      const client = makeSocket();

      const ack = await c.subscribe(gateway, client, 'res-1');

      expect(projectAccess.requireForResource).toHaveBeenCalledWith('user-1', c.resource, 'res-1', 'READER');
      expect(client.join).toHaveBeenCalledWith(c.room('res-1'));
      expect(subscriptions.trackRoom).toHaveBeenCalledWith(client, 'user-1', c.room('res-1'), 'project-1');
      expect(ack).toEqual({ subscribed: true, code: null, retryable: false });
    });

    it.each(cases)('$label: registers before joining and re-checks visibility after (race with a revocation)', async (c) => {
      const { gateway, subscriptions } = makeGateway();
      const client = makeSocket();
      const order: string[] = [];
      subscriptions.trackRoom.mockImplementation(() => order.push('track'));
      client.join.mockImplementation(() => Promise.resolve(order.push('join')));
      subscriptions.revalidateSocket.mockImplementation(() => Promise.resolve(order.push('revalidate') > 0));

      await c.subscribe(gateway, client, 'res-1');

      expect(order).toEqual(['track', 'join', 'revalidate']);
    });

    it.each(cases)('$label: a revocation between verification and registration leaves the room and acks not visible', async (c) => {
      const { gateway, subscriptions } = makeGateway();
      const client = makeSocket();
      subscriptions.revalidateSocket.mockResolvedValue(false);

      const ack = await c.subscribe(gateway, client, 'res-1');

      expect(ack).toEqual({ subscribed: false, code: null, retryable: false });
      expect(client.leave).toHaveBeenCalledWith(c.room('res-1'));
    });

    it.each(cases)('$label: an id that does not exist acks the same denial as a non-visible one, without joining', async (c) => {
      const { gateway, projectAccess } = makeGateway();
      projectAccess.requireForResource.mockRejectedValue(new AppException(c.notFound, 'no existe', 404));
      const client = makeSocket();

      const ack = await c.subscribe(gateway, client, 'missing');

      expect(ack).toEqual({ subscribed: false, code: null, retryable: false });
      expect(client.join).not.toHaveBeenCalled();
    });

    it.each(cases)('$label: acks GITHUB_VERIFICATION_UNAVAILABLE as retryable without joining', async (c) => {
      const { gateway, projectAccess } = makeGateway();
      projectAccess.requireForResource.mockRejectedValue(new AppException(ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE, 'sin GitHub', 503));
      const client = makeSocket();

      const ack = await c.subscribe(gateway, client, 'res-1');

      expect(ack).toEqual({ subscribed: false, code: 'GITHUB_VERIFICATION_UNAVAILABLE', retryable: true });
      expect(client.join).not.toHaveBeenCalled();
    });

    it.each(cases)('$label: a malformed body acks not visible without touching the access service', async (c) => {
      const { gateway, projectAccess } = makeGateway();

      await expect(c.subscribe(gateway, makeSocket(), '')).resolves.toEqual({ subscribed: false, code: null, retryable: false });
      expect(projectAccess.requireForResource).not.toHaveBeenCalled();
    });

    it.each(cases)('$label: an unexpected error propagates and does not register the socket', async (c) => {
      const { gateway, projectAccess, subscriptions } = makeGateway();
      projectAccess.requireForResource.mockRejectedValue(new Error('boom'));

      await expect(c.subscribe(gateway, makeSocket(), 'res-1')).rejects.toThrow('boom');
      expect(subscriptions.trackRoom).not.toHaveBeenCalled();
    });

    it.each(cases)('$label: a failure joining unregisters the room and propagates', async (c) => {
      const { gateway, subscriptions } = makeGateway();
      const client = makeSocket();
      client.join.mockRejectedValue(new Error('adapter down'));

      await expect(c.subscribe(gateway, client, 'res-1')).rejects.toThrow('adapter down');
      expect(subscriptions.untrackRoom).toHaveBeenCalledWith('socket-1', c.room('res-1'));
    });

    it.each(cases)('$label: unsubscribe leaves only that room and drops its registration', (c) => {
      const { gateway, subscriptions } = makeGateway();
      const client = makeSocket();

      c.unsubscribe(gateway, client, 'res-1');

      expect(client.leave).toHaveBeenCalledWith(c.room('res-1'));
      expect(subscriptions.untrackRoom).toHaveBeenCalledWith('socket-1', c.room('res-1'));
    });
  });

  describe('puerto de publicación RealtimePublisher (WI-CORE-074)', () => {
    it('hasSubscribers is true only when the room has at least one socket', () => {
      const { gateway } = makeGateway();
      const rooms = new Map([['analysis-run:r1', new Set(['socket-1'])], ['analysis-run:r2', new Set<string>()]]);
      (gateway as unknown as { server: unknown }).server = { sockets: { adapter: { rooms } } };

      expect(gateway.hasSubscribers('analysis-run:r1')).toBe(true);
      expect(gateway.hasSubscribers('analysis-run:r2')).toBe(false);
      expect(gateway.hasSubscribers('experiment:none')).toBe(false);
    });

    it('hasSubscribers is false before the socket.io server is attached', () => {
      const { gateway } = makeGateway();

      expect(gateway.hasSubscribers('experiment:e1')).toBe(false);
    });

    it('publish emits the event only to the given room and never broadcasts', () => {
      const { gateway } = makeGateway();
      const { to, emit } = attachServer(gateway);

      gateway.publish('experiment:e1', 'experiment:update', { id: 'e1' });

      expect(to).toHaveBeenCalledWith('experiment:e1');
      expect(to).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('experiment:update', { id: 'e1' });
    });

    it('publish is a no-op before the server is attached', () => {
      const { gateway } = makeGateway();

      expect(() => gateway.publish('experiment:e1', 'experiment:update', {})).not.toThrow();
    });
  });

  it('leaves the project-version room named after the given id and drops the subscription', () => {
    const { gateway, subscriptions } = makeGateway();
    const client = makeSocket();

    gateway.unsubscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

    expect(client.leave).toHaveBeenCalledWith('project-version:version-1');
    expect(subscriptions.untrack).toHaveBeenCalledWith('socket-1', 'version-1');
  });

  it('forgets every subscription of a socket on disconnect', () => {
    const { gateway, subscriptions } = makeGateway();

    gateway.handleDisconnect(makeSocket() as never);

    expect(subscriptions.forget).toHaveBeenCalledWith('socket-1');
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

    it('rejects a socket without a token with AUTH_REQUIRED, before any authentication (WI-CORE-074, D1/D2)', async () => {
      const { gateway, sessionAuth } = makeGateway();
      const connect = attachMiddleware(gateway);

      const { error, socket } = await connect({ headers: {} });

      expect(error?.data).toMatchObject({ code: 'AUTH_REQUIRED', retryable: false });
      expect(sessionAuth.authenticate).not.toHaveBeenCalled();
      expect(socket.data).toEqual({});
    });

    it('rejects an empty auth.token the same way as a missing one', async () => {
      const { gateway, sessionAuth } = makeGateway();
      const connect = attachMiddleware(gateway);

      const { error } = await connect({ auth: { token: '' }, headers: { authorization: 'Bearer ' } });

      expect(error?.data).toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(sessionAuth.authenticate).not.toHaveBeenCalled();
    });

    it('passes any non-empty token to the same resolver as HTTP, so AUTH_BYPASS keeps HTTP semantics (token required, not verified)', async () => {
      const { gateway, sessionAuth } = makeGateway();
      sessionAuth.authenticate.mockResolvedValue({ userId: 'local-dev-user', githubUserId: '900000001' });
      const connect = attachMiddleware(gateway);

      const { error, socket } = await connect({ auth: { token: 'cualquier-cosa' }, headers: {} });

      expect(error).toBeUndefined();
      expect(sessionAuth.authenticate).toHaveBeenCalledWith('cualquier-cosa');
      expect(socket.data).toMatchObject({ userId: 'local-dev-user' });
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
