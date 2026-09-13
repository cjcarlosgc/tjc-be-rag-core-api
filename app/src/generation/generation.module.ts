import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { SandboxModule } from '../sandbox/sandbox.module.js';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { TestGenerationController } from './test-generation.controller.js';
import { TestGenerationService } from './test-generation.service.js';
import { TestGenerationRunsRepository } from './persistence/test-generation-runs.repository.js';
import { GapAnalyzer } from './gap-analyzer.service.js';
import { PromptBuilder } from './prompt-builder.service.js';
import { TestFileMergeService } from './test-file-merge.service.js';
import { TestGenerationJobHandler } from './test-generation-job.handler.js';
import { RetryTargetJobHandler } from './retry-target-job.handler.js';

@Module({
  imports: [ProjectsModule, ProjectVersionsModule, RetrievalModule, SandboxModule, ArtifactsModule],
  controllers: [TestGenerationController],
  providers: [
    TestGenerationService,
    TestGenerationRunsRepository,
    GapAnalyzer,
    PromptBuilder,
    TestFileMergeService,
    TestGenerationJobHandler,
    RetryTargetJobHandler,
  ],
  exports: [PromptBuilder, TestFileMergeService, TestGenerationRunsRepository],
})
export class GenerationModule {}
