import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway.js';

function makeSocket() {
  return {
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  };
}

function attachServer(gateway: RealtimeGateway) {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const server = { to };
  (gateway as unknown as { server: typeof server }).server = server;
  return { to, emit };
}

describe('RealtimeGateway', () => {
  it('joins the project-version room named after the given id', () => {
    const gateway = new RealtimeGateway();
    const client = makeSocket();

    gateway.subscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

    expect(client.join).toHaveBeenCalledWith('project-version:version-1');
  });

  it('leaves the project-version room named after the given id', () => {
    const gateway = new RealtimeGateway();
    const client = makeSocket();

    gateway.unsubscribeProjectVersion(client as never, { projectVersionId: 'version-1' });

    expect(client.leave).toHaveBeenCalledWith('project-version:version-1');
  });

  it('joins the test-run room named after the given id', () => {
    const gateway = new RealtimeGateway();
    const client = makeSocket();

    gateway.subscribeTestRun(client as never, { testRunId: 'run-1' });

    expect(client.join).toHaveBeenCalledWith('test-run:run-1');
  });

  it('leaves the test-run room named after the given id', () => {
    const gateway = new RealtimeGateway();
    const client = makeSocket();

    gateway.unsubscribeTestRun(client as never, { testRunId: 'run-1' });

    expect(client.leave).toHaveBeenCalledWith('test-run:run-1');
  });

  it('emits project-version:update only to that project version room', () => {
    const gateway = new RealtimeGateway();
    const { to, emit } = attachServer(gateway);
    const payload = { id: 'version-1', status: 'COMPLETED' } as never;

    gateway.emitProjectVersionUpdate('version-1', payload);

    expect(to).toHaveBeenCalledWith('project-version:version-1');
    expect(emit).toHaveBeenCalledWith('project-version:update', payload);
  });

  it('emits test-run:update only to that test run room', () => {
    const gateway = new RealtimeGateway();
    const { to, emit } = attachServer(gateway);
    const payload = { id: 'run-1', status: 'COMPLETED' } as never;

    gateway.emitTestRunUpdate('run-1', payload);

    expect(to).toHaveBeenCalledWith('test-run:run-1');
    expect(emit).toHaveBeenCalledWith('test-run:update', payload);
  });

  it('does not throw when emitting before the socket.io server is attached', () => {
    const gateway = new RealtimeGateway();

    expect(() =>
      gateway.emitProjectVersionUpdate('version-1', { id: 'version-1' } as never),
    ).not.toThrow();
    expect(() => gateway.emitTestRunUpdate('run-1', { id: 'run-1' } as never)).not.toThrow();
  });
});
