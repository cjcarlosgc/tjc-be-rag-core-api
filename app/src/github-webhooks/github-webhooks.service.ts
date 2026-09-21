import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isValidWebhookSignature } from './webhook-signature.util.js';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository.js';
import type { GithubPullRequestWebhookPayload } from './dto/pull-request-webhook.payload.js';
import type {
  GithubInstallationRepositoriesWebhookPayload,
  GithubInstallationWebhookPayload,
} from './dto/installation-webhook.payload.js';
import type { GithubRepositoryWebhookPayload } from './dto/repository-webhook.payload.js';
import type { GitHubWebhookAcceptedResponse } from './dto/webhook-accepted.response.js';
import { RepositoryEventsService } from './repository-events.service.js';
import { ACCESS_EVENT_NAMES, AccessEventsService, type AccessEventName } from './access-events.service.js';
import { BindingLifecycleService } from '../access-sync/binding-lifecycle.service.js';
import { OrganizationLifecycleService } from '../access-sync/organization-lifecycle.service.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import type { CreateAnalysisRunInput } from '../analysis-runs/analysis-runs.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SNAPSHOT_ANALYSIS_JOB_TYPE } from '../snapshot-intelligence/snapshot-analysis-job.handler.js';

export interface IncomingWebhookRequest {
  rawBody: Buffer | undefined;
  signatureHeader: string | undefined;
  deliveryId: string | undefined;
  eventName: string | undefined;
  payload: unknown;
}

/**
 * HU31: firma sobre body crudo, normalización de `pull_request` e
 * idempotencia por delivery id. Solo bindings ENABLED cuya instalación
 * coincide con la del payload producen trabajo (`spec/contracts/
 * system-contract.md`, "AnalysisRun, Job y Check"). También procesa
 * `installation`/`installation_repositories` (revocación): mueve el/los
 * binding(s) afectados a REVOKED/DISABLED/ENABLED según corresponda.
 */
@Injectable()
export class GithubWebhooksService {
  constructor(
    private readonly configService: ConfigService,
    private readonly webhookDeliveriesRepository: WebhookDeliveriesRepository,
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly jobsService: JobsService,
    private readonly repositoryEvents: RepositoryEventsService,
    private readonly bindingLifecycle: BindingLifecycleService,
    private readonly organizationLifecycle: OrganizationLifecycleService,
    private readonly accessEvents: AccessEventsService,
  ) {}

