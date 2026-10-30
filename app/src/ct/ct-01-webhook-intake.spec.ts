import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunRealtimeEvents } from '../analysis-runs/analysis-run-realtime.events.js';
import {
  AnalysisRunsRepository,
  type CreateAnalysisRunInput,
} from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { ExperimentCapturesRepository } from '../experiment-captures/persistence/experiment-captures.repository.js';
import { BindingLifecycleService } from '../access-sync/binding-lifecycle.service.js';
import { OrganizationLifecycleService } from '../access-sync/organization-lifecycle.service.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { AccessEventsService } from '../github-webhooks/access-events.service.js';
import { GithubIntegrationAuthGuard } from '../github-webhooks/github-integration-auth.guard.js';
import { GithubWebhooksController } from '../github-webhooks/github-webhooks.controller.js';
import { GithubWebhooksService } from '../github-webhooks/github-webhooks.service.js';
import { RepositoryEventsService } from '../github-webhooks/repository-events.service.js';
import { WebhookDeliveriesRepository } from '../github-webhooks/webhook-deliveries.repository.js';
import type { AnalysisRun, RepositoryBinding } from '../generated/prisma/client.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { SNAPSHOT_ANALYSIS_JOB_TYPE } from '../snapshot-intelligence/snapshot-analysis-job.handler.js';

/**
 * CT-01 (C-01, Integration -> Core): mitad de Core. Los eventos son los ejemplos canónicos de
 * `spec/contracts/schemas/examples/` (D-2); entran por la entrada real del receptor interno
 * (controlador + guard + ValidationPipe + `GithubWebhooksService` + `AnalysisRunsService` reales)
 * con dobles de repositorio y de jobs, como en los specs vecinos.
 *
 * Cubierto aparte (no se duplica aquí): CT-01-A2/A3/A5 en `github-webhooks.controller.spec.ts` y
 * `github-webhooks.service.spec.ts` (bearer, esquema, duplicado idempotente).
 */
const EXAMPLES = resolve(__dirname, '../../../spec/contracts/schemas/examples');
const example = (name: string): any =>
  JSON.parse(readFileSync(resolve(EXAMPLES, `github-webhook-event.${name}.json`), 'utf8'));

const TOKEN = 'ct-01-service-token';
const URL = '/internal/v1/github/webhook-events';

