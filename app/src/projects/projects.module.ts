import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsRepository } from './projects.repository.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { ProjectAccessModule } from '../project-access/project-access.module.js';

@Module({
  imports: [WorkspacesModule, ProjectAccessModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsService, ProjectsRepository],
})
export class ProjectsModule {}
