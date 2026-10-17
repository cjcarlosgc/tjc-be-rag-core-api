import { describe, expect, it, vi } from 'vitest';
import { AnalysisRunsRepository } from './analysis-runs.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function setup(transitionCount = 1) {
  const run = { id: 'run-1', status: 'OBSOLETE', current: false };
  const tx = {
    analysisRun: {
      updateMany: vi.fn().mockResolvedValue({ count: transitionCount }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(run),
    },
    functionalQuestion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  const repository = new AnalysisRunsRepository(prisma as unknown as PrismaService);

  return { repository, tx, run };
}

describe('AnalysisRunsRepository.transitionCurrent', () => {
  it('does not overwrite a newer lifecycle state when the compare-and-set loses a race', async () => {
    const { repository, tx } = setup(0);

    await expect(
      repository.transitionCurrent('run-1', 'PROCESSING', 'ACTION_REQUIRED', {}),
    ).resolves.toBeNull();

    expect(tx.analysisRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'PROCESSING', current: true },
      data: { status: 'ACTION_REQUIRED' },
    });
    expect(tx.functionalQuestion.updateMany).not.toHaveBeenCalled();
  });

  it('atomically obsoletes pending questions when a current run is obsoleted', async () => {
    const { repository, tx, run } = setup();

    const result = await repository.transitionCurrent('run-1', 'PROCESSING', 'OBSOLETE', { current: false });

    expect(tx.functionalQuestion.updateMany).toHaveBeenCalledWith({
      where: { analysisRunId: 'run-1', status: 'PENDING' },
      data: { status: 'OBSOLETE' },
    });
    expect(result).toEqual(run);
  });
});

describe('AnalysisRunsRepository PR date classification', () => {
  it('stores the original PR date and eligibility when creating a run', async () => {
    const createdAt = new Date('2026-09-20T12:00:00.000Z');
    const create = vi.fn().mockResolvedValue({ id: 'run-1' });
    const repository = new AnalysisRunsRepository({
      analysisRun: { create },
    } as unknown as PrismaService);

    await repository.create({
      projectId: 'project-1',
      repositoryId: 'repo-1',
      repositoryName: 'org/repo',
      prNumber: 42,
      pullRequestCreatedAt: createdAt,
      repositoryBindingEligible: true,
      prTitle: 'Title',
      baseRef: 'develop',
      headRef: 'feature/x',
      baseSha: 'base',
      headSha: 'head',
      draft: false,
      actorLogin: null,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pullRequestCreatedAt: createdAt,
        repositoryBindingEligible: true,
      }),
    });
  });

  it('filters unclassified and pre-binding runs before pagination and detail lookup', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new AnalysisRunsRepository({
      analysisRun: { findMany, findFirst },
    } as unknown as PrismaService);

    await repository.findByProjectForOwner('project-1', 'user-1', 20, undefined, 'cursor-1');
    await repository.findByIdForOwner('run-1', 'user-1');
    await repository.findById('run-1');

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        pullRequestCreatedAt: { not: null },
        repositoryBindingEligible: true,
      }),
      take: 21,
      cursor: { id: 'cursor-1' },
      skip: 1,
    }));
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        id: 'run-1',
        pullRequestCreatedAt: { not: null },
        repositoryBindingEligible: true,
      }),
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'run-1',
        pullRequestCreatedAt: { not: null },
        repositoryBindingEligible: true,
      },
    });
  });

  it('classifies all runs in a PR group and preserves eligible runs', async () => {
    const createdAt = new Date('2026-09-20T12:00:00.000Z');
    const bindingCreatedAt = new Date('2026-09-20T12:00:00.000Z');
    const tx = {
      analysisRun: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      functionalQuestion: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const repository = new AnalysisRunsRepository(prisma as unknown as PrismaService);

    await expect(
      repository.classifyPullRequest('repo-1', 42, createdAt, bindingCreatedAt),
    ).resolves.toEqual({ classifiedCount: 2, eligible: true });

    expect(tx.analysisRun.updateMany).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repo-1',
        prNumber: 42,
        OR: [{ pullRequestCreatedAt: null }, { repositoryBindingEligible: null }],
      },
      data: {
        pullRequestCreatedAt: createdAt,
        repositoryBindingEligible: true,
      },
    });
    expect(tx.functionalQuestion.updateMany).not.toHaveBeenCalled();
  });

  it('obsoletes pre-binding runs and their pending questions transactionally', async () => {
    const createdAt = new Date('2026-09-19T12:00:00.000Z');
    const bindingCreatedAt = new Date('2026-09-20T12:00:00.000Z');
    const tx = {
      analysisRun: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      functionalQuestion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const repository = new AnalysisRunsRepository(prisma as unknown as PrismaService);

    await expect(
      repository.classifyPullRequest('repo-1', 42, createdAt, bindingCreatedAt),
    ).resolves.toEqual({ classifiedCount: 3, eligible: false });

    expect(tx.analysisRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        pullRequestCreatedAt: createdAt,
        repositoryBindingEligible: false,
        status: 'OBSOLETE',
        current: false,
      },
    }));
    expect(tx.functionalQuestion.updateMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', analysisRun: { repositoryId: 'repo-1', prNumber: 42 } },
      data: { status: 'OBSOLETE' },
    });
  });

  it('does not classify when the timestamp is absent', async () => {
    const prisma = { $transaction: vi.fn() };
    const repository = new AnalysisRunsRepository(prisma as unknown as PrismaService);

    await expect(
      repository.classifyPullRequest('repo-1', 42, null, new Date()),
    ).resolves.toEqual({ classifiedCount: 0, eligible: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
