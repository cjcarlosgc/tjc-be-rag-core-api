import { Global, Module } from '@nestjs/common';
import { ProjectAccessModule } from '../project-access/project-access.module.js';
import { ProjectSubscriptionsService } from './project-subscriptions.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { REALTIME_PUBLISHER } from './realtime-publisher.port.js';

@Global()
@Module({
  imports: [ProjectAccessModule],
  providers: [
    RealtimeGateway,
    ProjectSubscriptionsService,
    { provide: REALTIME_PUBLISHER, useExisting: RealtimeGateway },
  ],
  exports: [RealtimeGateway, ProjectSubscriptionsService, REALTIME_PUBLISHER],
})
export class RealtimeModule {}
