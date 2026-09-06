import { Module } from '@nestjs/common';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { RetrievalService } from './retrieval.service.js';
import { ContextBuilder } from './context-builder.service.js';

@Module({
  imports: [ProjectVersionsModule],
  providers: [RetrievalService, ContextBuilder],
  exports: [RetrievalService, ContextBuilder],
})
export class RetrievalModule {}
