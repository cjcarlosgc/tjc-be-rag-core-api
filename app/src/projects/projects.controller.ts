import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { ProjectResponse } from './dto/project.response.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { Page } from '../common/dto/page.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProjectDto, @CurrentUserId() userId: string): Promise<ProjectResponse> {
    return this.projectsService.create(dto, userId);
  }

  @Get()
  list(
    @Query() query: PaginationQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<Page<ProjectResponse>> {
    return this.projectsService.list(query.limit, query.cursor, userId);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUserId() userId: string): Promise<ProjectResponse> {
    return this.projectsService.getById(id, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUserId() userId: string): Promise<void> {
    await this.projectsService.delete(id, userId);
  }
}
