import { Module } from '@nestjs/common';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { FunctionalKnowledgeModule } from '../functional-knowledge/functional-knowledge.module.js';
import { GithubSnapshotMaterializerService } from './github-snapshot-materializer.service.js';
import { SnapshotAnalysisJobHandler } from './snapshot-analysis-job.handler.js';

@Module({
  imports: [
    ProjectVersionsModule,
    AnalysisRunsModule,
    RepositoryBindingsModule,
    GithubAppModule,
    FunctionalKnowledgeModule,
  ],
  providers: [GithubSnapshotMaterializerService, SnapshotAnalysisJobHandler],
})
export class SnapshotIntelligenceModule {}
