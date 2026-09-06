import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { ProjectResponse } from './dto/project.response.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProjectDto): Promise<ProjectResponse> {
    return this.projectsService.create(dto);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<ProjectResponse> {
    return this.projectsService.getById(id);
  }
}
