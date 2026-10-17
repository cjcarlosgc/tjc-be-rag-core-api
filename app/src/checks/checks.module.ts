import { Module } from '@nestjs/common';
import { AnalysisRunChecksService } from './analysis-run-checks.service.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';

@Module({
  imports: [AnalysisRunsModule, RepositoryBindingsModule, GithubAppModule],
  providers: [AnalysisRunChecksService],
  exports: [AnalysisRunChecksService],
})
export class ChecksModule {}
