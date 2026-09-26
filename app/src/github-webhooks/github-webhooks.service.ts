import { Injectable, Logger } from '@nestjs/common';
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
import { toGithubId } from '../access-sync/access-reverify.scope.js';
import { OrganizationLifecycleService } from '../access-sync/organization-lifecycle.service.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import type { CreateAnalysisRunInput } from '../analysis-runs/analysis-runs.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SNAPSHOT_ANALYSIS_JOB_TYPE } from '../snapshot-intelligence/snapshot-analysis-job.handler.js';
import type { NormalizedWebhookEvent } from './dto/normalized-webhook-event.js';

/**
 * HU31: procesa el evento allowlisted que GH Integration ya normalizó e
 * idempotencia por delivery id para pull requests. Solo bindings ENABLED cuya instalación
 * coincide con la del payload producen trabajo (`spec/contracts/
 * system-contract.md`, "AnalysisRun, Job y Check"). También procesa
 * `installation`/`installation_repositories` (revocación): mueve el/los
 * binding(s) afectados a REVOKED/DISABLED/ENABLED según corresponda.
 */
@Injectable()
export class GithubWebhooksService {
  private readonly logger = new Logger(GithubWebhooksService.name);

  constructor(
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

  async handle(event: NormalizedWebhookEvent): Promise<GitHubWebhookAcceptedResponse> {
    const { deliveryId } = event;
    const accepted = (analysisRunId: string | null = null): GitHubWebhookAcceptedResponse => ({
      deliveryId,
      accepted: true,
      duplicate: false,
      analysisRunId,
    });

    if (event.data.kind === 'INSTALLATION') {
      await this.handleInstallationEvent(toInstallationPayload(event));
      return accepted();
    }

    if (event.data.kind === 'INSTALLATION_REPOSITORIES') {
      await this.handleInstallationRepositoriesEvent(toInstallationRepositoriesPayload(event));
      return accepted();
    }

    if (event.data.kind === 'REPOSITORY') {
      await this.repositoryEvents.handle(toRepositoryPayload(event));
      return accepted();
    }

    if (ACCESS_EVENT_NAMES.has(event.eventName)) {
      await this.accessEvents.handle(event.eventName as AccessEventName, toAccessPayload(event));
      return accepted();
    }

    if (event.data.kind !== 'PULL_REQUEST') {
      return accepted();
    }

    const existing = await this.webhookDeliveriesRepository.findByDeliveryId(deliveryId);
    if (existing) {
      return { deliveryId, accepted: true, duplicate: true, analysisRunId: existing.analysisRunId };
    }

    const payload = toPullRequestPayload(event);
    const binding = await this.repositoryBindingsRepository.findByRepositoryId(
      String(payload.repository.id),
    );
    const actionable =
      !!binding &&
      binding.status === 'ENABLED' &&
      (!payload.installation || String(payload.installation.id) === binding.installationId);

    const analysisRunId = actionable ? await this.handlePullRequestEvent(payload, binding!) : null;

    await this.webhookDeliveriesRepository.create({
      deliveryId,
      repositoryId: String(payload.repository.id),
      prNumber: payload.number,
      headSha: payload.pull_request.head.sha,
      event: event.eventName,
      action: event.action ?? '',
      analysisRunId,
    });

    return {
      deliveryId,
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
      // El fallo de UN binding no impide revocar los demás ni ocultar la organización: se recogen,
      // se registran y se responde `202` (la reconciliación (c) y (a) termina lo que falte).
      const failures: string[] = [];
      const bindings = await this.repositoryBindingsRepository.findByInstallation(installationId);
      await this.revokeIsolated(bindings, failures);

      // Desinstalada de una ORGANIZACIÓN: además sus Projects quedan ocultos y conservados, y se
      // borran también los registros Admin (la organización ya no puede verificarse; los Projects
      // sin repositorio también). Reaparecen al reinstalar la App.
      const account = payload.installation.account;
      const organizationId = account?.type === 'Organization' ? toGithubId(account.id) : null;

      if (organizationId !== null) {
        try {
          await this.organizationLifecycle.hide(organizationId);
        } catch (error) {
          failures.push(`organización ${organizationId}: ${describe(error)}`);
        }
      }

      this.reportPartialFailures(`installation.deleted (${installationId})`, failures);
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

    const failures: string[] = [];

    for (const repo of payload.repositories_removed ?? []) {
      try {
        const binding = await this.repositoryBindingsRepository.findByRepositoryId(String(repo.id));

        if (binding && binding.installationId === String(payload.installation.id)) {
          await this.bindingLifecycle.revokeBinding(binding);
        }
      } catch (error) {
        failures.push(`repositorio ${repo.id}: ${describe(error)}`);
      }
    }

    this.reportPartialFailures(`installation_repositories.removed (${payload.installation.id})`, failures);
  }

  /** Revoca cada binding por separado: un fallo se recoge y no detiene a los demás. */
  private async revokeIsolated(bindings: RepositoryBinding[], failures: string[]): Promise<void> {
    for (const binding of bindings) {
      try {
        await this.bindingLifecycle.revokeBinding(binding);
      } catch (error) {
        failures.push(`binding ${binding.id}: ${describe(error)}`);
      }
    }
  }

  /**
   * Los fallos parciales se registran y el ingress responde igual `202`: el estado ya es `REVOKED`
   * para lo tratado (el predicado de acceso deniega) y la reconciliación termina el borrado.
   */
  private reportPartialFailures(event: string, failures: string[]): void {
    if (failures.length > 0) {
      this.logger.error(`${event}: ${failures.length} fallo(s) parcial(es); la reconciliación lo termina: ${failures.join(' | ')}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toPullRequestPayload(event: NormalizedWebhookEvent): GithubPullRequestWebhookPayload {
  if (event.data.kind !== 'PULL_REQUEST') throw new Error('Expected PULL_REQUEST event data.');
  const data = event.data;
  return {
    action: event.action ?? '',
    number: data.pullRequestNumber,
    pull_request: {
      title: data.pullRequest.title,
      draft: data.pullRequest.draft,
      merged: data.pullRequest.merged,
      base: data.pullRequest.base,
      head: data.pullRequest.head,
      user: data.pullRequest.userLogin === null ? null : { login: data.pullRequest.userLogin },
    },
    repository: { id: data.repository.id, full_name: data.repository.fullName },
    ...(data.installationId === null ? {} : { installation: { id: data.installationId } }),
  };
}

function toInstallationPayload(event: NormalizedWebhookEvent): GithubInstallationWebhookPayload {
  if (event.data.kind !== 'INSTALLATION') throw new Error('Expected INSTALLATION event data.');
  return {
    action: event.action ?? '',
    installation: {
      id: event.data.installationId,
      account: {
        id: event.data.account.id ?? undefined,
        type: event.data.account.type ?? undefined,
      },
    },
  };
}

function toInstallationRepositoriesPayload(event: NormalizedWebhookEvent): GithubInstallationRepositoriesWebhookPayload {
  if (event.data.kind !== 'INSTALLATION_REPOSITORIES') throw new Error('Expected INSTALLATION_REPOSITORIES event data.');
  return {
    action: event.action ?? '',
    installation: { id: event.data.installationId },
    repositories_added: event.data.added.map((repository) => ({ id: repository.id, full_name: repository.fullName })),
    repositories_removed: event.data.removed.map((repository) => ({ id: repository.id, full_name: repository.fullName })),
  };
}

function toRepositoryPayload(event: NormalizedWebhookEvent): GithubRepositoryWebhookPayload {
  if (event.data.kind !== 'REPOSITORY') throw new Error('Expected REPOSITORY event data.');
  const data = event.data;
  return {
    action: event.action ?? '',
    repository: {
      id: data.repository.id,
      full_name: data.repository.fullName,
      ...(data.repository.owner === null ? {} : {
        owner: {
          id: data.repository.owner.id,
          login: data.repository.owner.login ?? undefined,
          type: data.repository.owner.type ?? undefined,
        },
      }),
    },
    ...(data.installationId === null ? {} : { installation: { id: data.installationId } }),
  };
}

function toAccessPayload(event: NormalizedWebhookEvent): unknown {
  const action = event.action ?? '';
  switch (event.data.kind) {
    case 'MEMBER':
      return {
        action,
        ...(event.data.memberId === null ? {} : { member: { id: event.data.memberId } }),
        ...(event.data.repositoryId === null ? {} : { repository: { id: event.data.repositoryId } }),
      };
    case 'MEMBERSHIP':
      return {
        action,
        ...(event.data.memberId === null ? {} : { member: { id: event.data.memberId } }),
        ...(event.data.organizationId === null ? {} : { organization: { id: event.data.organizationId } }),
      };
    case 'ORGANIZATION':
      return {
        action,
        ...(event.data.organizationId === null && event.data.organizationLogin === null ? {} : {
          organization: {
            ...(event.data.organizationId === null ? {} : { id: event.data.organizationId }),
            ...(event.data.organizationLogin === null ? {} : { login: event.data.organizationLogin }),
          },
        }),
        ...(event.data.membershipUserId === null ? {} : { membership: { user: { id: event.data.membershipUserId } } }),
      };
    case 'TEAM':
      return {
        action,
        ...(event.data.repositoryId === null ? {} : { repository: { id: event.data.repositoryId } }),
        ...(event.data.organizationId === null ? {} : { organization: { id: event.data.organizationId } }),
      };
    default:
      return {};
  }
}
