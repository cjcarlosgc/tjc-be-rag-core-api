import { Module } from '@nestjs/common';
import { FunctionalKnowledgeController } from './functional-knowledge.controller.js';
import { FunctionalKnowledgeService } from './functional-knowledge.service.js';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import { FunctionalKnowledgeRepository } from './functional-knowledge.repository.js';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';
import { FunctionalContinuationJobHandler } from './functional-continuation-job.handler.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { ProjectAccessModule } from '../project-access/project-access.module.js';
import { ChecksModule } from '../checks/checks.module.js';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { SymbolBehaviorConstructsService } from './symbol-behavior-constructs.service.js';

@Module({
  imports: [AnalysisRunsModule, ProjectAccessModule, ChecksModule, GithubAppModule],
  controllers: [FunctionalKnowledgeController],
  providers: [
    FunctionalKnowledgeService,
    FunctionalQuestionsRepository,
    FunctionalKnowledgeRepository,
    FunctionalContextEvaluatorService,
    FunctionalContinuationJobHandler,
    SymbolBehaviorConstructsService,
  ],
  exports: [
    FunctionalQuestionsRepository,
    FunctionalKnowledgeRepository,
    FunctionalContextEvaluatorService,
    SymbolBehaviorConstructsService,
  ],
})
export class FunctionalKnowledgeModule {}
