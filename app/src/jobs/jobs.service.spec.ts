import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsService } from './jobs.service.js';
import { JobsRepository } from './jobs.repository.js';
import type { Job } from '../generated/prisma/client.js';

describe('JobsService', () => {
  let service: JobsService;
  let repository: {
    create: ReturnType<typeof vi.fn>;
    claimNext: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
  };

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
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    repository = {
      create: vi.fn(),
      claimNext: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: JobsRepository, useValue: repository },
        {
          provide: ConfigService,
          useValue: { get: (_key: string, defaultValue?: unknown) => defaultValue },
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
});
