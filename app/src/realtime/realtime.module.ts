import { Global, Module } from '@nestjs/common';
import { ProjectAccessModule } from '../project-access/project-access.module.js';
import { ProjectSubscriptionsService } from './project-subscriptions.service.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Global()
@Module({
  imports: [ProjectAccessModule],
  providers: [RealtimeGateway, ProjectSubscriptionsService],
  exports: [RealtimeGateway, ProjectSubscriptionsService],
})
export class RealtimeModule {}
