import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway.js';

function makeSocket(userId = 'user-1') {
  return {
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    data: { userId },
  };
}

function makeGateway(options: { projectVersionOwned?: boolean; testRunOwned?: boolean } = {}) {
  const { projectVersionOwned = true, testRunOwned = true } = options;
  const projectVersionsRepository = {
    findByIdForOwner: vi.fn().mockResolvedValue(projectVersionOwned ? { id: 'version-1' } : null),
  };
  const testGenerationRunsRepository = {
    findByIdForOwner: vi.fn().mockResolvedValue(testRunOwned ? { id: 'run-1' } : null),
  };
  const gateway = new RealtimeGateway(
    projectVersionsRepository as never,
    testGenerationRunsRepository as never,
  );
  return { gateway, projectVersionsRepository, testGenerationRunsRepository };
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

  it('joins the test-run room when the caller owns it', async () => {
    const { gateway } = makeGateway();
    const client = makeSocket();

    await gateway.subscribeTestRun(client as never, { testRunId: 'run-1' });

    expect(client.join).toHaveBeenCalledWith('test-run:run-1');
  });

  it('does not join the test-run room when the caller does not own it', async () => {
    const { gateway, testGenerationRunsRepository } = makeGateway({ testRunOwned: false });
    const client = makeSocket();

    await gateway.subscribeTestRun(client as never, { testRunId: 'run-1' });

    expect(testGenerationRunsRepository.findByIdForOwner).toHaveBeenCalledWith('run-1', 'user-1');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('leaves the test-run room named after the given id', () => {
    const { gateway } = makeGateway();
    const client = makeSocket();

    gateway.unsubscribeTestRun(client as never, { testRunId: 'run-1' });

    expect(client.leave).toHaveBeenCalledWith('test-run:run-1');
  });

  it('emits project-version:update only to that project version room', () => {
    const { gateway } = makeGateway();
    const { to, emit } = attachServer(gateway);
    const payload = { id: 'version-1', status: 'COMPLETED' } as never;

    gateway.emitProjectVersionUpdate('version-1', payload);

    expect(to).toHaveBeenCalledWith('project-version:version-1');
    expect(emit).toHaveBeenCalledWith('project-version:update', payload);
  });

  it('emits test-run:update only to that test run room', () => {
    const { gateway } = makeGateway();
    const { to, emit } = attachServer(gateway);
    const payload = { id: 'run-1', status: 'COMPLETED' } as never;

    gateway.emitTestRunUpdate('run-1', payload);

    expect(to).toHaveBeenCalledWith('test-run:run-1');
    expect(emit).toHaveBeenCalledWith('test-run:update', payload);
  });

  it('does not throw when emitting before the socket.io server is attached', () => {
    const { gateway } = makeGateway();

    expect(() =>
      gateway.emitProjectVersionUpdate('version-1', { id: 'version-1' } as never),
    ).not.toThrow();
    expect(() => gateway.emitTestRunUpdate('run-1', { id: 'run-1' } as never)).not.toThrow();
  });
});
