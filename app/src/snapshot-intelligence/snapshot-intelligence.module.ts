import { Module } from '@nestjs/common';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { GithubAppAuthService } from './github-app-auth.service.js';
import { GithubRepositoryContentService } from './github-repository-content.service.js';
import { GithubSnapshotMaterializerService } from './github-snapshot-materializer.service.js';
import { SnapshotAnalysisJobHandler } from './snapshot-analysis-job.handler.js';

@Module({
  imports: [ProjectVersionsModule, AnalysisRunsModule, RepositoryBindingsModule],
  providers: [
    GithubAppAuthService,
    GithubRepositoryContentService,
    GithubSnapshotMaterializerService,
    SnapshotAnalysisJobHandler,
  ],
})
export class SnapshotIntelligenceModule {}
