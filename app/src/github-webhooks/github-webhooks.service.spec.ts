import { createHmac } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubWebhooksService, type IncomingWebhookRequest } from './github-webhooks.service.js';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { RepositoryEventsService } from './repository-events.service.js';
import { BindingLifecycleService } from '../access-sync/binding-lifecycle.service.js';
import { OrganizationLifecycleService } from '../access-sync/organization-lifecycle.service.js';
import { AccessEventsService } from './access-events.service.js';
import { SNAPSHOT_ANALYSIS_JOB_TYPE } from '../snapshot-intelligence/snapshot-analysis-job.handler.js';
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
  let repositoryBindingsRepository: {
    findByRepositoryId: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    findByInstallation: ReturnType<typeof vi.fn>;
    suspendByInstallation: ReturnType<typeof vi.fn>;
    unsuspendByInstallation: ReturnType<typeof vi.fn>;
  };
  let analysisRunsRepository: { findCurrentByPullRequest: ReturnType<typeof vi.fn> };
  let analysisRunsService: {
    startRunFromWebhook: ReturnType<typeof vi.fn>;
    closeRun: ReturnType<typeof vi.fn>;
  };
  let jobsService: { enqueue: ReturnType<typeof vi.fn> };
  let repositoryEvents: { handle: ReturnType<typeof vi.fn> };
  let bindingLifecycle: { revokeBinding: ReturnType<typeof vi.fn> };
  let organizationLifecycle: { hide: ReturnType<typeof vi.fn> };
  let accessEvents: { handle: ReturnType<typeof vi.fn> };

  const binding: RepositoryBinding = {
    id: 'binding-1',
    projectId: 'project-1',
    installationId: '999',
    repositoryId: '123',
    repositoryName: 'org/repo',
    integrationBranch: 'develop',
    status: 'ENABLED',
    disabledReason: null,
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
      projectVersionId: null,
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
    repositoryBindingsRepository = {
      findByRepositoryId: vi.fn().mockResolvedValue(binding),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      findByInstallation: vi.fn().mockResolvedValue([binding]),
      suspendByInstallation: vi.fn().mockResolvedValue(undefined),
      unsuspendByInstallation: vi.fn().mockResolvedValue(undefined),
    };
    analysisRunsRepository = { findCurrentByPullRequest: vi.fn().mockResolvedValue(null) };
    analysisRunsService = {
      startRunFromWebhook: vi.fn().mockResolvedValue({ run: buildRun(), isNew: true }),
      closeRun: vi.fn().mockResolvedValue(buildRun({ status: 'OBSOLETE', current: false })),
    };
    jobsService = { enqueue: vi.fn().mockResolvedValue('job-1') };
    repositoryEvents = { handle: vi.fn().mockResolvedValue(undefined) };
    bindingLifecycle = { revokeBinding: vi.fn().mockResolvedValue(undefined) };
    organizationLifecycle = { hide: vi.fn().mockResolvedValue(1) };
    accessEvents = { handle: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubWebhooksService,
        { provide: ConfigService, useValue: configService },
        { provide: WebhookDeliveriesRepository, useValue: webhookDeliveriesRepository },
        { provide: RepositoryBindingsRepository, useValue: repositoryBindingsRepository },
        { provide: AnalysisRunsRepository, useValue: analysisRunsRepository },
        { provide: AnalysisRunsService, useValue: analysisRunsService },
        { provide: JobsService, useValue: jobsService },
        { provide: RepositoryEventsService, useValue: repositoryEvents },
        { provide: BindingLifecycleService, useValue: bindingLifecycle },
        { provide: OrganizationLifecycleService, useValue: organizationLifecycle },
        { provide: AccessEventsService, useValue: accessEvents },
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
    expect(jobsService.enqueue).not.toHaveBeenCalled();
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
    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });

  it('starts a run for an "opened" ready PR targeting the integration branch and enqueues the snapshot job', async () => {
    const run = buildRun();
    analysisRunsService.startRunFromWebhook.mockResolvedValue({ run, isNew: true });

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
    expect(jobsService.enqueue).toHaveBeenCalledWith(SNAPSHOT_ANALYSIS_JOB_TYPE, {
      analysisRunId: run.id,
    });
    expect(webhookDeliveriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'delivery-1', analysisRunId: run.id }),
    );
    expect(result.analysisRunId).toBe(run.id);
  });

  it('does not enqueue the snapshot job when the run already existed (idempotent redelivery)', async () => {
    const run = buildRun();
    analysisRunsService.startRunFromWebhook.mockResolvedValue({ run, isNew: false });

    await service.handle(buildRequest(pullRequestPayload()));

    expect(jobsService.enqueue).not.toHaveBeenCalled();
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
    expect(jobsService.enqueue).not.toHaveBeenCalled();
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
    analysisRunsService.startRunFromWebhook.mockResolvedValue({ run, isNew: true });

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

  describe('installation (revocación)', () => {
    it('revokes every binding of the installation (REVOKED + Maintainer/Reader records) on deleted, whatever its status', async () => {
      const paused = { ...binding, id: 'binding-2', projectId: 'project-2', status: 'DISABLED' as const };
      repositoryBindingsRepository.findByInstallation.mockResolvedValue([binding, paused]);

      const result = await service.handle(
        buildRequest({ action: 'deleted', installation: { id: 999 } }, { eventName: 'installation' }),
      );

      expect(repositoryBindingsRepository.findByInstallation).toHaveBeenCalledWith('999');
      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledTimes(2);
      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledWith(binding);
      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledWith(paused);
      expect(result.accepted).toBe(true);
      expect(result.analysisRunId).toBeNull();
    });

    it('suspend never deletes access records (a suspended installation is treated as GitHub unavailable)', async () => {
      await service.handle(
        buildRequest({ action: 'suspend', installation: { id: 999 } }, { eventName: 'installation' }),
      );

      expect(bindingLifecycle.revokeBinding).not.toHaveBeenCalled();
    });

    it('suspends the installation bindings (INSTALLATION_SUSPENDED) on suspend', async () => {
      await service.handle(
        buildRequest({ action: 'suspend', installation: { id: 999 } }, { eventName: 'installation' }),
      );

      expect(repositoryBindingsRepository.suspendByInstallation).toHaveBeenCalledWith('999');
    });

    it('resumes only suspension-disabled bindings on unsuspend (never user-paused ones)', async () => {
      await service.handle(
        buildRequest({ action: 'unsuspend', installation: { id: 999 } }, { eventName: 'installation' }),
      );

      expect(repositoryBindingsRepository.unsuspendByInstallation).toHaveBeenCalledWith('999');
    });

    it('does nothing for actions that do not affect an existing binding (e.g. created)', async () => {
      await service.handle(
        buildRequest({ action: 'created', installation: { id: 999 } }, { eventName: 'installation' }),
      );

      expect(bindingLifecycle.revokeBinding).not.toHaveBeenCalled();
      expect(repositoryBindingsRepository.suspendByInstallation).not.toHaveBeenCalled();
      expect(repositoryBindingsRepository.unsuspendByInstallation).not.toHaveBeenCalled();
    });
  });

  describe('installation_repositories (revocación por repo)', () => {
    it('revokes only the binding of the repository that was removed', async () => {
      await service.handle(
        buildRequest(
          {
            action: 'removed',
            installation: { id: 999 },
            repositories_removed: [{ id: 123, full_name: 'org/repo' }],
          },
          { eventName: 'installation_repositories' },
        ),
      );

      expect(repositoryBindingsRepository.findByRepositoryId).toHaveBeenCalledWith('123');
      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledWith(binding);
    });

    it('revokes a binding that is not ENABLED too (access events do not depend on binding.status)', async () => {
      const paused = { ...binding, status: 'DISABLED' as const };
      repositoryBindingsRepository.findByRepositoryId.mockResolvedValue(paused);

      await service.handle(
        buildRequest(
          { action: 'removed', installation: { id: 999 }, repositories_removed: [{ id: 123, full_name: 'org/repo' }] },
          { eventName: 'installation_repositories' },
        ),
      );

      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledWith(paused);
    });

    it('does not revoke a binding whose installationId does not match the event', async () => {
      repositoryBindingsRepository.findByRepositoryId.mockResolvedValue({ ...binding, installationId: '111' });

      await service.handle(
        buildRequest(
          {
            action: 'removed',
            installation: { id: 999 },
            repositories_removed: [{ id: 123, full_name: 'org/repo' }],
          },
          { eventName: 'installation_repositories' },
        ),
      );

      expect(bindingLifecycle.revokeBinding).not.toHaveBeenCalled();
    });

    it('does nothing for the added action', async () => {
      await service.handle(
        buildRequest(
          {
            action: 'added',
            installation: { id: 999 },
            repositories_added: [{ id: 123, full_name: 'org/repo' }],
          },
          { eventName: 'installation_repositories' },
        ),
      );

      expect(bindingLifecycle.revokeBinding).not.toHaveBeenCalled();
    });
  });

  describe('repository events (HU61)', () => {
    it('routes `repository` to the repository handler with the payload and answers accepted without recording a delivery', async () => {
      const payload = { action: 'renamed', repository: { id: 123, full_name: 'org/renamed' } };

      const result = await service.handle(buildRequest(payload, { eventName: 'repository' }));

      expect(repositoryEvents.handle).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ deliveryId: 'delivery-1', accepted: true, duplicate: false, analysisRunId: null });
      expect(webhookDeliveriesRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a tampered signature before touching anything', async () => {
      const request = buildRequest({ action: 'deleted', repository: { id: 123 } }, { eventName: 'repository', signatureHeader: 'sha256=deadbeef' });

      await expect(service.handle(request)).rejects.toMatchObject({ code: ErrorCode.INVALID_WEBHOOK_SIGNATURE });
      expect(repositoryEvents.handle).not.toHaveBeenCalled();
    });

    it.each(['member', 'membership', 'organization', 'team'])(
      'routes `%s` to the access handler with the payload and answers 202 (no binding lookup, no delivery record, no analysis job)',
      async (eventName) => {
        const payload = { action: 'added', member: { id: 1 }, repository: { id: 123 } };

        const result = await service.handle(buildRequest(payload, { eventName }));

        expect(accessEvents.handle).toHaveBeenCalledWith(eventName, payload);
        expect(result).toEqual({ deliveryId: 'delivery-1', accepted: true, duplicate: false, analysisRunId: null });
        expect(repositoryBindingsRepository.findByRepositoryId).not.toHaveBeenCalled();
        expect(repositoryEvents.handle).not.toHaveBeenCalled();
        expect(bindingLifecycle.revokeBinding).not.toHaveBeenCalled();
        expect(jobsService.enqueue).not.toHaveBeenCalled();
        expect(webhookDeliveriesRepository.create).not.toHaveBeenCalled();
      },
    );

    it.each(['member', 'membership', 'organization', 'team'])('rejects a tampered `%s` signature before handling it', async (eventName) => {
      const request = buildRequest({ action: 'removed', member: { id: 1 } }, { eventName, signatureHeader: 'sha256=deadbeef' });

      await expect(service.handle(request)).rejects.toMatchObject({ code: ErrorCode.INVALID_WEBHOOK_SIGNATURE });
      expect(accessEvents.handle).not.toHaveBeenCalled();
    });

    it.each(['ping', 'star', 'push', 'workflow_run'])('still accepts the unlisted event `%s` with 202 and no effect', async (eventName) => {
      const result = await service.handle(buildRequest({ action: 'created' }, { eventName }));

      expect(result).toEqual({ deliveryId: 'delivery-1', accepted: true, duplicate: false, analysisRunId: null });
      expect(accessEvents.handle).not.toHaveBeenCalled();
      expect(repositoryEvents.handle).not.toHaveBeenCalled();
    });

    it('a redelivered access event (same delivery id already recorded) is answered duplicate and not reprocessed', async () => {
      webhookDeliveriesRepository.findByDeliveryId.mockResolvedValue({ deliveryId: 'delivery-1', analysisRunId: null });

      const result = await service.handle(buildRequest({ action: 'removed', member: { id: 1 }, repository: { id: 123 } }, { eventName: 'member' }));

      expect(result.duplicate).toBe(true);
      expect(accessEvents.handle).not.toHaveBeenCalled();
    });
  });

  describe('installation.deleted of an ORGANIZATION (HU61, ciclo de vida de la organización)', () => {
    it('also hides the organization projects (Admin records included) after revoking the bindings of the installation', async () => {
      await service.handle(
        buildRequest({ action: 'deleted', installation: { id: 999, account: { id: 42, type: 'Organization' } } }, { eventName: 'installation' }),
      );

      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledWith(binding);
      expect(organizationLifecycle.hide).toHaveBeenCalledWith('42');
    });

    it('a PERSONAL account installation only revokes bindings (no organization to hide)', async () => {
      await service.handle(
        buildRequest({ action: 'deleted', installation: { id: 999, account: { id: 7, type: 'User' } } }, { eventName: 'installation' }),
      );

      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledWith(binding);
      expect(organizationLifecycle.hide).not.toHaveBeenCalled();
    });

    it('a failure revoking ONE binding does not stop the others nor hiding the organization, and the ingress still answers 202', async () => {
      const second = { ...binding, id: 'binding-2', projectId: 'project-2', repositoryId: '124' };
      repositoryBindingsRepository.findByInstallation.mockResolvedValue([binding, second]);
      bindingLifecycle.revokeBinding.mockRejectedValueOnce(new Error('lock timeout'));

      const result = await service.handle(
        buildRequest({ action: 'deleted', installation: { id: 999, account: { id: 42, type: 'Organization' } } }, { eventName: 'installation' }),
      );

      expect(result).toEqual({ deliveryId: 'delivery-1', accepted: true, duplicate: false, analysisRunId: null });
      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledTimes(2);
      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledWith(second);
      expect(organizationLifecycle.hide).toHaveBeenCalledWith('42');
    });

    it('a failure hiding the organization is recorded and the ingress still answers 202 (the reconciliation finishes it)', async () => {
      organizationLifecycle.hide.mockRejectedValue(new Error('incompleto'));

      const result = await service.handle(
        buildRequest({ action: 'deleted', installation: { id: 999, account: { id: 42, type: 'Organization' } } }, { eventName: 'installation' }),
      );

      expect(result.accepted).toBe(true);
      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledWith(binding);
    });

    it('installation_repositories.removed isolates the failure per repository and still answers 202', async () => {
      const other = { ...binding, id: 'binding-2', projectId: 'project-2', repositoryId: '124' };
      repositoryBindingsRepository.findByRepositoryId.mockImplementation((id: string) => Promise.resolve(id === '123' ? binding : other));
      bindingLifecycle.revokeBinding.mockRejectedValueOnce(new Error('lock timeout'));

      const result = await service.handle(
        buildRequest(
          { action: 'removed', installation: { id: 999 }, repositories_removed: [{ id: 123, full_name: 'org/a' }, { id: 124, full_name: 'org/b' }] },
          { eventName: 'installation_repositories' },
        ),
      );

      expect(result.accepted).toBe(true);
      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledWith(other);
    });

    it('suspend, unsuspend and installation_repositories never hide the organization', async () => {
      const account = { id: 42, type: 'Organization' };
      await service.handle(buildRequest({ action: 'suspend', installation: { id: 999, account } }, { eventName: 'installation' }));
      await service.handle(buildRequest({ action: 'unsuspend', installation: { id: 999, account } }, { eventName: 'installation' }));
      await service.handle(
        buildRequest({ action: 'removed', installation: { id: 999, account }, repositories_removed: [{ id: 123, full_name: 'org/repo' }] }, { eventName: 'installation_repositories' }),
      );

      expect(organizationLifecycle.hide).not.toHaveBeenCalled();
    });
  });
});
