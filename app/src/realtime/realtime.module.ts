import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';

@Global()
@Module({
  imports: [ProjectVersionsModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
