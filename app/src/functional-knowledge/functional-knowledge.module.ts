import { Module } from '@nestjs/common';
import { FunctionalKnowledgeController } from './functional-knowledge.controller.js';
import { FunctionalKnowledgeService } from './functional-knowledge.service.js';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import { FunctionalKnowledgeRepository } from './functional-knowledge.repository.js';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';
import { FunctionalContinuationJobHandler } from './functional-continuation-job.handler.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ChecksModule } from '../checks/checks.module.js';

@Module({
  imports: [AnalysisRunsModule, ProjectsModule, ChecksModule],
  controllers: [FunctionalKnowledgeController],
  providers: [
    FunctionalKnowledgeService,
    FunctionalQuestionsRepository,
    FunctionalKnowledgeRepository,
    FunctionalContextEvaluatorService,
    FunctionalContinuationJobHandler,
  ],
  exports: [
    FunctionalQuestionsRepository,
    FunctionalKnowledgeRepository,
    FunctionalContextEvaluatorService,
  ],
})
export class FunctionalKnowledgeModule {}
