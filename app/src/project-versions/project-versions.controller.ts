import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProjectVersionsService } from './project-versions.service.js';
import type {
  ProjectVersionResponse,
  ProjectVersionSummaryResponse,
} from './dto/project-version.response.js';
import type { ProjectVersionResultsResponse } from './dto/project-version-results.response.js';
import type { TestInventoryResponse } from './dto/test-target.response.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { Page } from '../common/dto/page.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';

@Controller()
export class ProjectVersionsController {
  constructor(private readonly projectVersionsService: ProjectVersionsService) {}

  @Get('project-versions/:id')
  getStatus(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<ProjectVersionResponse> {
    return this.projectVersionsService.getStatus(id, userId);
  }

  @Get('project-versions/:id/results')
  getResults(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<ProjectVersionResultsResponse> {
    return this.projectVersionsService.getResults(id, userId);
  }

  @Get('project-versions/:id/test-inventory')
  getTestInventory(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<TestInventoryResponse> {
    return this.projectVersionsService.getTestInventory(id, userId);
  }

  @Get('projects/:id/versions')
  listVersions(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<Page<ProjectVersionSummaryResponse>> {
    return this.projectVersionsService.listVersions(id, query.limit, query.cursor, userId);
  }
}
