import { describe, expect, it, vi } from 'vitest';
import { RescheduleJobError } from '../jobs/reschedule-job.error.js';
import {
  PULL_REQUEST_METADATA_BACKFILL_JOB_TYPE,
  PullRequestMetadataBackfillJobHandler,
  pullRequestMetadataBackfillDedupeKey,
} from './pull-request-metadata-backfill.job.handler.js';
import type { PullRequestMetadataBackfillPayload } from './pull-request-metadata-backfill.job.handler.js';

function setup(overrides: {
  unclassified?: boolean;
  groups?: Array<{ repositoryId: string; prNumber: number }>;
  lookup?: () => Promise<unknown>;
  binding?: object | null;
  classify?: () => Promise<{ classifiedCount: number; eligible: boolean }>;
} = {}) {
  const jobsService = {
    registerHandler: vi.fn(),
    enqueueDeduped: vi.fn().mockResolvedValue({ created: true, jobId: 'job-1' }),
    enqueue: vi.fn().mockResolvedValue('snapshot-job-1'),
  };
  const analysisRunsRepository = {
    hasUnclassifiedPullRequest: vi.fn().mockResolvedValue(overrides.unclassified ?? true),
    findUnclassifiedPullRequestGroups: vi.fn().mockResolvedValue(overrides.groups ?? []),
    classifyPullRequest: vi.fn(overrides.classify ?? (async () => ({ classifiedCount: 2, eligible: true }))),
  };
  const analysisRunsService = {
    startRunFromWebhook: vi.fn().mockResolvedValue({ run: { id: 'run-1' }, isNew: true }),
  };
  const repositoryBindingsRepository = {
    findByRepositoryId: vi.fn().mockResolvedValue(
      overrides.binding === undefined
        ? {
            installationId: 'installation-1',
            id: 'binding-1',
            projectId: 'project-1',
            repositoryId: 'repo-1',
            repositoryName: 'org/repo',
            integrationBranch: 'develop',
            status: 'ENABLED',
            createdAt: new Date('2026-09-20T12:00:00.000Z'),
          }
        : overrides.binding,
    ),
  };
  const githubRepositoryContentService = {
    getPullRequestHead: vi.fn(
      overrides.lookup ?? (async () => ({
        headSha: 'head-live',
        state: 'open',
        createdAt: '2026-09-20T12:00:00.000Z',
      })),
    ),
  };
  const handler = new PullRequestMetadataBackfillJobHandler(
    jobsService as never,
    analysisRunsRepository as never,
    analysisRunsService as never,
    repositoryBindingsRepository as never,
    githubRepositoryContentService as never,
  );

  return {
    handler,
    jobsService,
    analysisRunsRepository,
    analysisRunsService,
    repositoryBindingsRepository,
    githubRepositoryContentService,
  };
}