describe('CT-01 recepción de eventos de Integration en Core', () => {
  let app: INestApplication;
  let runs: AnalysisRun[];
  let binding: RepositoryBinding;
  let deliveries: Array<Record<string, unknown>>;
  const jobs = { enqueue: vi.fn(), enqueueDeduped: vi.fn() };
  const bindingsRepo = {
    findByRepositoryId: vi.fn(),
    findByInstallation: vi.fn(),
    suspendByInstallation: vi.fn(),
    unsuspendByInstallation: vi.fn(),
  };
  const bindingLifecycle = { revokeBinding: vi.fn() };

  /** Repositorio de Runs en memoria: conserva la identidad que recibe, sin inventar valores. */
  const runsRepository = {
    findCurrentByPullRequest: vi.fn(async (projectId: string, repositoryId: string, prNumber: number) =>
      runs.find((r) => r.current && r.projectId === projectId && r.repositoryId === repositoryId && r.prNumber === prNumber) ?? null),
    create: vi.fn(async (input: CreateAnalysisRunInput) => {
      const run = {
        id: `run-${runs.length + 1}`,
        checkId: null,
        checkPublishedAt: null,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        repositoryName: input.repositoryName,
        prNumber: input.prNumber,
        prTitle: input.prTitle,
        baseRef: input.baseRef,
        headRef: input.headRef,
        baseSha: input.baseSha,
        headSha: input.headSha,
        draft: input.draft,
        prState: 'OPEN',
        actorLogin: input.actorLogin,
        status: 'QUEUED',
        current: true,
        attemptCount: 0,
        indexMode: 'BOOTSTRAP',
        changesetBaseSha: input.baseSha,
        changesetHeadSha: input.headSha,
        indexDeltaBaseSha: null,
        projectVersionId: null,
        pullRequestCreatedAt: input.pullRequestCreatedAt ?? null,
        repositoryBindingEligible: input.repositoryBindingEligible ?? null,
        functionalBehaviorValidated: false,
        actionRequiredCount: 0,
        generatedTestsCount: 0,
        resultSummary: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AnalysisRun;
      runs.push(run);
      return run;
    }),
    transitionCurrent: vi.fn(async (id: string, from: string, to: string, patch: Record<string, unknown>) => {
      const run = runs.find((r) => r.id === id);
      if (!run || !run.current || run.status !== from) return null;
      Object.assign(run, patch, { status: to });
      return run;
    }),
    findById: vi.fn(async (id: string) => runs.find((r) => r.id === id) ?? null),
    update: vi.fn(),
    classifyPullRequest: vi.fn(async () => ({ classifiedCount: 0, eligible: true, obsoletedRunIds: [] as string[] })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [GithubWebhooksController],
      providers: [
        GithubIntegrationAuthGuard,
        GithubWebhooksService,
        AnalysisRunsService,
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'GITHUB_INTEGRATION_TO_CORE_TOKEN' ? TOKEN : undefined) } },
        { provide: AnalysisRunsRepository, useValue: runsRepository },
        { provide: ProjectsRepository, useValue: { findById: vi.fn() } },
        { provide: ProjectAccessService, useValue: { require: vi.fn() } },
        { provide: AnalysisRunRealtimeEvents, useValue: { runChanged: vi.fn().mockResolvedValue(undefined) } },
        // WI-CORE-109: sin captura armada la reserva no encuentra fila y el Run se crea normal.
        { provide: ExperimentCapturesRepository, useValue: { reserveIfArmed: vi.fn().mockResolvedValue(null) } },
        {
          provide: WebhookDeliveriesRepository,
          useValue: {
            findByDeliveryId: vi.fn(async (id: string) => deliveries.find((d) => d.deliveryId === id) ?? null),
            create: vi.fn(async (d: Record<string, unknown>) => { deliveries.push(d); return d; }),
          },
        },
        { provide: RepositoryBindingsRepository, useValue: bindingsRepo },
        { provide: JobsService, useValue: jobs },
        { provide: RepositoryEventsService, useValue: { handle: vi.fn() } },
        { provide: BindingLifecycleService, useValue: bindingLifecycle },
        { provide: OrganizationLifecycleService, useValue: { hide: vi.fn() } },
        { provide: AccessEventsService, useValue: { handle: vi.fn() } },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    runs = [];
    deliveries = [];
    binding = {
      id: 'binding-1',
      projectId: 'project-1',
      installationId: '2001',
      repositoryId: '1001',
      repositoryName: 'example-org/example-repo',
      integrationBranch: 'main',
      status: 'ENABLED',
      disabledReason: null,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    vi.clearAllMocks();
    jobs.enqueue.mockResolvedValue('job-1');
    jobs.enqueueDeduped.mockResolvedValue({ created: true, jobId: 'job-2' });
    bindingsRepo.findByRepositoryId.mockImplementation(async (id: string) => (id === binding.repositoryId ? binding : null));
    bindingsRepo.findByInstallation.mockImplementation(async (id: string) => (id === binding.installationId ? [binding] : []));
    bindingsRepo.suspendByInstallation.mockImplementation(async (id: string) => {
      if (id === binding.installationId) {
        binding = { ...binding, status: 'DISABLED', disabledReason: 'INSTALLATION_SUSPENDED' };
      }
    });
    bindingLifecycle.revokeBinding.mockImplementation(async () => { binding = { ...binding, status: 'REVOKED' }; });
  });

  const send = (event: unknown) => request(app.getHttpServer()).post(URL).set('Authorization', `Bearer ${TOKEN}`).send(event as object);

  it('CT-01-A1: un PR abierto canónico crea un AnalysisRun con repo, PR y HEAD idénticos al payload', async () => {
    const event = example('pull-request.opened');
    const pr = event.data.pullRequest;

    const response = await send(event).expect(202);

    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(response.body).toEqual({ deliveryId: event.deliveryId, accepted: true, duplicate: false, analysisRunId: run.id });
    expect(run.repositoryId).toBe(event.data.repository.id);
    expect(run.repositoryName).toBe(event.data.repository.fullName);
    expect(run.prNumber).toBe(event.data.pullRequestNumber);
    expect(run.headSha).toBe(pr.head.sha);
    expect(run.headRef).toBe(pr.head.ref);
    expect(run.baseSha).toBe(pr.base.sha);
    expect(run.baseRef).toBe(pr.base.ref);
    expect(run.actorLogin).toBe(pr.userLogin);
    expect(run.status).toBe('QUEUED');
    expect(run.current).toBe(true);
    // El Run encola su análisis de snapshot y la entrega queda registrada con el Run.
    expect(jobs.enqueue).toHaveBeenCalledWith(SNAPSHOT_ANALYSIS_JOB_TYPE, { analysisRunId: run.id });
    expect(deliveries).toEqual([
      expect.objectContaining({
        deliveryId: event.deliveryId,
        repositoryId: '1001',
        prNumber: 7,
        headSha: pr.head.sha,
        analysisRunId: run.id,
      }),
    ]);
  });

  it('CT-01-A1: un PR actualizado canónico (synchronize) obsoleta el Run previo y crea uno con el HEAD nuevo', async () => {
    const opened = example('pull-request.opened');
    const synchronize = example('pull-request.synchronize');
    await send(opened).expect(202);

    const response = await send(synchronize).expect(202);

    expect(runs).toHaveLength(2);
    const [previous, next] = runs;
    expect(previous.headSha).toBe(opened.data.pullRequest.head.sha);
    expect(previous.status).toBe('OBSOLETE');
    expect(previous.current).toBe(false);
    expect(next.headSha).toBe(synchronize.data.pullRequest.head.sha);
    expect(next.headSha).not.toBe(previous.headSha);
    expect(next.repositoryId).toBe(synchronize.data.repository.id);
    expect(next.prNumber).toBe(synchronize.data.pullRequestNumber);
    expect(next.current).toBe(true);
    expect(response.body.analysisRunId).toBe(next.id);
    expect(runs.filter((r) => r.current)).toEqual([next]);
  });

  describe('CT-01-A4: evento no elegible o instalación sin permisos', () => {
    const noRunWith = (analysisRunId: string | null = null) => {
      expect(runs).toHaveLength(0);
      expect(runsRepository.create).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
      expect(analysisRunId).toBeNull();
    };

    it('CT-01-A4: un evento no elegible (ping canónico) se acepta, no crea Run y no registra entrega', async () => {
      const response = await send(example('ignored')).expect(202);

      expect(response.body).toEqual({ deliveryId: 'example-delivery-ignored', accepted: true, duplicate: false, analysisRunId: null });
      noRunWith(response.body.analysisRunId);
      expect(deliveries).toHaveLength(0);
    });

    it('CT-01-A4: un PR de un repositorio sin binding no crea Run y la entrega queda registrada sin Run', async () => {
      bindingsRepo.findByRepositoryId.mockResolvedValueOnce(null);
      const event = example('pull-request.opened');

      const response = await send(event).expect(202);

      noRunWith(response.body.analysisRunId);
      expect(deliveries).toEqual([expect.objectContaining({ deliveryId: event.deliveryId, analysisRunId: null })]);
    });

    it.each([
      ['binding DISABLED por el usuario', { status: 'DISABLED', disabledReason: 'USER' }],
      ['binding REVOKED', { status: 'REVOKED', disabledReason: null }],
    ] as const)('CT-01-A4: un PR con %s no crea Run y la entrega queda registrada sin Run', async (_label, patch) => {
      binding = { ...binding, ...patch } as RepositoryBinding;
      const event = example('pull-request.opened');

      const response = await send(event).expect(202);

      noRunWith(response.body.analysisRunId);
      expect(deliveries).toEqual([expect.objectContaining({ deliveryId: event.deliveryId, analysisRunId: null })]);
    });

    it('CT-01-A4: un PR de una instalación distinta de la del binding (sin permisos) no crea Run', async () => {
      const event = example('pull-request.opened');
      event.data.installationId = '9999';

      const response = await send(event).expect(202);

      noRunWith(response.body.analysisRunId);
      expect(deliveries).toEqual([expect.objectContaining({ deliveryId: event.deliveryId, analysisRunId: null })]);
    });

    it('CT-01-A4: un PR borrador no crea Run', async () => {
      const event = example('pull-request.opened');
      event.data.pullRequest.draft = true;

      const response = await send(event).expect(202);

      noRunWith(response.body.analysisRunId);
    });

    it('CT-01-A4: una instalación suspendida deja el binding DISABLED/INSTALLATION_SUSPENDED y los PR posteriores no crean Run', async () => {
      const suspend = { ...example('installation'), deliveryId: 'delivery-suspend', action: 'suspend' };

      await send(suspend).expect(202);

      expect(bindingsRepo.suspendByInstallation).toHaveBeenCalledWith('2001');
      expect(binding.status).toBe('DISABLED');
      expect(binding.disabledReason).toBe('INSTALLATION_SUSPENDED');

      const response = await send(example('pull-request.opened')).expect(202);
      noRunWith(response.body.analysisRunId);
    });

    it('CT-01-A4: una instalación eliminada revoca el binding y los PR posteriores no crean Run', async () => {
      const deleted = { ...example('installation'), deliveryId: 'delivery-deleted', action: 'deleted' };

      await send(deleted).expect(202);

      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledTimes(1);
      expect(binding.status).toBe('REVOKED');

      const response = await send(example('pull-request.opened')).expect(202);
      noRunWith(response.body.analysisRunId);
    });

    it('CT-01-A4: la retirada de un repositorio de la instalación revoca solo ese binding y no crea Run', async () => {
      const removed = {
        ...example('installation-repositories'),
        deliveryId: 'delivery-repo-removed',
        action: 'removed',
      };
      removed.data.removed = [{ id: '1001', fullName: 'example-org/example-repo' }];
      removed.data.installationId = '2001';

      await send(removed).expect(202);

      expect(bindingLifecycle.revokeBinding).toHaveBeenCalledTimes(1);
      expect(binding.status).toBe('REVOKED');
      noRunWith();
    });
  });
});
