import { Module } from '@nestjs/common';
import { RepositoryBindingsController } from './repository-bindings.controller.js';
import { RepositoryBindingsService } from './repository-bindings.service.js';
import { RepositoryBindingsRepository } from './repository-bindings.repository.js';
import { GithubUserRepositoriesService } from './github/github-user-repositories.service.js';
import { GithubRepositoryAccessService } from './github/github-repository-access.service.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { GithubAppModule } from '../github-app/github-app.module.js';

@Module({
  imports: [ProjectsModule, GithubAppModule],
  controllers: [RepositoryBindingsController],
  providers: [
    RepositoryBindingsService,
    RepositoryBindingsRepository,
    GithubUserRepositoriesService,
    GithubRepositoryAccessService,
  ],
  exports: [RepositoryBindingsService, RepositoryBindingsRepository],
})
export class RepositoryBindingsModule {}
