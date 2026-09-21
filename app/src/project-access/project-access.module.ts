import { Module } from '@nestjs/common';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { OrganizationAccessResolver } from './organization-access.resolver.js';
import { ProjectAccessRepository } from './project-access.repository.js';
import { ProjectAccessService } from './project-access.service.js';

@Module({
  imports: [GithubAppModule],
  providers: [ProjectAccessRepository, OrganizationAccessResolver, ProjectAccessService],
  exports: [ProjectAccessRepository, OrganizationAccessResolver, ProjectAccessService],
})
export class ProjectAccessModule {}
