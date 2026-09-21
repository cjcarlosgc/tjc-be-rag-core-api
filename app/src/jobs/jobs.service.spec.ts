import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      releaseStale: vi.fn().mockResolvedValue(0),
      insertDeduped: vi.fn(),
      updatePendingPayload: vi.fn(),
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
    expect(repository.complete).toHaveBeenCalledWith(baseJob.id);
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
});
