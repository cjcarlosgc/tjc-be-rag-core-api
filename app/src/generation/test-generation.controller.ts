import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { TestGenerationService } from './test-generation.service.js';
import { CreateTestRunDto } from './dto/create-test-run.dto.js';
import type {
  TestRunAcceptedResponse,
  TestRunResultsResponse,
  TestRunStatusResponse,
  TestRunSummaryResponse,
} from './dto/test-run.response.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { Page } from '../common/dto/page.response.js';

@Controller()
export class TestGenerationController {
  constructor(private readonly testGenerationService: TestGenerationService) {}

  @Post('test-runs')
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateTestRunDto): Promise<TestRunAcceptedResponse> {
    return this.testGenerationService.createRun(dto);
  }

  @Get('test-runs/:id')
  getStatus(@Param('id') id: string): Promise<TestRunStatusResponse> {
    return this.testGenerationService.getStatus(id);
  }

  @Get('test-runs/:id/results')
  getResults(@Param('id') id: string): Promise<TestRunResultsResponse> {
    return this.testGenerationService.getResults(id);
  }

  @Get('project-versions/:id/test-runs')
  getHistory(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<TestRunSummaryResponse>> {
    return this.testGenerationService.getHistory(id, query.limit, query.cursor);
  }
}
