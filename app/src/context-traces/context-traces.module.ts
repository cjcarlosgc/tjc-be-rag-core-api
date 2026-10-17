import { Module } from '@nestjs/common';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { ContextTraceReadsRepository } from './context-trace-reads.repository.js';
import { ContextTracesRepository } from './context-traces.repository.js';
import { ContextTracesService } from './context-traces.service.js';

@Module({
  imports: [ProjectVersionsModule],
  providers: [
    ContextTracesRepository,
    ContextTraceReadsRepository,
    ContextTracesService,
  ],
  exports: [ContextTracesRepository, ContextTracesService],
})
export class ContextTracesModule {}
