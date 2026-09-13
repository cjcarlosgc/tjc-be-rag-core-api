import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { GenerationModule } from '../generation/generation.module.js';

@Global()
@Module({
  imports: [ProjectVersionsModule, GenerationModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