  async handle(request: IncomingWebhookRequest): Promise<GitHubWebhookAcceptedResponse> {
    const secret = this.configService.get<string>('GITHUB_APP_WEBHOOK_SECRET');

    if (!secret) {
      throw new AppException(
        ErrorCode.GITHUB_WEBHOOK_UNAVAILABLE,
        'La integración de GitHub App no está configurada.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!isValidWebhookSignature(request.rawBody, request.signatureHeader, secret)) {
      throw new AppException(
        ErrorCode.INVALID_WEBHOOK_SIGNATURE,
        'La firma del webhook de GitHub es inválida.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!request.deliveryId) {
      throw new AppException(
        ErrorCode.INVALID_REQUEST,
        'Falta el header x-github-delivery.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.webhookDeliveriesRepository.findByDeliveryId(request.deliveryId);

    if (existing) {
      return {
        deliveryId: request.deliveryId,
        accepted: true,
        duplicate: true,
        analysisRunId: existing.analysisRunId,
      };
    }

    if (request.eventName === 'installation') {
      await this.handleInstallationEvent(request.payload as GithubInstallationWebhookPayload);
      return { deliveryId: request.deliveryId, accepted: true, duplicate: false, analysisRunId: null };
    }

    if (request.eventName === 'installation_repositories') {
      await this.handleInstallationRepositoriesEvent(
        request.payload as GithubInstallationRepositoriesWebhookPayload,
      );
      return { deliveryId: request.deliveryId, accepted: true, duplicate: false, analysisRunId: null };
    }

    if (request.eventName === 'repository') {
      await this.repositoryEvents.handle(request.payload as GithubRepositoryWebhookPayload);
      return { deliveryId: request.deliveryId, accepted: true, duplicate: false, analysisRunId: null };
    }

    // Eventos de acceso de organización: solo encolan una reverificación viva (o ocultan/renombran la
    // organización) y responden `202`; sin `WebhookDelivery` porque todo es idempotente.
    if (request.eventName !== undefined && ACCESS_EVENT_NAMES.has(request.eventName)) {
      await this.accessEvents.handle(request.eventName as AccessEventName, request.payload);
      return { deliveryId: request.deliveryId, accepted: true, duplicate: false, analysisRunId: null };
    }

    // Cualquier otro evento no listado se acepta (`202`) sin efecto.
    if (request.eventName !== 'pull_request') {
      return {
        deliveryId: request.deliveryId,
        accepted: true,
        duplicate: false,
        analysisRunId: null,
      };
    }

    const payload = request.payload as GithubPullRequestWebhookPayload;
    const binding = await this.repositoryBindingsRepository.findByRepositoryId(
      String(payload.repository.id),
    );
    const actionable =
      !!binding &&
      binding.status === 'ENABLED' &&
      (!payload.installation || String(payload.installation.id) === binding.installationId);

    const analysisRunId = actionable ? await this.handlePullRequestEvent(payload, binding!) : null;

    await this.webhookDeliveriesRepository.create({
      deliveryId: request.deliveryId,
      repositoryId: String(payload.repository.id),
      prNumber: payload.number,
      headSha: payload.pull_request.head.sha,
      event: request.eventName,
      action: payload.action,
      analysisRunId,
    });

    return {
      deliveryId: request.deliveryId,
      accepted: true,
      duplicate: false,
      analysisRunId,
    };
  }

  private async handlePullRequestEvent(
    payload: GithubPullRequestWebhookPayload,
    binding: RepositoryBinding,
  ): Promise<string | null> {
    const pr = payload.pull_request;
    const onIntegrationBranch = pr.base.ref === binding.integrationBranch;

    switch (payload.action) {
      case 'opened':
      case 'reopened':
      case 'ready_for_review':
        if (!onIntegrationBranch || pr.draft) {
          return null;
        }
        return (await this.startRun(payload, binding)).id;

      case 'synchronize':
        if (!onIntegrationBranch) {
          return this.closeCurrentIfAny(binding, payload.number);
        }
        if (pr.draft) {
          return null;
        }
        return (await this.startRun(payload, binding)).id;

      case 'edited':
        if (!onIntegrationBranch) {
          return this.closeCurrentIfAny(binding, payload.number);
        }
        if (pr.draft) {
          return null;
        }
        return (await this.startRun(payload, binding)).id;

      case 'converted_to_draft':
        return this.closeCurrentIfAny(binding, payload.number);

      case 'closed':
        return this.closeCurrentIfAny(binding, payload.number, pr.merged ? 'MERGED' : 'CLOSED');

      default:
        return null;
    }
  }

  private async startRun(
    payload: GithubPullRequestWebhookPayload,
    binding: RepositoryBinding,
  ): Promise<{ id: string }> {
    const input: CreateAnalysisRunInput = {
      projectId: binding.projectId,
      repositoryId: binding.repositoryId,
      repositoryName: binding.repositoryName,
      prNumber: payload.number,
      prTitle: payload.pull_request.title,
      baseRef: payload.pull_request.base.ref,
      headRef: payload.pull_request.head.ref,
      baseSha: payload.pull_request.base.sha,
      headSha: payload.pull_request.head.sha,
      draft: payload.pull_request.draft,
      actorLogin: payload.pull_request.user?.login ?? null,
    };

    const { run, isNew } = await this.analysisRunsService.startRunFromWebhook(input);

    if (isNew) {
      await this.jobsService.enqueue(SNAPSHOT_ANALYSIS_JOB_TYPE, { analysisRunId: run.id });
    }

    return run;
  }

  private async closeCurrentIfAny(
    binding: RepositoryBinding,
    prNumber: number,
    prState?: 'CLOSED' | 'MERGED',
  ): Promise<string | null> {
    const current = await this.analysisRunsRepository.findCurrentByPullRequest(
      binding.projectId,
      binding.repositoryId,
      prNumber,
    );

    if (!current) {
      return null;
    }

    const closed = await this.analysisRunsService.closeRun(current, prState);
    return closed.id;
  }

  /**
   * HU31/HU61 (revocación): `deleted` = App desinstalada (bindings `REVOKED` y borrado de los
   * registros Maintainer/Reader con expulsión de sockets; si es de una organización, también
   * los Admin), `suspend`/`unsuspend` = pausa
   * reversible de la instalación completa (`suspend` NO borra registros: una instalación
   * suspendida se trata como GitHub no disponible). Sin dedup por delivery id -el efecto
   * es naturalmente idempotente, reprocesar el mismo evento no cambia el resultado-. Se
   * procesa aunque el binding no esté `ENABLED`.
   */
  private async handleInstallationEvent(payload: GithubInstallationWebhookPayload): Promise<void> {
    const installationId = String(payload.installation.id);

    if (payload.action === 'deleted') {
      for (const binding of await this.repositoryBindingsRepository.findByInstallation(installationId)) {
        await this.bindingLifecycle.revokeBinding(binding);
      }

      // Desinstalada de una ORGANIZACIÓN: además sus Projects quedan ocultos y conservados, y se
      // borran también los registros Admin (la organización ya no puede verificarse; los Projects
      // sin repositorio también). Reaparecen al reinstalar la App.
      const account = payload.installation.account;
      const organizationId = account?.type === 'Organization' && typeof account.id === 'number' ? String(account.id) : null;

      if (organizationId !== null) {
        await this.organizationLifecycle.hide(organizationId);
      }
    } else if (payload.action === 'suspend') {
      await this.repositoryBindingsRepository.suspendByInstallation(installationId);
    } else if (payload.action === 'unsuspend') {
      await this.repositoryBindingsRepository.unsuspendByInstallation(installationId);
    }
  }

  /**
   * HU31 (revocación): la instalación sigue viva, pero GitHub retiró acceso
   * a un repositorio puntual (el usuario lo destildó en la configuración de
   * la App). Solo afecta el binding de ese repo, no el resto de la
   * instalación: `REVOKED` y borrado de sus registros Maintainer/Reader.
   */
  private async handleInstallationRepositoriesEvent(
    payload: GithubInstallationRepositoriesWebhookPayload,
  ): Promise<void> {
    if (payload.action !== 'removed') {
      return;
    }

    for (const repo of payload.repositories_removed ?? []) {
      const binding = await this.repositoryBindingsRepository.findByRepositoryId(String(repo.id));

      if (binding && binding.installationId === String(payload.installation.id)) {
        await this.bindingLifecycle.revokeBinding(binding);
      }
    }
  }
}
