import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { JobsRepository } from './jobs.repository.js';

@Global()
@Module({
  providers: [JobsService, JobsRepository],
  exports: [JobsService],
})
export class JobsModule {}
