import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';

@Global()
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
