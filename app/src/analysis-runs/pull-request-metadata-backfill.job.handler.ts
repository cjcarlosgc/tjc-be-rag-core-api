import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AnalysisRunsRepository, type PullRequestRunGroup } from './analysis-runs.repository.js';
import { AnalysisRunsService } from './analysis-runs.service.js';
import { GithubRepositoryContentService } from '../github-app/github-repository-content.service.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { JobsService } from '../jobs/jobs.service.js';
import { RescheduleJobError } from '../jobs/reschedule-job.error.js';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { SNAPSHOT_ANALYSIS_JOB_TYPE } from '../snapshot-intelligence/snapshot-analysis-job.handler.js';
import type { Prisma } from '../generated/prisma/client.js';

export const PULL_REQUEST_METADATA_BACKFILL_JOB_TYPE = 'PULL_REQUEST_METADATA_BACKFILL';
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1_000;

export interface PullRequestMetadataBackfillPayload {
  repositoryId: string;
  prNumber?: number;
  pullRequestNumber?: number;
  retryCount?: number;
  pendingEvent?: PendingPullRequestEvent;
}

export interface PendingPullRequestEvent {
  deliveryId: string;
  receivedAt: string;
  action: string;
  number: number;
  pull_request: {
    title: string;
    draft: boolean;
    merged: boolean;
    created_at: string | null;
    base: { ref: string; sha: string };
    head: { ref: string; sha: string };
    user: { login: string } | null;
  };
}

export function pullRequestMetadataBackfillDedupeKey(repositoryId: string, prNumber: number): string {
  return `PULL_REQUEST_METADATA:${repositoryId}:${prNumber}`;
}

