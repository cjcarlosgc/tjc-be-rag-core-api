import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectVersionsService } from './project-versions.service.js';
import { IndexProjectDto } from './dto/index-project.dto.js';
import type { IndexAcceptedResponse } from './dto/index-accepted.response.js';
import type { ProjectVersionResponse } from './dto/project-version.response.js';
import type { ProjectVersionResultsResponse } from './dto/project-version-results.response.js';
import type { TestInventoryResponse } from './dto/test-target.response.js';

@Controller()
export class ProjectVersionsController {
  constructor(private readonly projectVersionsService: ProjectVersionsService) {}

  @Post('projects/index')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  index(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: IndexProjectDto,
  ): Promise<IndexAcceptedResponse> {
    return this.projectVersionsService.startIndexing(file, dto);
  }

  @Get('project-versions/:id')
  getStatus(@Param('id') id: string): Promise<ProjectVersionResponse> {
    return this.projectVersionsService.getStatus(id);
  }

  @Get('project-versions/:id/results')
  getResults(@Param('id') id: string): Promise<ProjectVersionResultsResponse> {
    return this.projectVersionsService.getResults(id);
  }

  @Get('project-versions/:id/test-inventory')
  getTestInventory(@Param('id') id: string): Promise<TestInventoryResponse> {
    return this.projectVersionsService.getTestInventory(id);
  }
}
