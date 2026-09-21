import { Module } from '@nestjs/common';
import { GithubWebhooksController } from './github-webhooks.controller.js';
import { GithubWebhooksService } from './github-webhooks.service.js';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { AccessSyncModule } from '../access-sync/access-sync.module.js';
import { RepositoryEventsService } from './repository-events.service.js';

@Module({
  imports: [RepositoryBindingsModule, AnalysisRunsModule, AccessSyncModule],
  controllers: [GithubWebhooksController],
  providers: [GithubWebhooksService, WebhookDeliveriesRepository, RepositoryEventsService],
})
export class GithubWebhooksModule {}