/** Reintenta la clasificación histórica sin consumir los intentos finitos del worker. */
@Injectable()
export class PullRequestMetadataBackfillJobHandler
  implements JobHandler<PullRequestMetadataBackfillPayload>, OnModuleInit
{
  readonly type = PULL_REQUEST_METADATA_BACKFILL_JOB_TYPE;
  private readonly logger = new Logger(PullRequestMetadataBackfillJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly githubRepositoryContentService: GithubRepositoryContentService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.jobsService.registerHandler(this);
    await this.enqueueUnclassifiedGroups();
  }

  async handle(payload: PullRequestMetadataBackfillPayload): Promise<void> {
    const prNumber = payload.prNumber ?? payload.pullRequestNumber;

    if (typeof prNumber !== 'number' || !Number.isSafeInteger(prNumber) || prNumber < 1) return;

    if (
      !payload.pendingEvent &&
      !(await this.analysisRunsRepository.hasUnclassifiedPullRequest(payload.repositoryId, prNumber))
    ) {
      return;
    }

    const binding = await this.repositoryBindingsRepository.findByRepositoryId(payload.repositoryId);

    if (!binding) {
      this.reschedule(payload, 'El repositorio aún no tiene un binding verificable.');
    }

    let createdAt: Date;
    let liveHead: Awaited<ReturnType<GithubRepositoryContentService['getPullRequestHead']>>;

    try {
      liveHead = await this.githubRepositoryContentService.getPullRequestHead(
        binding.installationId,
        binding.repositoryName,
        prNumber,
      );
      const parsed = parseGitHubCreatedAt(liveHead.createdAt);

      if (!parsed) {
        this.reschedule(payload, 'GitHub Integration aún no puede verificar la fecha original del PR.');
      }

      createdAt = parsed;
    } catch (error) {
      if (error instanceof RescheduleJobError) throw error;

      // UNVERIFIABLE, NOT_FOUND, NOT_INSTALLED y fallos de transporte son
      // condiciones recuperables: se reprograman sin agotar maxAttempts.
      this.reschedule(payload, 'GitHub Integration aún no puede verificar la fecha original del PR.');
    }

    const currentBinding = await this.repositoryBindingsRepository.findByRepositoryId(payload.repositoryId);

    if (!currentBinding) {
      this.reschedule(payload, 'El repositorio aún no tiene un binding verificable.');
    }

    const result = await this.analysisRunsRepository.classifyPullRequest(
      payload.repositoryId,
      prNumber,
      createdAt,
      currentBinding.createdAt,
    );

    if (payload.pendingEvent && result.eligible) {
      await this.resumePendingEvent(payload, prNumber, currentBinding, liveHead, createdAt);
    }

    this.logger.log(
      `Se clasificaron ${result.classifiedCount} Run(s) del PR ${payload.repositoryId}#${prNumber}; elegible=${result.eligible}.`,
    );
  }

  private async resumePendingEvent(
    payload: PullRequestMetadataBackfillPayload,
    prNumber: number,
    binding: NonNullable<Awaited<ReturnType<RepositoryBindingsRepository['findByRepositoryId']>>>,
    liveHead: Awaited<ReturnType<GithubRepositoryContentService['getPullRequestHead']>>,
    createdAt: Date,
  ): Promise<void> {
    const event = payload.pendingEvent;

    if (!event || !isPendingPullRequestEvent(event) || event.number !== prNumber) return;

    if (liveHead.state !== 'open' || liveHead.headSha !== event.pull_request.head.sha) return;

    const eligibleActions = new Set(['opened', 'reopened', 'ready_for_review', 'synchronize', 'edited']);
    if (
      !eligibleActions.has(event.action) ||
      event.pull_request.draft ||
      event.pull_request.base.ref !== binding.integrationBranch
    ) {
      return;
    }

    if (binding.status !== 'ENABLED') {
      this.reschedule(payload, 'El binding no está habilitado para reanudar el evento.');
    }

    const currentBinding = await this.repositoryBindingsRepository.findByRepositoryId(payload.repositoryId);
    if (
      !currentBinding ||
      currentBinding.projectId !== binding.projectId ||
      currentBinding.integrationBranch !== binding.integrationBranch ||
      currentBinding.status !== 'ENABLED' ||
      currentBinding.createdAt.getTime() !== binding.createdAt.getTime()
    ) {
      this.reschedule(payload, 'El binding dejó de estar habilitado durante la recuperación del evento.');
    }

    const { run, isNew } = await this.analysisRunsService.startRunFromWebhook({
      projectId: currentBinding.projectId,
      repositoryId: currentBinding.repositoryId,
      repositoryName: currentBinding.repositoryName,
      prNumber,
      pullRequestCreatedAt: createdAt,
      repositoryBindingEligible: true,
      prTitle: event.pull_request.title,
      baseRef: event.pull_request.base.ref,
      headRef: event.pull_request.head.ref,
      baseSha: event.pull_request.base.sha,
      headSha: event.pull_request.head.sha,
      draft: event.pull_request.draft,
      actorLogin: event.pull_request.user?.login ?? null,
    });

    if (isNew) {
      await this.jobsService.enqueue(SNAPSHOT_ANALYSIS_JOB_TYPE, { analysisRunId: run.id });
    }
  }

  private async enqueueUnclassifiedGroups(): Promise<void> {
    let groups: PullRequestRunGroup[];

    try {
      groups = await this.analysisRunsRepository.findUnclassifiedPullRequestGroups();
    } catch (error) {
      this.logger.error(
        `No se pudieron descubrir Runs sin clasificar: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    for (const group of groups) {
      await this.jobsService.enqueueDeduped(
        this.type,
        { repositoryId: group.repositoryId, prNumber: group.prNumber },
        {
          dedupeKey: pullRequestMetadataBackfillDedupeKey(group.repositoryId, group.prNumber),
          skipIfRunning: true,
        },
      );
    }
  }

  private reschedule(payload: PullRequestMetadataBackfillPayload, reason: string): never {
    const retryCount = Number.isInteger(payload.retryCount) && (payload.retryCount ?? -1) >= 0
      ? payload.retryCount ?? 0
      : 0;
    const delayMs = Math.min(BASE_RETRY_DELAY_MS * 2 ** Math.min(retryCount, 16), MAX_RETRY_DELAY_MS);

    const nextPayload: Prisma.InputJsonObject = {
      repositoryId: payload.repositoryId,
      prNumber: payload.prNumber ?? payload.pullRequestNumber ?? 0,
      retryCount: retryCount + 1,
      ...(payload.pendingEvent ? { pendingEvent: toPendingEventJson(payload.pendingEvent) } : {}),
    };

    throw new RescheduleJobError(delayMs, reason, nextPayload);
  }
}

function parseGitHubCreatedAt(value: unknown): Date | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) {
    return null;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isPendingPullRequestEvent(value: unknown): value is PendingPullRequestEvent {
  if (!isRecord(value) || !isRecord(value.pull_request)) return false;

  const pullRequest = value.pull_request;
  const base = pullRequest.base;
  const head = pullRequest.head;
  const user = pullRequest.user;

  return (
    isNonEmptyString(value.deliveryId) &&
    isNonEmptyString(value.receivedAt) &&
    isNonEmptyString(value.action) &&
    Number.isSafeInteger(value.number) &&
    typeof pullRequest.title === 'string' &&
    typeof pullRequest.draft === 'boolean' &&
    typeof pullRequest.merged === 'boolean' &&
    (pullRequest.created_at === null || typeof pullRequest.created_at === 'string') &&
    isRecord(base) && isNonEmptyString(base.ref) && isNonEmptyString(base.sha) &&
    isRecord(head) && isNonEmptyString(head.ref) && isNonEmptyString(head.sha) &&
    (user === null || (isRecord(user) && isNonEmptyString(user.login)))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function toPendingEventJson(event: PendingPullRequestEvent): Prisma.InputJsonObject {
  return {
    deliveryId: event.deliveryId,
    receivedAt: event.receivedAt,
    action: event.action,
    number: event.number,
    pull_request: {
      title: event.pull_request.title,
      draft: event.pull_request.draft,
      merged: event.pull_request.merged,
      created_at: event.pull_request.created_at,
      base: { ref: event.pull_request.base.ref, sha: event.pull_request.base.sha },
      head: { ref: event.pull_request.head.ref, sha: event.pull_request.head.sha },
      user: event.pull_request.user === null ? null : { login: event.pull_request.user.login },
    },
  };
}
