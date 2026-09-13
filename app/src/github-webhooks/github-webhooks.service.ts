import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isValidWebhookSignature } from './webhook-signature.util.js';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository.js';
import type { GithubPullRequestWebhookPayload } from './dto/pull-request-webhook.payload.js';
import type { GitHubWebhookAcceptedResponse } from './dto/webhook-accepted.response.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import type { CreateAnalysisRunInput } from '../analysis-runs/analysis-runs.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';

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
 * system-contract.md`, "AnalysisRun, Job y Check").
 */
@Injectable()
export class GithubWebhooksService {
  constructor(
    private readonly configService: ConfigService,
    private readonly webhookDeliveriesRepository: WebhookDeliveriesRepository,
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly analysisRunsService: AnalysisRunsService,
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

  private startRun(payload: GithubPullRequestWebhookPayload, binding: RepositoryBinding) {
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

    return this.analysisRunsService.startRunFromWebhook(input);
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
}
