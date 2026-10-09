import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsService } from './jobs.service.js';
import { JobsRepository } from './jobs.repository.js';
import { RescheduleJobError } from './reschedule-job.error.js';
import type { Job } from '../generated/prisma/client.js';

describe('JobsService', () => {
  let service: JobsService;
  let repository: {
    create: ReturnType<typeof vi.fn>;
    claimNext: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
    reschedule: ReturnType<typeof vi.fn>;
    releaseStale: ReturnType<typeof vi.fn>;
    insertDeduped: ReturnType<typeof vi.fn>;
    updatePendingPayload: ReturnType<typeof vi.fn>;
    touchLock: ReturnType<typeof vi.fn>;
  };
  let config: Record<string, unknown>;

  const baseJob: Job = {
    id: 'job-1',
    type: 'demo',
    payload: { foo: 'bar' },
    status: 'RUNNING',
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    availableAt: new Date(),
    lockedAt: new Date(),
    lockedBy: 'worker-1',
    dedupeKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    repository = {
      create: vi.fn(),
      claimNext: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      reschedule: vi.fn(),
      releaseStale: vi.fn().mockResolvedValue({ released: 0, exhausted: [] }),
      insertDeduped: vi.fn(),
      updatePendingPayload: vi.fn(),
      touchLock: vi.fn().mockResolvedValue(true),
    };
    config = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: JobsRepository, useValue: repository },
        {
          provide: ConfigService,
          useValue: { get: (key: string, defaultValue?: unknown) => config[key] ?? defaultValue },
        },
      ],
    }).compile();

    service = module.get(JobsService);
  });

  it('does nothing when there is no pending job', async () => {
    repository.claimNext.mockResolvedValue(null);

    await service.runOnce();

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('marks the job as failed (terminal) when no handler is registered', async () => {
    repository.claimNext.mockResolvedValue(baseJob);

    await service.runOnce();

    expect(repository.fail).toHaveBeenCalledWith(baseJob, expect.any(String), true);
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('completes the job when the registered handler succeeds', async () => {
    repository.claimNext.mockResolvedValue(baseJob);
    const handle = vi.fn().mockResolvedValue(undefined);
    service.registerHandler({ type: 'demo', handle });

    await service.runOnce();

    expect(handle).toHaveBeenCalledWith(baseJob.payload, baseJob.id);
    expect(repository.complete).toHaveBeenCalledWith(baseJob);
  });

  it('fails (with retry) when the registered handler throws', async () => {
    repository.claimNext.mockResolvedValue(baseJob);
    service.registerHandler({
      type: 'demo',
      handle: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await service.runOnce();

    expect(repository.fail).toHaveBeenCalledWith(baseJob, 'boom');
  });

  describe('access jobs (HU61)', () => {
    it('enqueueDeduped delegates the dedupeKey, the delay and skipIfRunning, and reports whether it created a job', async () => {
      repository.insertDeduped.mockResolvedValueOnce('job-9').mockResolvedValueOnce(null);
      const options = { dedupeKey: 'ACCESS_RECONCILIATION', delayMs: 3_600_000 };

      expect(await service.enqueueDeduped('access-reconciliation', {}, options)).toEqual({ created: true, jobId: 'job-9' });
      expect(await service.enqueueDeduped('access-reconciliation', {}, { ...options, skipIfRunning: true })).toEqual({
        created: false,
        jobId: null,
      });
      expect(repository.insertDeduped).toHaveBeenLastCalledWith({
        type: 'access-reconciliation',
        payload: {},
        maxAttempts: 3,
        dedupeKey: 'ACCESS_RECONCILIATION',
        delayMs: 3_600_000,
        skipIfRunning: true,
        staleLockMs: 600_000,
      });
    });

    it('claims with the configurable stale-lock threshold', async () => {
      config.JOBS_STALE_LOCK_MS = 120_000;
      repository.claimNext.mockResolvedValue(null);

      await service.runOnce();

      expect(repository.claimNext).toHaveBeenCalledWith(expect.any(String), 120_000);
    });

    it('sweeps stale locks before claiming, but not on every poll', async () => {
      repository.claimNext.mockResolvedValue(null);

      await service.runOnce();
      await service.runOnce();

      expect(repository.releaseStale).toHaveBeenCalledTimes(1);
      expect(repository.releaseStale).toHaveBeenCalledWith(600_000);
    });

    it('keeps claiming when the stale-lock sweep fails', async () => {
      repository.releaseStale.mockRejectedValue(new Error('db down'));
      repository.claimNext.mockResolvedValue(null);

      await expect(service.runOnce()).resolves.toBeUndefined();
      expect(repository.claimNext).toHaveBeenCalled();
    });

    it('reschedules (without failing) when the handler throws RescheduleJobError, keeping the attempts', async () => {
      const job = { ...baseJob, dedupeKey: 'ACCESS_REVERIFY:p:u' };
      repository.claimNext.mockResolvedValue(job);
      service.registerHandler({
        type: 'demo',
        handle: vi.fn().mockRejectedValue(new RescheduleJobError(120_000, 'GitHub no verificable', { deferrals: 2 })),
      });

      await service.runOnce();

      expect(repository.reschedule).toHaveBeenCalledWith(job, 120_000, 'GitHub no verificable', { deferrals: 2 });
      expect(repository.fail).not.toHaveBeenCalled();
      expect(repository.complete).not.toHaveBeenCalled();
    });
  });

  describe('lock heartbeat (WI-CORE-030, DEC-JOBS-002)', () => {
    /** Handler controlable: `finish()` resuelve el `handle` en curso. */
    function gatedHandler() {
      let finish!: () => void;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { finish, handle: vi.fn(() => gate) };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renews the lock every JOBS_HEARTBEAT_INTERVAL_MS while the handler runs, and stops when it finishes', async () => {
      vi.useFakeTimers();
      config.JOBS_HEARTBEAT_INTERVAL_MS = 15_000;
      repository.claimNext.mockResolvedValue(baseJob);
      const handler = gatedHandler();
      service.registerHandler({ type: 'demo', handle: handler.handle });

      const running = service.runOnce();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(repository.touchLock).toHaveBeenCalledTimes(1);
      expect(repository.touchLock).toHaveBeenCalledWith('job-1', expect.any(String));

      await vi.advanceTimersByTimeAsync(30_000);
      expect(repository.touchLock).toHaveBeenCalledTimes(3);

      handler.finish();
      await running;
      expect(repository.complete).toHaveBeenCalledWith(baseJob);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(repository.touchLock).toHaveBeenCalledTimes(3);
    });

    it('defaults to renewing every 60 seconds', async () => {
      vi.useFakeTimers();
      repository.claimNext.mockResolvedValue(baseJob);
      const handler = gatedHandler();
      service.registerHandler({ type: 'demo', handle: handler.handle });

      const running = service.runOnce();
      await vi.advanceTimersByTimeAsync(59_999);
      expect(repository.touchLock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(repository.touchLock).toHaveBeenCalledTimes(1);

      handler.finish();
      await running;
    });

    it('a failed renewal is logged and does not interrupt the handler', async () => {
      vi.useFakeTimers();
      config.JOBS_HEARTBEAT_INTERVAL_MS = 15_000;
      repository.touchLock.mockRejectedValue(new Error('db down'));
      repository.claimNext.mockResolvedValue(baseJob);
      const handler = gatedHandler();
      service.registerHandler({ type: 'demo', handle: handler.handle });

      const running = service.runOnce();
      await vi.advanceTimersByTimeAsync(30_000);
      handler.finish();
      await running;

      expect(repository.touchLock).toHaveBeenCalledTimes(2);
      expect(repository.complete).toHaveBeenCalledWith(baseJob);
      expect(repository.fail).not.toHaveBeenCalled();
    });

    it('stops renewing when the handler fails, and the failure still goes to fail()', async () => {
      vi.useFakeTimers();
      config.JOBS_HEARTBEAT_INTERVAL_MS = 15_000;
      repository.claimNext.mockResolvedValue(baseJob);
      service.registerHandler({ type: 'demo', handle: vi.fn().mockRejectedValue(new Error('boom')) });

      await service.runOnce();
      expect(repository.fail).toHaveBeenCalledWith(baseJob, 'boom');

      await vi.advanceTimersByTimeAsync(60_000);
      expect(repository.touchLock).not.toHaveBeenCalled();
    });
  });

  describe('exhausted jobs hook (WI-CORE-030, DEC-JOBS-001)', () => {
    const experimentJob: Job = { ...baseJob, type: 'experiment-run', payload: { experimentId: 'exp-1' } };

    it('calls onExhausted of the handler for each job the sweep leaves FAILED terminal', async () => {
      repository.releaseStale.mockResolvedValue({ released: 1, exhausted: [experimentJob] });
      repository.claimNext.mockResolvedValue(null);
      const onExhausted = vi.fn().mockResolvedValue(undefined);
      service.registerHandler({ type: 'experiment-run', handle: vi.fn(), onExhausted });

      await service.runOnce();

      expect(onExhausted).toHaveBeenCalledWith({ experimentId: 'exp-1' }, expect.stringContaining('Lock obsoleto'));
    });

    it('does not call onExhausted when the sweep only releases the lock and attempts remain', async () => {
      repository.releaseStale.mockResolvedValue({ released: 1, exhausted: [] });
      repository.claimNext.mockResolvedValue(null);
      const onExhausted = vi.fn();
      service.registerHandler({ type: 'experiment-run', handle: vi.fn(), onExhausted });

      await service.runOnce();

      expect(onExhausted).not.toHaveBeenCalled();
    });

    it('calls onExhausted with the error message when a handler failure leaves the job FAILED terminal', async () => {
      repository.claimNext.mockResolvedValue(experimentJob);
      repository.fail.mockResolvedValue('terminal');
      const onExhausted = vi.fn().mockResolvedValue(undefined);
      service.registerHandler({
        type: 'experiment-run',
        handle: vi.fn().mockRejectedValue(new Error('boom')),
        onExhausted,
      });

      await service.runOnce();

      expect(onExhausted).toHaveBeenCalledWith(experimentJob.payload, 'boom');
    });

    it('does not call onExhausted when the failure is retried', async () => {
      repository.claimNext.mockResolvedValue(baseJob);
      repository.fail.mockResolvedValue('retry');
      const onExhausted = vi.fn();
      service.registerHandler({
        type: 'demo',
        handle: vi.fn().mockRejectedValue(new Error('boom')),
        onExhausted,
      });

      await service.runOnce();

      expect(onExhausted).not.toHaveBeenCalled();
    });

    it('a failing onExhausted is logged and does not stop the sweep or the claim', async () => {
      repository.releaseStale.mockResolvedValue({ released: 1, exhausted: [experimentJob] });
      repository.claimNext.mockResolvedValue(null);
      service.registerHandler({
        type: 'experiment-run',
        handle: vi.fn(),
        onExhausted: vi.fn().mockRejectedValue(new Error('db down')),
      });

      await expect(service.runOnce()).resolves.toBeUndefined();
      expect(repository.claimNext).toHaveBeenCalled();
    });
  });
});
