import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { ProjectResponse } from './dto/project.response.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { Page } from '../common/dto/page.response.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProjectDto): Promise<ProjectResponse> {
    return this.projectsService.create(dto);
  }

  @Get()
  list(@Query() query: PaginationQueryDto): Promise<Page<ProjectResponse>> {
    return this.projectsService.list(query.limit, query.cursor);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<ProjectResponse> {
    return this.projectsService.getById(id);
  }
}
