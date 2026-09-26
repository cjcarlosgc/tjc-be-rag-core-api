import { Module } from '@nestjs/common';
import { GithubWebhooksController } from './github-webhooks.controller.js';
import { GithubWebhooksService } from './github-webhooks.service.js';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { AccessSyncModule } from '../access-sync/access-sync.module.js';
import { RepositoryEventsService } from './repository-events.service.js';
import { AccessEventsService } from './access-events.service.js';
import { ProjectAccessModule } from '../project-access/project-access.module.js';
import { GithubIntegrationAuthGuard } from './github-integration-auth.guard.js';
import { GithubUiAuthorizationController } from './github-ui-authorization.controller.js';
import { GithubUiAuthorizationService } from './github-ui-authorization.service.js';

@Module({
  imports: [RepositoryBindingsModule, AnalysisRunsModule, AccessSyncModule, ProjectAccessModule],
  controllers: [GithubWebhooksController, GithubUiAuthorizationController],
  providers: [
    GithubWebhooksService,
    WebhookDeliveriesRepository,
    RepositoryEventsService,
    AccessEventsService,
    GithubIntegrationAuthGuard,
    GithubUiAuthorizationService,
  ],
})
export class GithubWebhooksModule {}
