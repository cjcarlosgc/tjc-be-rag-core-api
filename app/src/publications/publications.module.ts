import { Module } from '@nestjs/common';
import { TestPublicationsController } from './test-publications.controller.js';
import { TestPublicationsService } from './test-publications.service.js';
import { TestPublicationsRepository } from './test-publications.repository.js';
import { TestPublicationJobHandler } from './test-publication-job.handler.js';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { ValidationModule } from '../validation/validation.module.js';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { ProjectAccessModule } from '../project-access/project-access.module.js';

@Module({
  imports: [AnalysisRunsModule, RepositoryBindingsModule, ValidationModule, GithubAppModule, ProjectAccessModule],
  controllers: [TestPublicationsController],
  providers: [TestPublicationsService, TestPublicationsRepository, TestPublicationJobHandler],
})
export class PublicationsModule {}