describe('PullRequestMetadataBackfillJobHandler', () => {
  it('registers its durable job type and seeds one deduplicated job per unresolved PR', async () => {
    const groups = [
      { repositoryId: 'repo-1', prNumber: 42 },
      { repositoryId: 'repo-2', prNumber: 7 },
    ];
    const { handler, jobsService } = setup({ groups });

    await handler.onModuleInit();

    expect(handler.type).toBe(PULL_REQUEST_METADATA_BACKFILL_JOB_TYPE);
    expect(jobsService.registerHandler).toHaveBeenCalledWith(handler);
    expect(jobsService.enqueueDeduped).toHaveBeenNthCalledWith(1,
      PULL_REQUEST_METADATA_BACKFILL_JOB_TYPE,
      groups[0],
      {
        dedupeKey: pullRequestMetadataBackfillDedupeKey('repo-1', 42),
        skipIfRunning: true,
      },
    );
    expect(jobsService.enqueueDeduped).toHaveBeenNthCalledWith(2,
      PULL_REQUEST_METADATA_BACKFILL_JOB_TYPE,
      groups[1],
      {
        dedupeKey: pullRequestMetadataBackfillDedupeKey('repo-2', 7),
        skipIfRunning: true,
      },
    );
  });

  it('classifies a verified date after the binding as eligible', async () => {
    const { handler, analysisRunsRepository, githubRepositoryContentService } = setup();

    await handler.handle({ repositoryId: 'repo-1', prNumber: 42 });

    expect(githubRepositoryContentService.getPullRequestHead).toHaveBeenCalledWith(
      'installation-1',
      'org/repo',
      42,
    );
    expect(analysisRunsRepository.classifyPullRequest).toHaveBeenCalledWith(
      'repo-1',
      42,
      new Date('2026-09-20T12:00:00.000Z'),
      new Date('2026-09-20T12:00:00.000Z'),
    );
  });

  it('classifies a verified date before the binding as ineligible and preserves the repository decision', async () => {
    const binding = {
      installationId: 'installation-1',
      repositoryName: 'org/repo',
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
    };
    const classify = vi.fn().mockResolvedValue({ classifiedCount: 2, eligible: false });
    const { handler, analysisRunsRepository } = setup({
      binding,
      classify,
      lookup: async () => ({
        headSha: 'head-live',
        state: 'open',
        createdAt: '2026-09-19T12:00:00.000Z',
      }),
    });

    await handler.handle({ repositoryId: 'repo-1', pullRequestNumber: 42 });

    expect(analysisRunsRepository.classifyPullRequest).toHaveBeenCalledWith(
      'repo-1',
      42,
      new Date('2026-09-19T12:00:00.000Z'),
      binding.createdAt,
    );
  });

  it.each([
    ['UNVERIFIABLE', 503],
    ['NOT_FOUND', 404],
    ['NOT_INSTALLED', 403],
  ])('reschedules %s lookups indefinitely without consuming normal job attempts', async (_status, statusCode) => {
    const { handler } = setup({
      lookup: async () => {
        throw Object.assign(new Error('lookup unavailable'), { status: statusCode });
      },
    });

    await expect(handler.handle({ repositoryId: 'repo-1', prNumber: 42 })).rejects.toMatchObject({
      name: 'RescheduleJobError',
      delayMs: 30_000,
      payload: { repositoryId: 'repo-1', prNumber: 42, retryCount: 1 },
    } satisfies Partial<RescheduleJobError>);
  });

  it('uses capped exponential backoff for repeated unverifiable results', async () => {
    const { handler } = setup({ lookup: async () => { throw new Error('unverifiable'); } });

    await expect(handler.handle({ repositoryId: 'repo-1', prNumber: 42, retryCount: 4 })).rejects.toMatchObject({
      name: 'RescheduleJobError',
      delayMs: 480_000,
      payload: { retryCount: 5 },
    });
  });

  it('preserves the event through repeated metadata failures and resumes it after recovery', async () => {
    const pendingEvent = {
      deliveryId: 'delivery-1',
      receivedAt: '2026-09-20T12:05:00.000Z',
      action: 'opened',
      number: 42,
      pull_request: {
        title: 'Add feature',
        draft: false,
        merged: false,
        created_at: null,
        base: { ref: 'develop', sha: 'base-sha' },
        head: { ref: 'feature/x', sha: 'event-head' },
        user: null,
      },
    };
    const lookup = vi.fn()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockRejectedValueOnce(new Error('still unavailable'))
      .mockResolvedValue({
        headSha: 'event-head',
        state: 'open',
        createdAt: '2026-09-20T12:00:00.000Z',
      });
    const { handler, analysisRunsService, jobsService } = setup({
      unclassified: false,
      lookup,
    });

    let payload: PullRequestMetadataBackfillPayload = {
      repositoryId: 'repo-1',
      pullRequestNumber: 42,
      pendingEvent,
    };

    for (const retryCount of [1, 2]) {
      const error = await handler.handle(payload).then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(RescheduleJobError);
      expect(error).toMatchObject({
        payload: { repositoryId: 'repo-1', prNumber: 42, retryCount, pendingEvent },
      });
      payload = (error as RescheduleJobError).payload as PullRequestMetadataBackfillPayload;
    }

    await handler.handle(payload);

    expect(lookup).toHaveBeenCalledTimes(3);
    expect(analysisRunsService.startRunFromWebhook).toHaveBeenCalledOnce();
    expect(jobsService.enqueue).toHaveBeenCalledWith('snapshot-analysis', { analysisRunId: 'run-1' });
  });

  it('finishes idempotently when another worker already classified the PR', async () => {
    const { handler, repositoryBindingsRepository, githubRepositoryContentService } = setup({ unclassified: false });

    await handler.handle({ repositoryId: 'repo-1', prNumber: 42 });

    expect(repositoryBindingsRepository.findByRepositoryId).not.toHaveBeenCalled();
    expect(githubRepositoryContentService.getPullRequestHead).not.toHaveBeenCalled();
  });

  it('resumes an event only after the live PR and enabled binding are verified', async () => {
    const { handler, analysisRunsRepository, analysisRunsService, jobsService } = setup({
      unclassified: false,
      lookup: async () => ({
        headSha: 'event-head',
        state: 'open',
        createdAt: '2026-09-20T12:00:00.000Z',
      }),
    });
    const pendingEvent = {
      deliveryId: 'delivery-1',
      receivedAt: '2026-09-20T12:05:00.000Z',
      action: 'opened',
      number: 42,
      pull_request: {
        title: 'Add feature',
        draft: false,
        merged: false,
        created_at: null,
        base: { ref: 'develop', sha: 'base-sha' },
        head: { ref: 'feature/x', sha: 'event-head' },
        user: { login: 'octocat' },
      },
    };

    await handler.handle({ repositoryId: 'repo-1', pullRequestNumber: 42, pendingEvent });

    expect(analysisRunsRepository.classifyPullRequest).toHaveBeenCalledOnce();
    expect(analysisRunsService.startRunFromWebhook).toHaveBeenCalledWith({
      projectId: 'project-1',
      repositoryId: 'repo-1',
      repositoryName: 'org/repo',
      prNumber: 42,
      pullRequestCreatedAt: new Date('2026-09-20T12:00:00.000Z'),
      repositoryBindingEligible: true,
      prTitle: 'Add feature',
      baseRef: 'develop',
      headRef: 'feature/x',
      baseSha: 'base-sha',
      headSha: 'event-head',
      draft: false,
      actorLogin: 'octocat',
    });
    expect(jobsService.enqueue).toHaveBeenCalledWith('snapshot-analysis', { analysisRunId: 'run-1' });
  });

  it.each([
    ['closed', 'event-head'],
    ['open', 'newer-head'],
  ])('does not resume a stale pending event when live state is %s/head %s', async (state, headSha) => {
    const { handler, analysisRunsService, jobsService } = setup({
      unclassified: false,
      lookup: async () => ({
        headSha,
        state,
        createdAt: '2026-09-20T12:00:00.000Z',
      }),
    });

    await handler.handle({
      repositoryId: 'repo-1',
      prNumber: 42,
      pendingEvent: {
        deliveryId: 'delivery-1',
        receivedAt: '2026-09-20T12:05:00.000Z',
        action: 'opened',
        number: 42,
        pull_request: {
          title: 'Add feature',
          draft: false,
          merged: false,
          created_at: null,
          base: { ref: 'develop', sha: 'base-sha' },
          head: { ref: 'feature/x', sha: 'event-head' },
          user: null,
        },
      },
    });

    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });

  it('does not create a run when a pending event belongs to a pre-binding PR', async () => {
    const { handler, analysisRunsService, jobsService } = setup({
      unclassified: false,
      classify: async () => ({ classifiedCount: 0, eligible: false }),
      lookup: async () => ({
        headSha: 'event-head',
        state: 'open',
        createdAt: '2026-09-19T12:00:00.000Z',
      }),
    });

    await handler.handle({
      repositoryId: 'repo-1',
      prNumber: 42,
      pendingEvent: {
        deliveryId: 'delivery-1',
        receivedAt: '2026-09-20T12:05:00.000Z',
        action: 'opened',
        number: 42,
        pull_request: {
          title: 'Add feature',
          draft: false,
          merged: false,
          created_at: null,
          base: { ref: 'develop', sha: 'base-sha' },
          head: { ref: 'feature/x', sha: 'event-head' },
          user: null,
        },
      },
    });

    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });

  it('keeps an eligible pending event durable while its binding is disabled', async () => {
    const { handler, analysisRunsService } = setup({
      unclassified: false,
      binding: {
        id: 'binding-1',
        installationId: 'installation-1',
        repositoryName: 'org/repo',
        integrationBranch: 'develop',
        status: 'DISABLED',
        createdAt: new Date('2026-09-20T12:00:00.000Z'),
      },
      lookup: async () => ({
        headSha: 'event-head',
        state: 'open',
        createdAt: '2026-09-20T12:00:00.000Z',
      }),
    });

    await expect(handler.handle({
      repositoryId: 'repo-1',
      prNumber: 42,
      pendingEvent: {
        deliveryId: 'delivery-1',
        receivedAt: '2026-09-20T12:05:00.000Z',
        action: 'opened',
        number: 42,
        pull_request: {
          title: 'Add feature',
          draft: false,
          merged: false,
          created_at: null,
          base: { ref: 'develop', sha: 'base-sha' },
          head: { ref: 'feature/x', sha: 'event-head' },
          user: null,
        },
      },
    })).rejects.toBeInstanceOf(RescheduleJobError);

    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
  });

  it('does not retry a non-analytical action while the binding is disabled', async () => {
    const { handler, analysisRunsService } = setup({
      unclassified: false,
      binding: {
        id: 'binding-1',
        projectId: 'project-1',
        repositoryId: 'repo-1',
        installationId: 'installation-1',
        repositoryName: 'org/repo',
        integrationBranch: 'develop',
        status: 'DISABLED',
        createdAt: new Date('2026-09-20T12:00:00.000Z'),
      },
      lookup: async () => ({
        headSha: 'event-head',
        state: 'open',
        createdAt: '2026-09-20T12:00:00.000Z',
      }),
    });

    await expect(handler.handle({
      repositoryId: 'repo-1',
      prNumber: 42,
      pendingEvent: {
        deliveryId: 'delivery-1',
        receivedAt: '2026-09-20T12:05:00.000Z',
        action: 'closed',
        number: 42,
        pull_request: {
          title: 'Add feature',
          draft: false,
          merged: false,
          created_at: null,
          base: { ref: 'develop', sha: 'base-sha' },
          head: { ref: 'feature/x', sha: 'event-head' },
          user: null,
        },
      },
    })).resolves.toBeUndefined();

    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
  });
});
