import { Module } from '@nestjs/common';
import { AnalysisRunsController } from './analysis-runs.controller.js';
import { AnalysisRunsService } from './analysis-runs.service.js';
import { AnalysisRunsRepository } from './analysis-runs.repository.js';
import { AnalysisSymbolsRepository } from './persistence/analysis-symbols.repository.js';
import { AnalysisTraceRepository } from './persistence/analysis-trace.repository.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectAccessModule } from '../project-access/project-access.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { PullRequestMetadataBackfillJobHandler } from './pull-request-metadata-backfill.job.handler.js';

@Module({
  imports: [
    ProjectsModule,
    ProjectAccessModule,
    JobsModule,
    RepositoryBindingsModule,
    GithubAppModule,
  ],
  controllers: [AnalysisRunsController],
  providers: [
    AnalysisRunsService,
    AnalysisRunsRepository,
    AnalysisSymbolsRepository,
    AnalysisTraceRepository,
    PullRequestMetadataBackfillJobHandler,
  ],
  exports: [AnalysisRunsService, AnalysisRunsRepository, AnalysisSymbolsRepository, AnalysisTraceRepository],
})
export class AnalysisRunsModule {}
