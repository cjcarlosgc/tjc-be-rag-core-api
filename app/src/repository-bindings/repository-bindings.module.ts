import { Module } from '@nestjs/common';
import { RepositoryBindingsService } from './repository-bindings.service.js';
import { RepositoryBindingsRepository } from './repository-bindings.repository.js';
import { ProjectsModule } from '../projects/projects.module.js';

@Module({
  imports: [ProjectsModule],
  providers: [RepositoryBindingsService, RepositoryBindingsRepository],
  exports: [RepositoryBindingsService, RepositoryBindingsRepository],
})
export class RepositoryBindingsModule {}
