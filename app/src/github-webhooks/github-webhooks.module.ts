import { Module } from '@nestjs/common';
import { GithubWebhooksController } from './github-webhooks.controller.js';
import { GithubWebhooksService } from './github-webhooks.service.js';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';

@Module({
  imports: [RepositoryBindingsModule, AnalysisRunsModule],
  controllers: [GithubWebhooksController],
  providers: [GithubWebhooksService, WebhookDeliveriesRepository],
})
export class GithubWebhooksModule {}
