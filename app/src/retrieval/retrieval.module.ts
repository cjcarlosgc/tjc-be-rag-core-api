import { Module } from '@nestjs/common';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { FunctionalKnowledgeModule } from '../functional-knowledge/functional-knowledge.module.js';
import { RetrievalService } from './retrieval.service.js';
import { ContextBuilder } from './context-builder.service.js';
import { FunctionalRulesRetriever } from './functional-rules.retriever.js';

@Module({
  imports: [ProjectVersionsModule, FunctionalKnowledgeModule],
  providers: [RetrievalService, ContextBuilder, FunctionalRulesRetriever],
  exports: [RetrievalService, ContextBuilder, FunctionalRulesRetriever],
})
export class RetrievalModule {}
