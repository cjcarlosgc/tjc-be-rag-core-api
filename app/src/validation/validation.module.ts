import { Module } from '@nestjs/common';
import { AnalysisRunValidationController } from './analysis-run-validation.controller.js';
import { AnalysisRunValidationJobHandler } from './analysis-run-validation-job.handler.js';
import { GeneratedTestProposalsRepository } from './generated-test-proposals.repository.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { SnapshotIntelligenceModule } from '../snapshot-intelligence/snapshot-intelligence.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { GenerationModule } from '../generation/generation.module.js';
import { SandboxModule } from '../sandbox/sandbox.module.js';
import { ChecksModule } from '../checks/checks.module.js';

@Module({
  imports: [
    AnalysisRunsModule,
    RepositoryBindingsModule,
    ProjectVersionsModule,
    SnapshotIntelligenceModule,
    RetrievalModule,
    GenerationModule,
    SandboxModule,
    ChecksModule,
  ],
  controllers: [AnalysisRunValidationController],
  providers: [GeneratedTestProposalsRepository, AnalysisRunValidationJobHandler],
})
export class ValidationModule {}
