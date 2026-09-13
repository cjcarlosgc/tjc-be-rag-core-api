import { createHmac } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubWebhooksService, type IncomingWebhookRequest } from './github-webhooks.service.js';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { AnalysisRun, RepositoryBinding } from '../generated/prisma/client.js';

const SECRET = 'webhook-secret';

function sign(body: Buffer): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

function buildRequest(payload: unknown, overrides: Partial<IncomingWebhookRequest> = {}): IncomingWebhookRequest {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');

  return {
    rawBody,
    signatureHeader: sign(rawBody),
    deliveryId: 'delivery-1',
    eventName: 'pull_request',
    payload,
    ...overrides,
  };
}

describe('GithubWebhooksService', () => {
  let service: GithubWebhooksService;
  let configService: { get: ReturnType<typeof vi.fn> };
  let webhookDeliveriesRepository: {
    findByDeliveryId: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let repositoryBindingsRepository: { findByRepositoryId: ReturnType<typeof vi.fn> };
  let analysisRunsRepository: { findCurrentByPullRequest: ReturnType<typeof vi.fn> };
  let analysisRunsService: {
    startRunFromWebhook: ReturnType<typeof vi.fn>;
    closeRun: ReturnType<typeof vi.fn>;
  };

  const binding: RepositoryBinding = {
    id: 'binding-1',
    projectId: 'project-1',
    installationId: '999',
    repositoryId: '123',
    repositoryName: 'org/repo',
    integrationBranch: 'develop',
    status: 'ENABLED',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
    return {
      id: 'run-1',
      projectId: 'project-1',
      repositoryId: '123',
      repositoryName: 'org/repo',
      prNumber: 42,
      prTitle: 'Add feature',
      baseRef: 'develop',
      headRef: 'feature/x',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      draft: false,
      prState: 'OPEN',
      actorLogin: 'octocat',
      status: 'QUEUED',
      current: true,
      attemptCount: 0,
      indexMode: 'BOOTSTRAP',
      changesetBaseSha: 'base-sha',
      changesetHeadSha: 'head-sha',
      indexDeltaBaseSha: null,
      functionalBehaviorValidated: false,
      actionRequiredCount: 0,
      generatedTestsCount: 0,
      resultSummary: null,
      completedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function pullRequestPayload(overrides: Record<string, unknown> = {}) {
    return {
      action: 'opened',
      number: 42,
      pull_request: {
        title: 'Add feature',
        draft: false,
        merged: false,
        base: { ref: 'develop', sha: 'base-sha' },
        head: { ref: 'feature/x', sha: 'head-sha' },
        user: { login: 'octocat' },
      },
      repository: { id: 123, full_name: 'org/repo' },
      installation: { id: 999 },
      ...overrides,
    };
  }

  beforeEach(async () => {
    configService = { get: vi.fn().mockReturnValue(SECRET) };
    webhookDeliveriesRepository = {
      findByDeliveryId: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
    };
    repositoryBindingsRepository = { findByRepositoryId: vi.fn().mockResolvedValue(binding) };
    analysisRunsRepository = { findCurrentByPullRequest: vi.fn().mockResolvedValue(null) };
    analysisRunsService = {
      startRunFromWebhook: vi.fn().mockResolvedValue(buildRun()),
      closeRun: vi.fn().mockResolvedValue(buildRun({ status: 'OBSOLETE', current: false })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubWebhooksService,
        { provide: ConfigService, useValue: configService },
        { provide: WebhookDeliveriesRepository, useValue: webhookDeliveriesRepository },
        { provide: RepositoryBindingsRepository, useValue: repositoryBindingsRepository },
        { provide: AnalysisRunsRepository, useValue: analysisRunsRepository },
        { provide: AnalysisRunsService, useValue: analysisRunsService },
      ],
    }).compile();

    service = module.get(GithubWebhooksService);
  });

  it('throws GITHUB_WEBHOOK_UNAVAILABLE when no secret is configured', async () => {
    configService.get.mockReturnValue(undefined);

    await expect(service.handle(buildRequest(pullRequestPayload()))).rejects.toMatchObject<
      Partial<AppException>
    >({
      code: ErrorCode.GITHUB_WEBHOOK_UNAVAILABLE,
    });
  });

  it('throws INVALID_WEBHOOK_SIGNATURE when the signature does not match', async () => {
    const request = buildRequest(pullRequestPayload(), { signatureHeader: 'sha256=deadbeef' });

    await expect(service.handle(request)).rejects.toMatchObject<Partial<AppException>>({
      code: ErrorCode.INVALID_WEBHOOK_SIGNATURE,
    });
  });

  it('throws INVALID_REQUEST when x-github-delivery is missing', async () => {
    const request = buildRequest(pullRequestPayload(), { deliveryId: undefined });

    await expect(service.handle(request)).rejects.toMatchObject<Partial<AppException>>({
      code: ErrorCode.INVALID_REQUEST,
    });
  });

  it('returns duplicate:true and skips processing for a redelivered delivery id', async () => {
    webhookDeliveriesRepository.findByDeliveryId.mockResolvedValue({
      deliveryId: 'delivery-1',
      analysisRunId: 'run-1',
    });

    const result = await service.handle(buildRequest(pullRequestPayload()));

    expect(result).toEqual({
      deliveryId: 'delivery-1',
      accepted: true,
      duplicate: true,
      analysisRunId: 'run-1',
    });
    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
    expect(webhookDeliveriesRepository.create).not.toHaveBeenCalled();
  });

  it('accepts a non pull_request event without processing or recording it', async () => {
    const request = buildRequest({ zen: 'hello' }, { eventName: 'ping' });

    const result = await service.handle(request);

    expect(result).toEqual({
      deliveryId: 'delivery-1',
      accepted: true,
      duplicate: false,
      analysisRunId: null,
    });
    expect(repositoryBindingsRepository.findByRepositoryId).not.toHaveBeenCalled();
    expect(webhookDeliveriesRepository.create).not.toHaveBeenCalled();
  });

  it('starts a run for an "opened" ready PR targeting the integration branch', async () => {
    const run = buildRun();
    analysisRunsService.startRunFromWebhook.mockResolvedValue(run);

    const result = await service.handle(buildRequest(pullRequestPayload()));

    expect(analysisRunsService.startRunFromWebhook).toHaveBeenCalledWith({
      projectId: 'project-1',
      repositoryId: '123',
      repositoryName: 'org/repo',
      prNumber: 42,
      prTitle: 'Add feature',
      baseRef: 'develop',
      headRef: 'feature/x',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      draft: false,
      actorLogin: 'octocat',
    });
    expect(webhookDeliveriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'delivery-1', analysisRunId: run.id }),
    );
    expect(result.analysisRunId).toBe(run.id);
  });

  it('does not start a run for a draft PR', async () => {
    const result = await service.handle(
      buildRequest(pullRequestPayload({ pull_request: { ...pullRequestPayload().pull_request, draft: true } })),
    );

    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
    expect(result.analysisRunId).toBeNull();
  });

  it('does not start a run when there is no binding for the repository', async () => {
    repositoryBindingsRepository.findByRepositoryId.mockResolvedValue(null);

    const result = await service.handle(buildRequest(pullRequestPayload()));

    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
    expect(result.analysisRunId).toBeNull();
  });

  it('does not start a run when the binding is not ENABLED', async () => {
    repositoryBindingsRepository.findByRepositoryId.mockResolvedValue({
      ...binding,
      status: 'DISABLED',
    });

    const result = await service.handle(buildRequest(pullRequestPayload()));

    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
    expect(result.analysisRunId).toBeNull();
  });

  it('does not start a run when the installation id does not match the binding', async () => {
    const result = await service.handle(
      buildRequest(pullRequestPayload({ installation: { id: 1 } })),
    );

    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
    expect(result.analysisRunId).toBeNull();
  });

  it('closes the current run on synchronize when the PR base moved off the integration branch', async () => {
    const current = buildRun({ status: 'PROCESSING' });
    analysisRunsRepository.findCurrentByPullRequest.mockResolvedValue(current);
    const closed = buildRun({ id: current.id, status: 'OBSOLETE', current: false });
    analysisRunsService.closeRun.mockResolvedValue(closed);

    const result = await service.handle(
      buildRequest(
        pullRequestPayload({
          action: 'synchronize',
          pull_request: { ...pullRequestPayload().pull_request, base: { ref: 'main', sha: 'base-sha' } },
        }),
      ),
    );

    expect(analysisRunsService.closeRun).toHaveBeenCalledWith(current, undefined);
    expect(result.analysisRunId).toBe(current.id);
  });

  it('closes the run with MERGED when a closed PR was merged', async () => {
    const current = buildRun({ status: 'SUCCESS' });
    analysisRunsRepository.findCurrentByPullRequest.mockResolvedValue(current);

    await service.handle(
      buildRequest(
        pullRequestPayload({
          action: 'closed',
          pull_request: { ...pullRequestPayload().pull_request, merged: true },
        }),
      ),
    );

    expect(analysisRunsService.closeRun).toHaveBeenCalledWith(current, 'MERGED');
  });

  it('closes the run with CLOSED when a closed PR was not merged', async () => {
    const current = buildRun({ status: 'PROCESSING' });
    analysisRunsRepository.findCurrentByPullRequest.mockResolvedValue(current);

    await service.handle(buildRequest(pullRequestPayload({ action: 'closed' })));

    expect(analysisRunsService.closeRun).toHaveBeenCalledWith(current, 'CLOSED');
  });

  it('closes the run without a prState change on converted_to_draft', async () => {
    const current = buildRun({ status: 'PROCESSING' });
    analysisRunsRepository.findCurrentByPullRequest.mockResolvedValue(current);

    await service.handle(buildRequest(pullRequestPayload({ action: 'converted_to_draft' })));

    expect(analysisRunsService.closeRun).toHaveBeenCalledWith(current, undefined);
  });

  it('is a no-op when closing a PR with no tracked current run', async () => {
    analysisRunsRepository.findCurrentByPullRequest.mockResolvedValue(null);

    const result = await service.handle(buildRequest(pullRequestPayload({ action: 'closed' })));

    expect(analysisRunsService.closeRun).not.toHaveBeenCalled();
    expect(result.analysisRunId).toBeNull();
  });

  it('re-enters the integration branch on edited when the PR is ready', async () => {
    const run = buildRun();
    analysisRunsService.startRunFromWebhook.mockResolvedValue(run);

    const result = await service.handle(
      buildRequest(pullRequestPayload({ action: 'edited' })),
    );

    expect(analysisRunsService.startRunFromWebhook).toHaveBeenCalled();
    expect(result.analysisRunId).toBe(run.id);
  });

  it('ignores an unrecognized pull_request action', async () => {
    const result = await service.handle(
      buildRequest(pullRequestPayload({ action: 'labeled' })),
    );

    expect(analysisRunsService.startRunFromWebhook).not.toHaveBeenCalled();
    expect(analysisRunsService.closeRun).not.toHaveBeenCalled();
    expect(result.analysisRunId).toBeNull();
  });
});
