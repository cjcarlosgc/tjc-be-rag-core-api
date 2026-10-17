import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { ProjectResponse } from './dto/project.response.js';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto.js';
import type { Page } from '../common/dto/page.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import { CurrentGithubUserId } from '../common/auth/current-github-user-id.decorator.js';
import { NoProjectRole, ProjectTargets, RequireProjectRole } from '../project-access/access-policy.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @NoProjectRole(
    'Crea un Project: aún no existe ninguno sobre el que tener rol; ProjectsService.create verifica el workspace (personal: cualquiera; organización: Admin en vivo).',
  )
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUserId() userId: string,
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<ProjectResponse> {
    return this.projectsService.create(dto, userId, githubUserId);
  }

  @Get()
  @RequireProjectRole('READER', ProjectTargets.listing())
  list(
    @Query() query: ListProjectsQueryDto,
    @CurrentUserId() userId: string,
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<Page<ProjectResponse>> {
    return this.projectsService.list(query.limit, query.cursor, userId, githubUserId, query.workspaceId);
  }

  @Get(':id')
  @RequireProjectRole('READER', ProjectTargets.project('id'))
  getById(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<ProjectResponse> {
    return this.projectsService.getById(id, userId, githubUserId);
  }

  @Patch(':id')
  @RequireProjectRole('ADMIN', ProjectTargets.project('id'))
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUserId() userId: string,
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<ProjectResponse> {
    return this.projectsService.update(id, dto, userId, githubUserId);
  }

  @Delete(':id')
  @RequireProjectRole('ADMIN', ProjectTargets.project('id'))
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUserId() userId: string): Promise<void> {
    await this.projectsService.delete(id, userId);
  }
}
